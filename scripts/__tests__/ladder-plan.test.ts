import { describe, it, expect } from "vitest";
import { LADDER_PAIRINGS } from "../lib/ladder/pairings";
import {
    buildGamePlan,
    buildHeader,
    headerMismatches,
    parseRunFile,
    remainingGames,
    TIER_SEEDS,
    LADDER_ITERATIONS,
    type LadderGameRecord,
} from "../lib/ladder/plan";
import { PRESET_DECKS } from "../../convex/deckPresets";

/**
 * Ladder run plan — the determinism contract of decision #1895 §2 (issue
 * #1924): derived seeds, paired games, exact resume. These are the properties
 * a strength verdict rests on, so they are pinned here rather than trusted.
 */

const K_SMOKE = TIER_SEEDS.smoke;

function record(gameIndex: number): LadderGameRecord {
    return {
        kind: "game",
        gameIndex,
        pairingIndex: 0,
        seedIndex: 0,
        orientation: 0,
        deckSeat0: "a",
        deckSeat1: "b",
        seed: 1,
        candidateSeat: "S1",
        winnerSeat: "S0",
        candidateWon: false,
        reason: "life",
        turns: 9,
        plies: 100,
        ms: 1,
    };
}

describe("ladder pairing registry (decision #1895 §1)", () => {
    it("starts from the six decision-corpus archetype pairings", () => {
        expect(LADDER_PAIRINGS.length).toBeGreaterThanOrEqual(6);
    });

    it("every row references existing preset decks and declares dynamics", () => {
        const presetIds = new Set(PRESET_DECKS.map((d) => d.presetId));
        for (const row of LADDER_PAIRINGS) {
            expect(presetIds.has(row.deckA), `deckA ${row.deckA}`).toBe(true);
            expect(presetIds.has(row.deckB), `deckB ${row.deckB}`).toBe(true);
            expect(row.dynamics.length).toBeGreaterThan(0);
        }
    });
});

describe("ladder game plan (decision #1895 §2)", () => {
    it("tier sizes: smoke 48, decision 240 at the 6-pairing pool", () => {
        expect(buildGamePlan(LADDER_PAIRINGS, TIER_SEEDS.smoke, 1).length).toBe(
            48
        );
        expect(
            buildGamePlan(LADDER_PAIRINGS, TIER_SEEDS.decision, 1).length
        ).toBe(240);
    });

    it("derives seeds as baseSeed + pairing*K + seedIndex", () => {
        const plan = buildGamePlan(LADDER_PAIRINGS, K_SMOKE, 100);
        for (const g of plan) {
            expect(g.seed).toBe(100 + g.pairingIndex * K_SMOKE + g.seedIndex);
        }
    });

    it("pairs games: both orientations share seed and seating, agents swap", () => {
        const plan = buildGamePlan(LADDER_PAIRINGS, K_SMOKE, 7);
        for (let i = 0; i < plan.length; i += 2) {
            const [a, b] = [plan[i], plan[i + 1]];
            expect(a.seed).toBe(b.seed);
            expect(a.deckSeat0).toBe(b.deckSeat0);
            expect(a.deckSeat1).toBe(b.deckSeat1);
            expect(a.candidateSeat).toBe("S1"); // orientation 0
            expect(b.candidateSeat).toBe("S0"); // orientation 1
        }
    });

    it("alternates deck seating by seed parity so both decks play on the play", () => {
        const plan = buildGamePlan(LADDER_PAIRINGS, 2, 1);
        const p1 = plan.filter((g) => g.pairingIndex === 1);
        expect(p1[0].deckSeat0).toBe(LADDER_PAIRINGS[1].deckA);
        expect(p1[2].deckSeat0).toBe(LADDER_PAIRINGS[1].deckB);
    });

    it("is bit-deterministic: same inputs, identical plan", () => {
        expect(
            JSON.stringify(buildGamePlan(LADDER_PAIRINGS, K_SMOKE, 42))
        ).toBe(JSON.stringify(buildGamePlan(LADDER_PAIRINGS, K_SMOKE, 42)));
    });
});

describe("ladder resume (decision #1895 §3)", () => {
    const header = buildHeader(
        "smoke",
        1,
        null,
        LADDER_ITERATIONS,
        LADDER_PAIRINGS
    );

    it("remainingGames returns exactly the not-yet-played entries, in order", () => {
        const plan = buildGamePlan(LADDER_PAIRINGS, K_SMOKE, 1);
        const rest = remainingGames(plan, [record(0), record(2)]);
        expect(rest.length).toBe(plan.length - 2);
        expect(rest[0].gameIndex).toBe(1);
        expect(rest[1].gameIndex).toBe(3);
    });

    it("parseRunFile reads header + records and tolerates a torn tail line", () => {
        const lines = [
            JSON.stringify(header),
            JSON.stringify(record(0)),
            '{"kind":"game","gameIndex":1,"trunc', // crash mid-append
        ];
        const parsed = parseRunFile(lines);
        expect(parsed.header.tier).toBe("smoke");
        expect(parsed.records.map((r) => r.gameIndex)).toEqual([0]);
    });

    it("parseRunFile rejects a file that does not start with a v1 header", () => {
        expect(() => parseRunFile([JSON.stringify(record(0))])).toThrow();
    });

    it("headerMismatches flags every config drift and passes an exact match", () => {
        expect(headerMismatches(header, header)).toEqual([]);
        const drifted = buildHeader(
            "decision",
            2,
            "x",
            8,
            LADDER_PAIRINGS.slice(0, 1)
        );
        const mismatches = headerMismatches(header, drifted);
        expect(mismatches.join("\n")).toMatch(/tier/);
        expect(mismatches.join("\n")).toMatch(/baseSeed/);
        expect(mismatches.join("\n")).toMatch(/variant/);
        expect(mismatches.join("\n")).toMatch(/iterations/);
        expect(mismatches.join("\n")).toMatch(/pairings/);
    });
});
