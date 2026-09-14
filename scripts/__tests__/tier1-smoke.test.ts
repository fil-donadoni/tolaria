/**
 * The Tier 1 Bot smoke's PURE half (issue #2719) — the plan, the seeds and the
 * freeze classification.
 *
 * The games themselves are a CLI (`bun run smoke:tier1`, ~20 CPU-minutes) and
 * can never be a gate. What the gate CAN hold is everything that decides what
 * the run covers and how it reads a result: a matrix that quietly skipped a
 * deck, a seed that collided across games, or a guard reason classified as a
 * normal outcome would each make a green receipt meaningless, and none of them
 * needs the engine to catch.
 */

import { describe, it, expect } from "vitest";
import {
    CRASH_REASON,
    filterPairs,
    isFreeze,
    REASON_IS_FREEZE,
    smokePairs,
    smokeRow,
    smokeSeed,
    smokeVerdict,
    summarize,
    TIMEOUT_REASON,
    type SmokeResult,
} from "../lib/tier1-smoke";

const SLUGS = [
    "goblin",
    "psychatog",
    "parallax-replenish",
    "landstill",
    "oath-ponza",
    "aluren",
];

function result(over: Partial<SmokeResult> = {}): SmokeResult {
    return {
        index: 0,
        deckSeat0: "goblin",
        deckSeat1: "aluren",
        reason: "life",
        turns: 12,
        plies: 300,
        winner: "S0",
        seconds: 90,
        ...over,
    };
}

describe("smokePairs — the coverage matrix", () => {
    const pairs = smokePairs(SLUGS);

    it("plays every deck against every OTHER deck, once", () => {
        expect(pairs).toHaveLength((SLUGS.length * (SLUGS.length - 1)) / 2);
        const keys = pairs.map((p) =>
            [p.deckSeat0, p.deckSeat1].sort().join("|")
        );
        expect(new Set(keys).size).toBe(pairs.length);
        expect(pairs.every((p) => p.deckSeat0 !== p.deckSeat1)).toBe(true);
    });

    it("puts every deck in the matrix — a skipped list is a hole in the claim", () => {
        const seen = new Set(pairs.flatMap((p) => [p.deckSeat0, p.deckSeat1]));
        expect([...seen].sort()).toEqual([...SLUGS].sort());
    });

    it("seats every deck on the play AND on the draw", () => {
        // Without the parity flip the first slug would open all five of its
        // games and the last none, so an on-the-draw-only freeze would be
        // invisible for half the pool.
        for (const slug of SLUGS) {
            expect(pairs.some((p) => p.deckSeat0 === slug)).toBe(true);
            expect(pairs.some((p) => p.deckSeat1 === slug)).toBe(true);
        }
    });

    it("numbers the pairs 0..n-1 and gives each a distinct seed", () => {
        expect(pairs.map((p) => p.index)).toEqual(pairs.map((_, i) => i));
        const seeds = pairs.map((p) => smokeSeed(27190, p.index));
        expect(new Set(seeds).size).toBe(pairs.length);
    });
});

describe("filterPairs", () => {
    const pairs = smokePairs(SLUGS);

    it("keeps every pair naming a wanted deck, with its ORIGINAL index", () => {
        const only = filterPairs(pairs, ["aluren"]);
        expect(only).toHaveLength(SLUGS.length - 1);
        for (const p of only) {
            expect([p.deckSeat0, p.deckSeat1]).toContain("aluren");
            // The index is the seed's input, so a filtered run must reproduce
            // the matching subset of a full one rather than re-number it.
            expect(pairs[p.index]).toEqual(p);
        }
    });

    it("an empty filter is the whole plan", () => {
        expect(filterPairs(pairs, [])).toEqual(pairs);
    });
});

describe("freeze classification", () => {
    it("counts every harness guard as a freeze and every MTG ending as fine", () => {
        // The table is exhaustive over `GameEndReason` by TYPE (tsc reds on a
        // missing key); this pins the VALUES, which tsc cannot.
        expect(
            Object.entries(REASON_IS_FREEZE)
                .filter(([, freeze]) => freeze)
                .map(([reason]) => reason)
                .sort()
        ).toEqual(["max-plies", "resolution-error", "search-error", "stall"]);
        expect(
            Object.entries(REASON_IS_FREEZE)
                .filter(([, freeze]) => !freeze)
                .map(([reason]) => reason)
                .sort()
        ).toEqual([
            "alternate-win",
            "concede",
            "decked",
            "draw",
            "life",
            "poison",
        ]);
    });

    it("an uncaught throw — the illegal-move half — is a freeze", () => {
        expect(isFreeze(CRASH_REASON)).toBe(true);
        expect(isFreeze("life")).toBe(false);
        expect(isFreeze("stall")).toBe(true);
    });

    it("a game killed on the wall clock is a freeze, never a quiet skip", () => {
        // The ply cap is not a time bound (its wall-clock cost is superlinear
        // in a stalled position), so the matrix needs one — and a game that
        // outlives it must count AGAINST the verdict, or a run could pass by
        // killing everything it could not finish.
        expect(isFreeze(TIMEOUT_REASON)).toBe(true);
    });
});

describe("the receipt", () => {
    it("marks a guard stop FREEZE and names the window nobody drove", () => {
        const row = smokeRow(
            result({
                reason: "stall",
                unhandledExpectedInput: "pendingChoice",
            })
        );
        expect(row.startsWith("FREEZE")).toBe(true);
        expect(row).toContain("expectedInput=pendingChoice");
    });

    it("marks a real MTG ending ok", () => {
        expect(smokeRow(result()).startsWith("  ok  ")).toBe(true);
    });

    it("PASSES only when no game ended on a guard", () => {
        const clean = summarize([result(), result({ index: 1 })]);
        expect(clean.freezes).toBe(0);
        expect(smokeVerdict(clean, 60, 27190)).toContain(
            "PASS — 2 games, 0 freezes"
        );
    });

    it("FAILS, and says how many, when one did", () => {
        const dirty = summarize([
            result(),
            result({ index: 1, reason: "stall" }),
            result({ index: 2, reason: CRASH_REASON }),
            result({ index: 3, reason: TIMEOUT_REASON }),
        ]);
        expect(dirty.freezes).toBe(3);
        const verdict = smokeVerdict(dirty, 60, 27190);
        expect(verdict).toContain("FAIL — 3/4 games ended on a harness guard");
        expect(verdict).toContain("crash=1");
        expect(verdict).toContain("timeout=1");
        expect(verdict).toContain("stall=1");
        expect(verdict).toContain("iterations=60, baseSeed=27190");
    });
});
