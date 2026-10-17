import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
    expandDefinition,
    getDefinition,
    residentDefinitionIds,
    tryGetDefinition,
} from "@convex/cards/registry";
import {
    catalogueIdByName,
    getAllCardNames,
    getAllRawCards,
    getChooseableCardNames,
    getDefinitionSetCode,
    packedCorpusInflations,
} from "@convex/cards/catalogue";
import { chooseableNamesOf } from "@convex/cards/cardNames";
import {
    twinNameEntriesOf,
    type HandWrittenDefinitionIndex,
} from "@convex/cards/definitionIndex";
import { buildCubePool, cubePoolSize } from "@convex/limited/cube";
import { listDraftableSets } from "@convex/limited/registry";
import {
    blockFor,
    decodeBase64,
    inflateBlock,
} from "@convex/cards/packedCorpus";
import type { CardDefinition } from "@convex/cards/types";
import {
    hydrateCatalogue,
    isCatalogueHydrated,
    resetCatalogueHydrationForTests,
} from "../catalogueArtifact";
import {
    compiledIndexUrl,
    compiledShardKeys,
    compiledShardUrl,
    shardDictionaryUrl,
} from "../catalogue/compiled-shards";
import {
    PACKED,
    compiledShards,
    fetchedUrls,
    serveCompiledAssets,
} from "../catalogue/__tests__/compiledShardFixtures";

// THE CLIENT GRAPH. `vite.config.ts` aliases `./compiledPool` to the browser
// stub in the app and the worker builds; vitest does not, so this file asks
// for the same substitution. The dom project isolates each file's module
// graph, so the catalogue below is a client catalogue: no compiled section at
// load, only what `hydrateCatalogue` installs.
vi.mock(
    "@convex/cards/compiledPool",
    () => import("../catalogue/compiled-pool.browser")
);
// The same for the hand-written half (issue #5615): `./setModules` is
// aliased to the browser seam, so no Set is resident until it is installed.
vi.mock(
    "@convex/cards/setModules",
    () => import("../catalogue/set-modules.browser")
);

/**
 * The client's catalogue on the shared Definition Source (issue #4861, ADR
 * 0113 Amendment IV), its compiled half fetched as per-Set shards (issue
 * #5616, Amendment VI).
 *
 * `getDefinition` is synchronous and hundreds of call sites rely on it, so the
 * design rests on the shards being RESIDENT before any consumer runs — and on
 * nothing more than the asked-for cards ever being decoded. Both are asserted
 * through the real registry seam, in the order a page lives them: failed
 * fetches first, then the one WHOLE hydration, then a game, then the whole
 * index proven equal to the eager hydration it replaces — through the shards,
 * against the server's packed corpus.
 */

const REPO = resolve(__dirname, "../../..");
const HAND_INDEX = JSON.parse(
    readFileSync(resolve(REPO, "data/catalogue/definition-index.json"), "utf8")
) as HandWrittenDefinitionIndex;

/** The eager client's compiled rows: every block of the packed corpus
 *  inflated at once, in the file's order. Until issue #5124 these were read
 *  from the committed `catalogue-<hash>.json` minus its relocated hand-written
 *  rows; that file is retired, and the rows it held are exactly what the
 *  packed corpus decodes to — proved on the generator's side, against the
 *  regenerated merge, by `scripts/__tests__/catalogue-artifact.test.ts`
 *  (`committedPackedDrift`). What this file proves is the other half: that
 *  decoding ON DEMAND through the registry gives back the eager rows. */
function eagerRows(): CardDefinition[] {
    const dictionary = decodeBase64(PACKED.dictionary);
    return PACKED.firstIds.flatMap((_, k) =>
        inflateBlock(PACKED, k, dictionary)
    );
}

function respondWith(body: unknown, init: Partial<Response> = {}) {
    return vi.fn(() =>
        Promise.resolve({
            ok: init.ok ?? true,
            status: init.status ?? 200,
            statusText: init.statusText ?? "OK",
            json: () => Promise.resolve(body),
        } as Response)
    );
}

/** A definition with every function compared by SOURCE (PRD #4849): the
 *  expansion builds fresh closures per call, equal but never identical. */
const bySource = (def: CardDefinition): string =>
    JSON.stringify(def, (_key, value: unknown) =>
        typeof value === "function" ? `fn:${String(value)}` : value
    );

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("compiled asset URLs", () => {
    it("one shard per first-printing Set of the corpus, a dictionary and an index — never the packed corpus", () => {
        expect(compiledShardKeys).toEqual([...new Set(PACKED.setCodes)].sort());
        const urls = [
            shardDictionaryUrl,
            compiledIndexUrl,
            ...compiledShardKeys.map((k) => compiledShardUrl(k)!),
        ];
        expect(new Set(urls).size).toBe(urls.length);
        for (const url of urls) expect(url).not.toMatch(/packed-corpus/);
    });
});

describe("hydrateCatalogue — failures reject, and are retried", () => {
    afterEach(() => resetCatalogueHydrationForTests());

    it("starts with no compiled card: they arrive only with their shards", () => {
        expect(tryGetDefinition(PACKED.ids[0]!)).toBeNull();
        expect(getAllCardNames()).not.toContain(PACKED.names[0]);
    });

    it("starts with no hand-written card either: a Set is resident only once installed (issue #5615)", () => {
        const [id, name] = HAND_INDEX.entries[0]!;
        // The NAME is known — the index is resident — but the definition is
        // not: `null`, never a throw, until its Set chunk is in.
        expect(getAllCardNames()).toContain(name);
        expect(tryGetDefinition(id)).toBeNull();
        expect(isCatalogueHydrated()).toBe(false);
    });

    it("refuses a non-OK response instead of registering nothing in silence", async () => {
        vi.stubGlobal(
            "fetch",
            respondWith({}, { ok: false, status: 404, statusText: "Not Found" })
        );
        await expect(hydrateCatalogue()).rejects.toThrow(/HTTP 404/);
    });

    it("refuses a body that is not the shard it asked for", async () => {
        const real = serveCompiledAssets();
        const foreign = respondWith([{ id: "x", name: "Row" }]);
        vi.stubGlobal(
            "fetch",
            vi.fn((url: string) =>
                url === shardDictionaryUrl ? real(url) : foreign()
            )
        );
        await expect(hydrateCatalogue()).rejects.toThrow(/is not the shard/);
    });

    it("refuses a dictionary body that holds no dictionary", async () => {
        vi.stubGlobal("fetch", respondWith({ rows: [] }));
        await expect(hydrateCatalogue()).rejects.toThrow(/holds no dictionary/);
    });

    it("bounds a stalled fetch, so the gate and the Worker see a rejection", async () => {
        // The failure this guards is a `fetch` that never settles: a pending
        // promise reaches neither the gate's error branch nor the Worker's
        // re-arm, and both would wait for the rest of the session.
        vi.stubGlobal(
            "fetch",
            vi.fn((_url: string, init?: RequestInit) => {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () =>
                        reject(
                            (init.signal as AbortSignal & { reason?: unknown })
                                .reason
                        )
                    );
                });
            })
        );
        vi.useFakeTimers();
        try {
            const inFlight = hydrateCatalogue();
            const settled = vi.fn();
            void inFlight.catch(settled);
            await vi.advanceTimersByTimeAsync(59_000);
            expect(settled).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(2_000);
            await expect(inFlight).rejects.toThrow();
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not memoise a rejection — a retry really re-fetches", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("offline")))
        );
        await expect(hydrateCatalogue()).rejects.toThrow("offline");
        expect(tryGetDefinition(PACKED.ids[0]!)).toBeNull();
        // The gate may not skip its loading screen on a failed fetch.
        expect(isCatalogueHydrated()).toBe(false);
    });
});

describe("hydrateCatalogue — every shard is resident, nothing is decoded", () => {
    it("installs every compiled card from every shard, decoding none of them", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);

        expect(isCatalogueHydrated()).toBe(false);
        await expect(hydrateCatalogue()).resolves.toBe(PACKED.ids.length);
        // What lets the gate render its children on the first frame (#5584).
        expect(isCatalogueHydrated()).toBe(true);
        // WHOLE mode: every hand-written Set installed too (issue #5615).
        for (const [id, name] of HAND_INDEX.entries) {
            expect(tryGetDefinition(id)?.id, name).toBe(id);
        }

        // Every shard once, the dictionary once — and not the names index:
        // the shards carry their own slices of it.
        expect(fetchedUrls(fetchMock).sort()).toEqual(
            [
                shardDictionaryUrl,
                ...compiledShardKeys.map((k) => compiledShardUrl(k)!),
            ].sort()
        );
        expect(fetchMock).toHaveBeenCalledWith(
            shardDictionaryUrl,
            expect.objectContaining({ signal: expect.anything() })
        );
        // The names are the index's, so the deck builder and the name inputs
        // know the whole catalogue…
        expect(getAllCardNames()).toEqual(
            expect.arrayContaining([...PACKED.names])
        );
        // …and not one block has been inflated, nor one compiled row made
        // resident: hydration is NOT a whole-corpus decode any more.
        expect(packedCorpusInflations()).toBe(0);
        const compiled = new Set(PACKED.ids);
        expect(
            [...residentDefinitionIds()].filter((id) => compiled.has(id))
        ).toEqual([]);
    });

    it("fetches once — a later call reuses the promise, not the network", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        await Promise.all([hydrateCatalogue(), hydrateCatalogue()]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("the Draft Lab's whole-pool reads decode nothing", () => {
        // Draftability counts every card of every Booster Sheet and the cube
        // pool resolves 542 names: both are membership questions the
        // Definition Index answers without a block.
        expect(listDraftableSets().length).toBeGreaterThan(0);
        expect(cubePoolSize()).toBeGreaterThan(0);
        const compiled = new Set(PACKED.ids);
        expect(buildCubePool().some((id) => compiled.has(id))).toBe(true);
        expect(packedCorpusInflations()).toBe(0);
    });

    it("a game decodes only the blocks holding its own cards", () => {
        // Sixty compiled cards spread across the corpus: a deck's worth.
        const stride = Math.floor(PACKED.ids.length / 60);
        const game = PACKED.ids.filter((_, i) => i % stride === 0).slice(0, 60);
        for (const id of game) expect(getDefinition(id).id).toBe(id);

        // One block of one shard per distinct (shard, block) the game hits.
        const shardOf = new Map(
            compiledShards().flatMap((s) => s.ids.map((id) => [id, s]))
        );
        const blocks = new Set(
            game.map((id) => {
                const shard = shardOf.get(id)!;
                return `${shard.key}#${blockFor(shard, id)}`;
            })
        );
        expect(packedCorpusInflations()).toBe(blocks.size);
        const total = compiledShards().reduce(
            (n, s) => n + s.firstIds.length,
            0
        );
        expect(blocks.size).toBeLessThan(total / 2);
    });
});

describe("equivalence with the eager hydration it replaces", () => {
    it("every Card ID of the Definition Index decodes to the definition the eager hydration produced", () => {
        // The eager client fetched `catalogue-<hash>.json` (retired by issue
        // #5124), dropped its relocated hand-written rows and registered the
        // rest — the rows `eagerRows` inflates whole from the server's packed
        // corpus; `getDefinition` then expanded them. Same rows, same
        // expansion — against what the SHARDS decode on demand (issue #5616).
        const handWritten = new Set(getAllRawCards().map((c) => c.id));
        const eager = eagerRows();

        expect(eager.map((r) => r.id).sort()).toEqual([...PACKED.ids].sort());
        for (const row of eager) {
            expect(bySource(getDefinition(row.id))).toBe(
                bySource(expandDefinition(row))
            );
        }
        // The hand-written half is the same module graph on both paths.
        for (const id of handWritten) expect(getDefinition(id).id).toBe(id);
    });

    it("the name lists and lookups are the ones the eager hydration derived", () => {
        // `registerCompiledDefinitions` derived these from each fetched row
        // (`twinNameEntriesOf`, `chooseableNamesOf`), first write winning, in
        // the artifact's order after the hand-written index. The shards carry
        // them in per-Set slices, installed in whatever order they arrive:
        // same lists, in id order, and the same winners (issue #5616).
        const eager = eagerRows();
        const lookups = HAND_INDEX.lookups;
        expect(getAllCardNames()).toEqual([
            ...HAND_INDEX.entries.map(([, name]) => name),
            ...eager.map((r) => r.name),
        ]);
        expect(getChooseableCardNames()).toEqual([
            ...HAND_INDEX.entries.flatMap(
                ([id, name]) => lookups.chooseableNames[id] ?? [name]
            ),
            ...eager.flatMap((r) => chooseableNamesOf(r)),
        ]);

        const expected = new Map<string, string>();
        const add = (key: string, id: string) => {
            if (!expected.has(key)) expected.set(key, id);
        };
        for (const [id, name] of HAND_INDEX.entries)
            add(name.toLowerCase(), id);
        for (const [id] of HAND_INDEX.entries)
            for (const [key, twin] of lookups.twinNames[id] ?? [])
                add(key, twin);
        for (const row of eager) {
            add(row.name.toLowerCase(), row.id);
            for (const [key, twin] of twinNameEntriesOf(row)) add(key, twin);
        }
        for (const [key, id] of expected)
            expect(catalogueIdByName(key), key).toBe(id);

        for (const row of eager)
            expect(getDefinitionSetCode(row.id)).toBe(row.setCode ?? "");
    });
});
