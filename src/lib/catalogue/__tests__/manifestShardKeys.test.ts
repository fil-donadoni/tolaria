import { describe, it, expect, vi } from "vitest";

// This client's indexes: two hand-written cards, two compiled shards. `lea`
// is BOTH a hand-written Set and a compiled shard, as in the real catalogue.
vi.mock("@convex/cards/catalogue", () => ({
    handWrittenSetCodeOf: (id: string) =>
        ({ "hw-lea": "lea", "hw-gone": "zzz" })[id],
}));
vi.mock("../definitionShards", () => ({
    isKnownSetCode: (code: string) => ["lea", "arn"].includes(code),
    compiledShardKey: (code: string) => `compiled:${code}`,
}));
vi.mock("../compiled-shards", () => ({
    isKnownCompiledShard: (code: string) => ["lea", "mir"].includes(code),
}));

const { manifestShardKeys } = await import("../manifestShardKeys");

/** The shards a seat's Manifest rows ask for (issues #5615, #5616): deduped,
 *  in row order, an entry this client serves no shard for dropped — the
 *  Manifest's `setCode` is a hint. */
describe("manifestShardKeys", () => {
    const compiled = (setCode: string, n = 1) => ({
        definitionId: `00000000-0000-0000-0000-00000000000${n}`,
        setCode,
    });

    it("keys a hand-written card by its OWN index's Set and a compiled card by its shard, each once, in first-seen order", () => {
        expect(
            manifestShardKeys([
                {
                    playerId: "p1",
                    entries: [
                        compiled("mir"),
                        // The server's hint says `arn`; the client's own
                        // index says `lea`, and wins.
                        { definitionId: "hw-lea", setCode: "arn" },
                        compiled("mir", 2),
                    ],
                },
                { playerId: "p2", entries: [compiled("lea")] },
            ])
        ).toEqual(["compiled:mir", "lea", "compiled:lea"]);
    });

    it("drops an entry with no shard here, and skips null and loading rows", () => {
        expect(
            manifestShardKeys([
                null,
                undefined,
                {
                    playerId: "p1",
                    entries: [
                        compiled("zzz"),
                        { definitionId: "hw-gone", setCode: "zzz" },
                        compiled("lea"),
                    ],
                },
            ])
        ).toEqual(["compiled:lea"]);
    });
});
