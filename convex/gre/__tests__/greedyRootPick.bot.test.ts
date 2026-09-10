// Issue #3393 — the greedy-vs-search measurement seams.
//
// Three things must hold or the measurement measures nothing:
//   1. `greedyRootPick` is deterministic and picks from the SAME candidate
//      set the search would (dominance-pruned `enumerateMoves`).
//   2. A telemetry record emitted by `runSearchWithTrace` carries the greedy
//      key beside the chosen key, and `greedyAgrees` is exactly their
//      equality — with no sink installed nothing is computed.
//   3. The blade runner's `pick: "greedy"` leg answers with exactly the
//      `greedyRootPick` move at every seed — on an entry the search decides
//      differently, so a leg that quietly ran the search instead would show.
import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { greedyRootPick, searchWithTrace } from "../search";
import {
    setRootDecisionSink,
    summarizeRootDecisions,
    type RootDecisionRecord,
} from "../ai/decisionTelemetry";
import {
    buildBladeState,
    findBladeScenario,
    runBladeScenario,
} from "../ai/blade";
import { seatPlayerId } from "../ai/blade/matcher";

// A registry entry the greedy leg and the search decide DIFFERENTLY (the
// greedy pick passes, the search casts — `docs/research/greedy-vs-search.md`),
// so the identity below cannot be satisfied by a leg that ran the search.
const SEARCH_ONLY =
    "sacrifice sign NEGATIVE CONTROL: still casts a genuine edict";
const RICH = "overloads Damn to wrath three creatures instead of killing one";

function scenarioNamed(label: string) {
    const scenario = findBladeScenario(label);
    if (!scenario) throw new Error(`no blade entry labelled "${label}"`);
    return scenario;
}

function position(label: string) {
    const scenario = scenarioNamed(label);
    const state = buildBladeState(scenario);
    const botId = seatPlayerId(state, scenario.bot);
    return { scenario, state, botId };
}

describe("greedyRootPick (issue #3393)", () => {
    it("is deterministic and picks from the search's own candidate set", () => {
        const { state, botId } = position(RICH);
        const a = greedyRootPick(state, botId, 7);
        const b = greedyRootPick(state, botId, 7);
        expect(a).not.toBeNull();
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        const keys = enumerateMoves(state, botId, {
            pruneDominatedNoOps: true,
        }).map((m) => JSON.stringify(m));
        expect(keys).toContain(JSON.stringify(a));
    });

    it("returns null when the player owes no decision", () => {
        const { state, botId } = position(RICH);
        const other = state.players.find((p) => p.id !== botId)!.id;
        expect(greedyRootPick(state, other, 1)).toBeNull();
    });
});

describe("greedy concordance in the telemetry record (issue #3393)", () => {
    it("carries greedy and chosen keys, and greedyAgrees is their equality", () => {
        const { state, botId } = position(RICH);
        const records: RootDecisionRecord[] = [];
        setRootDecisionSink((r) => records.push(r));
        let chosen;
        try {
            chosen = searchWithTrace(state, botId, { iterations: 30 }, 11).move;
        } finally {
            setRootDecisionSink(null);
        }
        expect(records).toHaveLength(1);
        const r = records[0];
        expect(typeof r.greedyMoveKey).toBe("string");
        expect(r.chosenMoveKey).toBe(JSON.stringify(chosen));
        expect(r.greedyAgrees).toBe(r.greedyMoveKey === r.chosenMoveKey);
        // The greedy key is the pick `greedyRootPick` makes on the same root
        // and seed — one policy, two entry points.
        expect(r.greedyMoveKey).toBe(
            JSON.stringify(greedyRootPick(state, botId, 11))
        );
        const summary = summarizeRootDecisions(records);
        expect(summary.greedyAgreeShare).toBe(r.greedyAgrees ? 1 : 0);
        expect(summary.greedyAgreeByMechanism[r.mechanism]).toEqual({
            agree: r.greedyAgrees ? 1 : 0,
            total: 1,
        });
    });

    it("the sink does not perturb the search's pick", () => {
        const { state, botId } = position(RICH);
        const plain = searchWithTrace(
            state,
            botId,
            { iterations: 30 },
            11
        ).move;
        setRootDecisionSink(() => {});
        let sunk;
        try {
            sunk = searchWithTrace(state, botId, { iterations: 30 }, 11).move;
        } finally {
            setRootDecisionSink(null);
        }
        expect(JSON.stringify(sunk)).toBe(JSON.stringify(plain));
    });

    it("summarize reports null agreement when no record carries it", () => {
        const summary = summarizeRootDecisions([]);
        expect(summary.greedyAgreeShare).toBeNull();
    });
});

describe('blade runner pick: "greedy" (issue #3393)', () => {
    it("answers every seed with exactly the greedyRootPick move, never the search's", () => {
        const scenario = scenarioNamed(SEARCH_ONLY);
        const result = runBladeScenario(scenario, null, "greedy");
        expect(result.seeds.length).toBeGreaterThan(0);
        for (const s of result.seeds) {
            const state = buildBladeState(scenario);
            const botId = seatPlayerId(state, scenario.bot);
            expect(s.move).not.toBeNull();
            expect(JSON.stringify(s.move)).toBe(
                JSON.stringify(greedyRootPick(state, botId, s.seed))
            );
        }
    });
});
