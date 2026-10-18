import { describe, it, expect, vi, afterEach } from "vitest";
import { getDefinition, tryGetDefinition } from "@convex/cards/registry";
import { isCompiledIndexInstalled } from "@convex/cards/catalogue";
import { twinDefinitionId } from "@convex/cards/twinId";
import type { HandWrittenDefinitionIndex } from "@convex/cards/definitionIndex";
import definitionIndexJson from "../../../../data/catalogue/definition-index.json";
import { unpackCorpus } from "../../../../scripts/lib/packed-corpus";
import { compiledShardKey, isSetResident } from "../definitionShards";
import {
    compiledIndexUrl,
    compiledShardKeys,
    compiledShardUrl,
    shardDictionaryUrl,
} from "../compiled-shards";
import {
    hintedShardKeys,
    makeResident,
    shardsMissingFor,
    type ShardHints,
} from "../residentFor";
import {
    PACKED,
    fetchedUrls,
    serveCompiledAssets,
} from "./compiledShardFixtures";

// THE CLIENT GRAPH, as `compiledShards.test.ts` asks for it: no bundled
// corpus, no Set resident until installed. The tests run in order over one
// graph — a graph's residency only grows.
vi.mock("@convex/cards/compiledPool", () => import("../compiled-pool.browser"));
vi.mock("@convex/cards/setModules", () => import("../set-modules.browser"));

/**
 * Issue #5617 (PRD #5602) — a graph handed definition IDS, not Manifest rows
 * (the Brain worker), makes them resident from the Manifest entries it was
 * primed with: a compiled card through its hinted shard, never the
 * catalogue-wide compiled index; only a card outside every hint pays for the
 * index, which then names its shard.
 */

const ROWS = unpackCorpus(PACKED);
const [KEY_A, KEY_B, KEY_C] = compiledShardKeys;
const rowOf = (key: string) => ROWS.find((r) => r.setCode === key)!;
const CARD_A = rowOf(KEY_A!);
const CARD_B = rowOf(KEY_B!);
const CARD_C = rowOf(KEY_C!);

const HAND_WRITTEN =
    definitionIndexJson as unknown as HandWrittenDefinitionIndex;
const [HAND_ID, , HAND_SET] = HAND_WRITTEN.entries[0]!;

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("making definition ids resident from Manifest hints", () => {
    it("records each entry's Set code and names the shards this build serves — a hand-written card by the client's own index", () => {
        const hints: ShardHints = new Map();
        const keys = hintedShardKeys(
            [
                { definitionId: CARD_A.id, setCode: KEY_A! },
                // A stale hint for a hand-written card: its own index wins.
                { definitionId: HAND_ID, setCode: "zzz" },
            ],
            hints
        );
        expect(keys).toEqual([compiledShardKey(KEY_A!), HAND_SET]);
        expect(hints.get(CARD_A.id)).toBe(KEY_A);
    });

    it("installs a hinted compiled card's shard alone — no compiled index fetched", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        const hints: ShardHints = new Map([[CARD_A.id, KEY_A!]]);

        // A twin is minted from its parent: the parent's hint locates it.
        await makeResident(
            [twinDefinitionId(CARD_A.id, "adventure"), CARD_A.id],
            hints
        );

        expect(fetchedUrls(fetchMock).sort()).toEqual(
            [shardDictionaryUrl, compiledShardUrl(KEY_A!)!].sort()
        );
        expect(isCompiledIndexInstalled()).toBe(false);
        expect(getDefinition(CARD_A.id).name).toBe(CARD_A.name);
        expect(shardsMissingFor([CARD_A.id], hints)).toEqual([]);
    });

    it("installs a hand-written card's Set chunk", async () => {
        expect(isSetResident(HAND_SET)).toBe(false);
        await makeResident([HAND_ID], new Map());
        expect(isSetResident(HAND_SET)).toBe(true);
        expect(tryGetDefinition(HAND_ID)?.id).toBe(HAND_ID);
    });

    it("locates a card no hint names through the compiled index, then installs the shard it names", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        expect(tryGetDefinition(CARD_B.id)).toBeNull();

        await makeResident([CARD_B.id], new Map());

        expect(fetchedUrls(fetchMock)).toEqual([
            compiledIndexUrl,
            compiledShardUrl(KEY_B!)!,
        ]);
        expect(getDefinition(CARD_B.id).name).toBe(CARD_B.name);
    });

    it("a hint naming a resident shard that lacks the card falls back to the index's answer", async () => {
        const fetchMock = serveCompiledAssets();
        vi.stubGlobal("fetch", fetchMock);
        // Wrong: CARD_C lives in KEY_C, and KEY_A is already resident.
        const hints: ShardHints = new Map([[CARD_C.id, KEY_A!]]);

        await makeResident([CARD_C.id], hints);

        expect(fetchedUrls(fetchMock)).toContain(compiledShardUrl(KEY_C!));
        expect(getDefinition(CARD_C.id).name).toBe(CARD_C.name);
    });

    it("rejects when an install does, so the caller never reads a half-resident catalogue", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new Error("HTTP 503")))
        );
        const [, , , KEY_D] = compiledShardKeys;
        const CARD_D = rowOf(KEY_D!);
        await expect(
            makeResident([CARD_D.id], new Map([[CARD_D.id, KEY_D!]]))
        ).rejects.toThrow("HTTP 503");
        expect(tryGetDefinition(CARD_D.id)).toBeNull();
    });
});
