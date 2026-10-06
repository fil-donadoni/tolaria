import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
    expandDefinition,
    getDefinition,
    residentDefinitionIds,
    tryGetDefinition,
} from "@convex/cards/registry";
import {
    getAllCardNames,
    getAllRawCards,
    packedCorpusInflations,
} from "@convex/cards/catalogue";
import { blockFor, type PackedCorpus } from "@convex/cards/packedCorpus";
import type { CardDefinition } from "@convex/cards/types";
import {
    catalogueArtifactUrl,
    hydrateCatalogue,
    resetCatalogueHydrationForTests,
} from "../catalogueArtifact";

// THE CLIENT GRAPH. `vite.config.ts` aliases `./compiledPool` to the browser
// stub in the app and the worker builds; vitest does not, so this file asks
// for the same substitution. The dom project isolates each file's module
// graph, so the catalogue below is a client catalogue: no compiled section at
// load, only what `hydrateCatalogue` installs.
vi.mock(
    "@convex/cards/compiledPool",
    () => import("../catalogue/compiled-pool.browser")
);

/**
 * The client's catalogue on the shared Definition Source (issue #4861, ADR
 * 0113 Amendment IV).
 *
 * `getDefinition` is synchronous and hundreds of call sites rely on it, so the
 * design rests on the packed corpus being RESIDENT before any consumer runs —
 * and on nothing more than the asked-for cards ever being decoded. Both are
 * asserted through the real registry seam, in the order a page lives them:
 * failed fetches first, then the one hydration, then a game, then the whole
 * index proven equal to the eager hydration it replaces.
 */

const REPO = resolve(__dirname, "../../..");
const PACKED_TEXT = readFileSync(
    resolve(REPO, "data/catalogue/packed-corpus.json"),
    "utf8"
);
const PACKED = JSON.parse(PACKED_TEXT) as PackedCorpus;

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

/** A fresh parse per call: the catalogue keeps what it is handed. */
const servePacked = () => respondWith(JSON.parse(PACKED_TEXT));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("catalogue artifact URL", () => {
    it("is the packed corpus — the file the server bundles", () => {
        expect(catalogueArtifactUrl()).toMatch(/packed-corpus.*\.json$/);
    });
});

describe("hydrateCatalogue — failures reject, and are retried", () => {
    afterEach(() => resetCatalogueHydrationForTests());

    it("starts with no compiled card: they arrive only with the corpus", () => {
        expect(tryGetDefinition(PACKED.ids[0]!)).toBeNull();
        expect(getAllCardNames()).not.toContain(PACKED.names[0]);
    });

    it("refuses a non-OK response instead of registering nothing in silence", async () => {
        vi.stubGlobal(
            "fetch",
            respondWith({}, { ok: false, status: 404, statusText: "Not Found" })
        );
        await expect(hydrateCatalogue()).rejects.toThrow(/HTTP 404/);
    });

    it("refuses a body that is not a packed corpus", async () => {
        vi.stubGlobal("fetch", respondWith([{ id: "x", name: "Row" }]));
        await expect(hydrateCatalogue()).rejects.toThrow(
            /is not a packed corpus/
        );
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
    });
});

describe("hydrateCatalogue — the corpus is resident, nothing is decoded", () => {
    it("installs every compiled card of the index, decoding none of them", async () => {
        const fetchMock = servePacked();
        vi.stubGlobal("fetch", fetchMock);

        await expect(hydrateCatalogue()).resolves.toBe(PACKED.ids.length);

        expect(fetchMock).toHaveBeenCalledWith(
            catalogueArtifactUrl(),
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
        const fetchMock = servePacked();
        vi.stubGlobal("fetch", fetchMock);
        await Promise.all([hydrateCatalogue(), hydrateCatalogue()]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a game decodes only the blocks holding its own cards", () => {
        // Sixty compiled cards spread across the corpus: a deck's worth.
        const stride = Math.floor(PACKED.ids.length / 60);
        const game = PACKED.ids.filter((_, i) => i % stride === 0).slice(0, 60);
        for (const id of game) expect(getDefinition(id).id).toBe(id);

        const blocks = new Set(game.map((id) => blockFor(PACKED, id)));
        expect(packedCorpusInflations()).toBe(blocks.size);
        expect(blocks.size).toBeLessThan(PACKED.firstIds.length / 2);
    });
});

describe("equivalence with the eager hydration it replaces", () => {
    it("every Card ID of the Definition Index decodes to the definition the eager hydration produced", () => {
        // The eager client fetched `catalogue-<hash>.json`, dropped its
        // relocated hand-written rows (`excludeHandWritten`) and registered
        // the rest; `getDefinition` then expanded them. Same file, same drop,
        // same expansion — against what the packed source decodes on demand.
        const dir = resolve(REPO, "data/catalogue");
        const [artifact] = readdirSync(dir).filter(
            (f) => f.startsWith("catalogue-") && f.endsWith(".json")
        );
        const rows = JSON.parse(
            readFileSync(resolve(dir, artifact!), "utf8")
        ) as CardDefinition[];
        const handWritten = new Set(getAllRawCards().map((c) => c.id));
        const eager = rows.filter((r) => !handWritten.has(r.id));

        expect(eager.map((r) => r.id).sort()).toEqual([...PACKED.ids].sort());
        for (const row of eager) {
            expect(bySource(getDefinition(row.id))).toBe(
                bySource(expandDefinition(row))
            );
        }
        // The hand-written half is the same module graph on both paths.
        for (const id of handWritten) expect(getDefinition(id).id).toBe(id);
    });
});
