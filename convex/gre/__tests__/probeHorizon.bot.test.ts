// The Eval Pair bridge reads both leaves of a pair at ONE game horizon
// (issue #7745). From a priority window where `pass` ends the step (the
// other seat's pass banked, the stack empty — CR 117.4), the `pass` leaf is
// scored in the next step; an activation's leaf, its own announcement
// resolved, is carried on by both seats passing to that same step (CR 117.3b
// → 117.4), so a step change's reading — a declared lethal swing — lands on
// both leaves or on neither.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { candidateFeatures } from "../ai/verdicts/evalPairs";
import { terminalMagnitude } from "../ai/evalWeights";
import { passEndsStep } from "../search";
import type { ManaTap, Move } from "../moves";
import type { CardInstanceState, GameState } from "../state";

const VILLAGE = getCardByName("Treetop Village").id;
const FOREST = getCardByName("Forest").id;
const ANGEL = getCardByName("Serra Angel").id;

function card(
    cardId: string,
    id: string,
    controller: "p1" | "p2"
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId: controller,
        ownerId: controller,
        id,
        isSummoningSick: false,
        isTapped: false,
    });
}

const ANIMATE: Move = {
    kind: "activate-ability",
    cardInstanceId: "village",
    abilityId: "treetop-village-animate",
    targets: [],
    confirmTargets: false,
    tapPlan: [
        { cardInstanceId: "forest-1" },
        { cardInstanceId: "forest-2" },
    ] satisfies ManaTap[],
};

/** p2 attacks p1 (4 life) with Serra Angel; p2 passed, p1 holds priority. */
function lethalFlyer(): GameState {
    const angel = card(ANGEL, "angel", "p2");
    angel.isTapped = true;
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p2",
        priorityPlayerId: "p1",
        passCount: 1,
        players: [
            makePlayer("p1", {
                life: 4,
                battlefield: [
                    card(VILLAGE, "village", "p1"),
                    card(FOREST, "forest-1", "p1"),
                    card(FOREST, "forest-2", "p1"),
                ],
            }),
            makePlayer("p2", { battlefield: [angel] }),
        ],
        combat: {
            attackerIds: ["angel"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

describe("1-ply Eval Pair probe — both leaves at the pass leaf's horizon (CR 117.4)", () => {
    it("the window is one where pass ends the step", () => {
        expect(passEndsStep(lethalFlyer(), "p1")).toBe(true);
    });

    it("does NOT read a terminal gap between pass and an animation that cannot block the flyer", () => {
        const state = lethalFlyer();
        const pass = candidateFeatures(state, "p1", { kind: "pass" });
        const animate = candidateFeatures(state, "p1", ANIMATE);
        // Both leaves face the same unblockable lethal swing: whatever the
        // two differ by is material, never a `winScore` on one side alone.
        expect(Math.abs(pass.policyValue - animate.policyValue)).toBeLessThan(
            terminalMagnitude()
        );
    });
});
