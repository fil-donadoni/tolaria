// A verdict recorded before a dominance proof existed names a move the proof
// now denies (issue #9956): still legal, no longer in the candidate set. The
// judgement about it stands, so it must still resolve — and a candidate that
// is not legal at all must still read as stale.

import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../../moves";
import { moveKey } from "../../search";
import { seatPlayerId } from "../blade/matcher";
import { resolveVerdictMoves } from "../verdicts/evalPairs";
import { buildVerdictState, candidateMoves } from "../verdicts/position";
import type { Verdict } from "../verdicts/types";

/** Unholy Heat with delirium off (2 damage) beside a 1/1, against a 4/4: the
 *  cast at the 4/4 is denied by the marked-damage proof. */
const SPEC: Verdict["spec"] = {
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        {
            name: "Mons's Goblin Raiders",
            owner: "me",
            zone: "battlefield",
            summoningSick: false,
        },
        { name: "Unholy Heat", owner: "me", zone: "hand" },
        {
            name: "Serra Angel",
            owner: "opp",
            zone: "battlefield",
            summoningSick: false,
        },
    ],
};

function verdictOver(keys: string[]): Verdict {
    return {
        id: "test:pruned-candidate",
        spec: SPEC,
        seat: "me",
        candidates: keys.map((key, i) => ({
            key,
            description: `candidate ${i}`,
        })),
        answer: { kind: "right", rightIndexes: [0] },
    } as Verdict;
}

describe("resolveVerdictMoves — a candidate a dominance proof denies (issue #9956)", () => {
    const state = buildVerdictState(verdictOver([]));
    const botId = seatPlayerId(state, "me");
    // What a verdict recorded before the proof would have been offered.
    const legal = enumerateMoves(state, botId, {
        collapseInterchangeable: true,
    });
    const offeredKeys = new Set(candidateMoves(state, botId).map(moveKey));
    const denied = legal.filter((m: Move) => !offeredKeys.has(moveKey(m)));

    it("is a position where the proof denies a legal cast", () => {
        expect(denied).toHaveLength(1);
        expect(denied[0].kind).toBe("cast-spell");
    });

    it("resolves every candidate, the denied one included", () => {
        const resolved = resolveVerdictMoves(
            verdictOver(legal.map(moveKey)),
            state,
            botId
        );
        expect("moves" in resolved && resolved.moves.map(moveKey)).toEqual(
            legal.map(moveKey)
        );
    });

    it("still reports a candidate that is not legal as stale", () => {
        const stale = JSON.stringify({
            kind: "cast-spell",
            cardInstanceId: "no-such-card",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        });
        const resolved = resolveVerdictMoves(
            verdictOver([moveKey(legal[0]), stale]),
            state,
            botId
        );
        expect(resolved).toEqual({
            error: "candidate no longer enumerated on the rebuilt position: candidate 1",
        });
    });
});
