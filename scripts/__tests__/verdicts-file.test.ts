// The `verdicts` row → `data/verdicts/<id>.json` lowering (issue #3402,
// PRD #3397).
//
// `bun run verdicts:pull` runs whenever anyone feels like it, and its DIFF is
// what a reviewer reads to see which judgements arrived. So the property under
// test is not "the file is correct" but "the same row produces the same
// bytes": a serializer that reordered keys, or a clock anywhere in the
// lowering, would make every export a whole-corpus diff and hide the one new
// verdict inside it.
import { describe, it, expect } from "vitest";
import {
    serializeVerdict,
    verdictFileNameOfRow,
    verdictFromRow,
    verdictIdOfRow,
    VERDICT_KEY_ORDER,
    type VerdictRow,
} from "../lib/verdicts-file";
import type { Verdict } from "../../convex/gre/ai/verdicts/types";

const ROW: VerdictRow = {
    _id: "k17abc",
    spec: { cards: [{ name: "Mountain", owner: "me" }] },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
    ],
    answer: { kind: "right", rightIndexes: [1] },
    botPickIndex: 0,
    gameId: "game-7",
    seq: 42,
    author: "Tessa",
    createdAt: Date.UTC(2026, 8, 11, 12, 0, 0),
};

describe("verdictFromRow (issue #3402)", () => {
    it("ids the verdict by its document id, and names the file without the prefix", () => {
        // The prefix says where the verdict came from when it sits beside a
        // `registry:` one in a report; the colon stays out of the path.
        expect(verdictIdOfRow(ROW)).toBe("in-play:k17abc");
        expect(verdictFileNameOfRow(ROW)).toBe("k17abc.json");
    });

    it("converts the row's own stamp to ISO 8601, with no clock anywhere", () => {
        expect(verdictFromRow(ROW).createdAt).toBe("2026-09-11T12:00:00.000Z");
        expect(verdictFromRow(ROW)).toEqual(verdictFromRow(ROW));
    });

    it("folds the game provenance into `origin`, and omits it when absent", () => {
        expect(verdictFromRow(ROW).origin).toEqual({
            gameId: "game-7",
            seq: 42,
        });
        const { gameId, seq, botPickIndex, ...bare } = ROW;
        void gameId;
        void seq;
        void botPickIndex;
        const lowered = verdictFromRow(bare as VerdictRow);
        expect("origin" in lowered).toBe(false);
        expect("botPickIndex" in lowered).toBe(false);
    });

    it("marks the verdict as given in play", () => {
        expect(verdictFromRow(ROW).source).toBe("in-play");
    });
});

describe("serializeVerdict (issue #3402)", () => {
    it("writes a fixed key order whatever order the object was built in", () => {
        const forwards = verdictFromRow(ROW);
        const backwards = Object.fromEntries(
            Object.entries(forwards).reverse()
        ) as Verdict;
        expect(serializeVerdict(backwards)).toBe(serializeVerdict(forwards));

        const keys = [
            ...serializeVerdict(forwards).matchAll(/^ {4}"(\w+)":/gm),
        ].map((m) => m[1]);
        expect(keys).toEqual([
            "id",
            "spec",
            "seat",
            "candidates",
            "answer",
            "botPickIndex",
            "author",
            "createdAt",
            "source",
            "origin",
        ]);
    });

    it("ends with exactly one newline, so a re-export is a no-op diff", () => {
        const text = serializeVerdict(verdictFromRow(ROW));
        expect(text.endsWith("}\n")).toBe(true);
        expect(text.endsWith("}\n\n")).toBe(false);
    });

    it("round-trips to the same value", () => {
        const verdict = verdictFromRow(ROW);
        expect(JSON.parse(serializeVerdict(verdict))).toEqual(verdict);
    });

    it("writes EVERY key of `Verdict` — a field added to the type and not to the key order would be dropped from every export", () => {
        // `Required<Verdict>` is what makes this load-bearing: the literal
        // below cannot compile with a key missing, so a widened `Verdict` reds
        // `tsc` here, and the assertion then reds the serializer's own list.
        const full: Required<Verdict> = {
            id: "x",
            spec: { cards: [] },
            setup: [{ kind: "resolve-top" }],
            seat: "me",
            candidates: [{ key: "k", description: "d" }],
            answer: { kind: "right", rightIndexes: [0] },
            botPickIndex: 0,
            author: "a",
            createdAt: "2026-09-11T00:00:00.000Z",
            source: "authored",
            origin: { gameId: "g", seq: 1 },
            note: "n",
        };
        expect([...VERDICT_KEY_ORDER].sort()).toEqual(Object.keys(full).sort());
        expect(Object.keys(JSON.parse(serializeVerdict(full))).sort()).toEqual(
            Object.keys(full).sort()
        );
    });
});
