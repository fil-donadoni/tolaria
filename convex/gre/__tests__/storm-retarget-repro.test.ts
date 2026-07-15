// REPRO (user bug): "changing the copy's target to a different player than the
// previous one increases the number of storm copies." Drives the REAL
// solo-mode retarget flow — finalizeTargetSelection's copy-retarget branch
// (which the S5 test bypasses via applyCopyRetarget) + drainAutoPasses — and
// asserts the final copy count equals priorSpellCount regardless of target
// choices.
import { describe, it, expect } from "vitest";
import {
    makeState,
    makePlayer,
    makeInstance,
    pushSpell,
} from "../../cards/__tests__/setup";
import { emitSpellCastEvent, resolveTopOfStack } from "../state";
import { drainAutoPasses } from "../phases";
import { finalizeTargetSelection } from "../../game";
import { lightningBolt, grizzlyBears } from "../../cards/sets/lea";
import { brainFreeze } from "../../cards/sets/scg";
import type { GameState } from "../state";

function fillLibrary(count: number, controllerId: string) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `lib-${controllerId}-${i}`,
            controllerId,
            ownerId: controllerId,
            zone: "library",
        })
    );
}

/** Simulate the caster (p1, active player, holds priority after a retarget)
 *  pressing Pass so the storm trigger resolves its next copy. Solo mode: p2 is
 *  a standing auto-pass. */
function passToResolveTrigger(state: GameState): void {
    state.passCount = 1;
    state.priorityPlayerId = "p2";
    drainAutoPasses(state);
}

const STORM_TRIGGER_ID = "storm";
const triggerOnStack = (state: GameState) =>
    state.stack.some(
        (s) => s.triggeredAbilityId === STORM_TRIGGER_ID && s.stormSnapshot
    );

function setup(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { library: fillLibrary(40, "p1") }),
            makePlayer("p2", { library: fillLibrary(40, "p2") }),
        ],
    });
    // Three prior spells this turn -> priorSpellCount = 3 -> 3 copies.
    for (let i = 0; i < 3; i++) {
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        emitSpellCastEvent(state, bolt);
        resolveTopOfStack(state);
    }
    expect(state.spellsCastThisTurn).toBe(3);
    const bf = pushSpell(state, brainFreeze.id, "p1", [
        { type: "player", id: "p2" },
    ]);
    emitSpellCastEvent(state, bf); // priorSpellCount = 3
    state.autoPassPlayers = ["p2"]; // solo mode
    return state;
}

/** Answer the current copy-retarget prompt by choosing `pick` as the target. */
function answerRetarget(state: GameState, pick: string): void {
    const pt = state.pendingTarget!;
    pt.selected = [{ type: "player", id: pick }];
    finalizeTargetSelection(state, pt, "p1");
}

describe("Storm copy-retarget — copy count is bounded regardless of target choice", () => {
    /** Drive the trigger loop, recording every DISTINCT copy that gets offered
     *  a retarget prompt. Stops when the storm trigger has popped. */
    function driveAndCountPrompts(
        state: GameState,
        pick: (n: number) => string
    ): number {
        const prompted = new Set<string>();
        let n = 0;
        for (let guard = 0; guard < 40; guard++) {
            if (state.pendingTarget?.kind === "copy-retarget") {
                prompted.add(state.pendingTarget.cardInstanceId);
                answerRetarget(state, pick(n++));
                // p1 (active) now holds priority with the trigger still on top;
                // pass so the trigger resolves its next iteration (which may
                // set the next copy-retarget prompt).
                if (triggerOnStack(state)) passToResolveTrigger(state);
                continue;
            }
            if (triggerOnStack(state)) {
                resolveTopOfStack(state); // create the first copy + its prompt
                continue;
            }
            break;
        }
        return prompted.size;
    }

    it("SAME target every copy -> exactly 3 retarget prompts", () => {
        const state = setup();
        expect(driveAndCountPrompts(state, () => "p2")).toBe(3);
    });

    it("DIFFERENT target each copy -> still exactly 3 prompts (repro)", () => {
        const state = setup();
        const picks = ["p1", "p2", "p1", "p2", "p1", "p2"];
        expect(
            driveAndCountPrompts(state, (n) => picks[n % picks.length])
        ).toBe(3);
    });
});
