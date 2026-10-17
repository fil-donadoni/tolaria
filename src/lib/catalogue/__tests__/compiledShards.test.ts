import { describe, it, expect, vi, afterEach } from "vitest";
import { getDefinition, tryGetDefinition } from "@convex/cards/registry";
import {
    catalogueIdByName,
    getAllCardNames,
    getChooseableCardNames,
    isCompiledIndexInstalled,
} from "@convex/cards/catalogue";
import { parentIdOfTwin, twinDefinitionId } from "@convex/cards/twinId";
import { twinNameEntriesOf } from "@convex/cards/definitionIndex";
import { chooseableNamesOf } from "@convex/cards/cardNames";
import { unpackCorpus } from "../../../../scripts/lib/packed-corpus";
import {
    COMPILED_INDEX_KEY,
    compiledShardKey,
    installShards,
    shardNeededBy,
    shardsNeededFor,
} from "../definitionShards";
import {
    compiledIndexUrl,
    compiledShardKeys,
    compiledShardUrl,
    installCompiledShard,
    shardDictionaryUrl,
} from "../compiled-shards";
import {
    PACKED,
    fetchedUrls,
    serveCompiledAssets,
} from "./compiledShardFixtures";

// THE CLIENT GRAPH: no bundled corpus, no Set resident until installed
// (`vite.config.ts`'s aliases, asked for here as `catalogueArtifact.test.ts`
// does). The dom project isolates each file's graph, so these tests live a
// page's life in order: a game's shards, a card outside them located through
// the index, then every shard in REVERSE order.
vi.mock("@convex/cards/compiledPool", () => import("../compiled-pool.browser"));
vi.mock("@convex/cards/setModules", () => import("../set-modules.browser"));

/**
 * Issue #5616 (PRD #5602, ADR 0113 Amendment VI) — the compiled half of the
 * per-game delivery: a game fetches its Manifest's compiled shards and
 * nothing else; a compiled card outside them is LOCATED through the compiled
 * index, never by fetching every shard; and the shards may arrive in any
 * order without changing what a name resolves to.
 */

const ROWS = unpackCorpus(PACKED);
const keyOf = new Map(ROWS.map((r) => [r.id, r.setCode!]));
/** The first row of shard `key`, and a row of a DIFFERENT shard. */
const [GAME_KEY, OTHER_KEY] = compiledShardKeys;
const GAME_CARD = ROWS.find((r) => r.setCode === GAME_KEY)!;
const OTHER_CARD = ROWS.find((r) => r.setCode === OTHER_KEY)!;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a game's compiled shards", () => {
    it("a compiled card no installed section knows needs the compiled index first — nothing resolves yet", () => {
        expect(isCompiledIndexInstalled()).toBe(false);
        expect(shardNeededBy(GAME_CARD.id)).toBe(COMPILED_INDEX_KEY);
        expect(tryGetDefinition(GAME_CARD.id)).toBeNull();
    });

    it("installs the Manifest's shard alone: that shard and the dictionary are fetched, its cards resolve, no other does", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        await installShards([compiledShardKey(GAME_KEY!)]);
        expect(fetchedUrls(fetchMock).sort()).toEqual(
            [shardDictionaryUrl, compiledShardUrl(GAME_KEY!)!].sort()
        );
        expect(getDefinition(GAME_CARD.id).name).toBe(GAME_CARD.name);
        expect(shardsNeededFor([GAME_CARD.id])).toEqual([]);
        // A card of another Set is still unknown, and still unlocated.
        expect(tryGetDefinition(OTHER_CARD.id)).toBeNull();
        expect(shardNeededBy(OTHER_CARD.id)).toBe(COMPILED_INDEX_KEY);
        // The game's names are known; the catalogue's are not.
        expect(getAllCardNames()).toContain(GAME_CARD.name);
        expect(getAllCardNames()).not.toContain(OTHER_CARD.name);
    });

    it("a twin of a compiled card needs its parent's shard", () => {
        const twin = twinDefinitionId(GAME_CARD.id, "adventure");
        expect(shardNeededBy(twin)).toBe(compiledShardKey(GAME_KEY!));
        expect(shardsNeededFor([twin])).toEqual([]);
        expect(
            shardNeededBy(twinDefinitionId(OTHER_CARD.id, "adventure"))
        ).toBe(COMPILED_INDEX_KEY);
    });
});

describe("a compiled card outside the game's shards", () => {
    it("the compiled index locates it — one more request — and names its shard; its definition still needs the shard", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        await installShards(shardsNeededFor([OTHER_CARD.id]));
        expect(fetchedUrls(fetchMock)).toEqual([compiledIndexUrl]);
        expect(isCompiledIndexInstalled()).toBe(true);

        const needed = shardsNeededFor([
            OTHER_CARD.id,
            twinDefinitionId(OTHER_CARD.id, "adventure"),
        ]);
        expect(needed).toEqual([compiledShardKey(OTHER_KEY!)]);
        expect(tryGetDefinition(OTHER_CARD.id)).toBeNull();
        // Every compiled NAME is known now — what a name list reads.
        expect(getAllCardNames()).toEqual(
            expect.arrayContaining([...PACKED.names])
        );

        await installShards(needed);
        expect(getDefinition(OTHER_CARD.id).name).toBe(OTHER_CARD.name);
        expect(fetchedUrls(fetchMock)).toEqual([
            compiledIndexUrl,
            compiledShardUrl(OTHER_KEY!),
        ]);
    });

    it("an id no catalogue card carries needs nothing once the index is in", () => {
        expect(
            shardNeededBy("ffffffff-ffff-4fff-8fff-ffffffffffff")
        ).toBeUndefined();
    });

    it("refuses a shard key this build does not serve", async () => {
        await expect(installCompiledShard("nope")).rejects.toThrow(
            /Unknown compiled shard: nope/
        );
    });
});

describe("arrival order does not change the catalogue", () => {
    it("every shard installed in REVERSE key order: the server's names, lists and lookups, in id order", async () => {
        vi.stubGlobal("fetch", serveCompiledAssets());
        for (const key of [...compiledShardKeys].reverse()) {
            await installCompiledShard(key);
        }
        for (const row of ROWS) {
            expect(tryGetDefinition(row.id)?.id, row.name).toBe(row.id);
            expect(keyOf.get(row.id)).toBe(row.setCode);
        }

        // The compiled half of the lists, in id order — the server's corpus
        // order — whatever order the shards came in.
        const compiledNames = getAllCardNames().slice(-ROWS.length);
        expect(compiledNames).toEqual(ROWS.map((r) => r.name));
        expect(getChooseableCardNames().slice(-countChooseable())).toEqual(
            ROWS.flatMap((r) => chooseableNamesOf(r))
        );

        // The server's name lookup: first write wins, rows in id order, each
        // row's printed name before its twin names — after every hand-written
        // key, which no compiled name displaces.
        const expected = new Map<string, string>();
        for (const row of ROWS) {
            const add = (key: string, id: string) => {
                if (!expected.has(key)) expected.set(key, id);
            };
            add(row.name.toLowerCase(), row.id);
            for (const [key, twin] of twinNameEntriesOf(row)) add(key, twin);
        }
        let checked = 0;
        for (const [key, id] of expected) {
            const holder = catalogueIdByName(key);
            // A hand-written card holds this key (ADR 0108): not ours.
            if (holder !== null && !keyOf.has(parentIdOfTwin(holder) ?? holder))
                continue;
            expect(holder, key).toBe(id);
            checked++;
        }
        expect(checked).toBeGreaterThan(ROWS.length);
    });
});

/** How many choosable names the compiled rows contribute. */
function countChooseable(): number {
    return ROWS.reduce((n, r) => n + chooseableNamesOf(r).length, 0);
}
