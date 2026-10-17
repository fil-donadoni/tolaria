// Pass Until Action (issue #5782) — the soft rest-of-turn pass that stops on
// the opponent's next spell or ability.
//
//   CR 113.8  The controller of an activated ability on the stack is the
//             player who activated it. The controller of a triggered ability
//             on the stack (other than a delayed triggered ability) is the
//             player who controlled the ability's source when it triggered.
//   CR 605.3b An activated mana ability doesn't go on the stack.
//   CR 117.3c If a player has priority when they cast a spell, activate an
//             ability, or take a special action, that player receives
//             priority afterward.
//
// Every opponent action below is driven through the production tail: the cast
// / activation seams leave the actor holding priority (CR 117.3c) with
// `singleShotAutoPass` set to them, then call `drainAutoPasses` — so the
// opponent's pass and the stop are both the engine's, never a hand-rolled
// mirror of a mutation body.

import { describe, it, expect } from "vitest";
import { drainAutoPasses } from "../phases";
import type { GameState, StackItem } from "../state";
import {
    armPassUntilAction,
    clearPassUntilAction,
    consumePassUntilActionStop,
    isPassingUntilAction,
    queuePassUntilAction,
} from "../passUntilAction";
import {
    makeInstance,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";

const INSTANT = getCardByName("Giant Growth").id;
const BREACH = getCardByName("Underworld Breach").id;

const A = "p1";
const B = "p2";

/** B holds priority with nothing new done; B now casts an instant — the cast
 *  tail leaves B with priority and a single-shot pass, then drains. */
function opponentCasts(state: GameState): StackItem {
    expect(state.priorityPlayerId).toBe(B);
    const item = pushSpell(state, INSTANT, B);
    state.passCount = 0;
    state.singleShotAutoPass = B;
    drainAutoPasses(state);
    return item;
}

/** A in their precombat main, empty stack, armed; the drain passes for A and
 *  priority parks on B (who is not auto-passing). */
function armedInMain(): GameState {
    const state = makeState({ phase: "PRECOMBAT_MAIN" });
    armPassUntilAction(state, A);
    drainAutoPasses(state);
    return state;
}

describe("Pass Until Action — stop on a new opponent object (CR 113.8, issue #5782)", () => {
    it("passes for the player until the opponent casts, then stops with the spell still on the stack", () => {
        const state = armedInMain();
        // A's pass happened on A's behalf; B now holds priority, intent armed.
        expect(state.priorityPlayerId).toBe(B);
        expect(state.passCount).toBe(1);
        expect(isPassingUntilAction(state, A)).toBe(true);

        const instant = opponentCasts(state);

        // B's single-shot pass hands priority to A — and the drain STOPS there.
        expect(state.priorityPlayerId).toBe(A);
        expect(state.stack.map((s) => s.id)).toEqual([instant.id]);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        // Consumed: A is back to manual priority.
        expect(state.passUntilAction).toBeUndefined();
    });

    it("an opponent's non-mana activated ability stops the drain", () => {
        const state = armedInMain();
        const source = makeInstance(getCardByName("Prodigal Sorcerer").id, {
            controllerId: B,
        });
        state.players[1].battlefield.push(source);
        state.stack.push({
            ...source,
            id: "ability-1",
            zone: "stack",
            castById: B,
            abilityId: "prodigal-sorcerer-ping",
            targets: [],
        });
        state.passCount = 0;
        state.singleShotAutoPass = B;
        drainAutoPasses(state);

        expect(state.priorityPlayerId).toBe(A);
        expect(state.stack).toHaveLength(1);
        expect(state.passUntilAction).toBeUndefined();
    });

    it("an opponent mana ability (CR 605.3b, no stack object) does not stop it", () => {
        const state = armedInMain();
        // A mana ability resolves immediately: B's pool fills, nothing is put
        // on the stack, and B passes.
        state.players[1].manaPool.G += 1;
        state.singleShotAutoPass = B;
        drainAutoPasses(state);

        // Both passed in succession on an empty stack → the step ended, and
        // the drain kept passing for A in the next one.
        expect(state.phase).not.toBe("PRECOMBAT_MAIN");
        expect(state.priorityPlayerId).toBe(B);
        expect(isPassingUntilAction(state, A)).toBe(true);
    });

    it("an opponent-controlled trigger stops it; a trigger the player controls does not", () => {
        // B controls Underworld Breach: "At the beginning of the end step" is
        // unqualified, so it triggers in A's end step — controlled by B.
        const opp = makeState({ phase: "POSTCOMBAT_MAIN" });
        opp.players[1].battlefield.push(
            makeInstance(BREACH, { controllerId: B })
        );
        opp.autoPassPlayers = [B];
        armPassUntilAction(opp, A);
        drainAutoPasses(opp);

        expect(opp.phase).toBe("END_STEP");
        expect(opp.priorityPlayerId).toBe(A);
        expect(opp.stack).toHaveLength(1);
        expect(opp.stack[0].castById).toBe(B);
        expect(opp.passUntilAction).toBeUndefined();

        // Same board, but A controls the Breach: A's own trigger resolves on
        // A's behalf and the turn advances.
        const own = makeState({ phase: "POSTCOMBAT_MAIN" });
        own.players[0].battlefield.push(
            makeInstance(BREACH, { controllerId: A })
        );
        own.autoPassPlayers = [B];
        armPassUntilAction(own, A);
        drainAutoPasses(own);

        expect(own.turn).toBe(2);
        expect(own.stack).toHaveLength(0);
        expect(own.players[0].battlefield).toHaveLength(0);
        // Cleared at turn advance, like Pass Turn.
        expect(own.passUntilAction).toBeUndefined();
    });

    it("an object already on the stack when armed resolves without a stop", () => {
        // B cast an instant and passed; A holds priority facing it.
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        pushSpell(state, INSTANT, B);
        state.passCount = 1;
        state.priorityPlayerId = A;

        armPassUntilAction(state, A);
        drainAutoPasses(state);

        // A's pass was the second consecutive one: the instant resolved. CR
        // 117.3b — priority returned to A (active), who passed again.
        expect(state.stack).toHaveLength(0);
        expect(state.priorityPlayerId).toBe(B);
        expect(isPassingUntilAction(state, A)).toBe(true);
    });

    it("a second activation of a baseline source stops it, though both items carry the source's id", () => {
        // Production stack items for an activated ability keep the SOURCE's
        // id (`buildActivatedAbilityStackItem`), so the baseline cannot be a
        // plain id set.
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        const source = makeInstance(getCardByName("Prodigal Sorcerer").id, {
            id: "sorcerer",
            controllerId: B,
        });
        state.players[1].battlefield.push(source);
        const activation = (): StackItem => ({
            ...source,
            zone: "stack",
            castById: B,
            abilityId: "prodigal-sorcerer-ping",
            targets: [],
        });
        state.stack.push(activation());
        // B activated and passed; A faces it and arms.
        state.passCount = 1;
        state.priorityPlayerId = A;
        armPassUntilAction(state, A);
        // A's pass alone does not resolve it here: B gets priority again.
        state.passCount = 0;
        drainAutoPasses(state);
        expect(state.priorityPlayerId).toBe(B);
        expect(state.stack).toHaveLength(1);

        // B activates the same source again (same id) and passes.
        state.stack.push(activation());
        state.passCount = 0;
        state.singleShotAutoPass = B;
        drainAutoPasses(state);

        expect(state.priorityPlayerId).toBe(A);
        expect(state.stack).toHaveLength(2);
        expect(state.passUntilAction).toBeUndefined();
    });

    it("an id that left the stack never shields a new object reusing it", () => {
        // A arms facing B's spell X; it resolves; B then puts a new object on
        // the stack with X's id (the permanent's ability, a recast).
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        const spell = pushSpell(state, INSTANT, B);
        state.passCount = 1;
        state.priorityPlayerId = A;
        armPassUntilAction(state, A);
        drainAutoPasses(state);
        expect(state.stack).toHaveLength(0);
        expect(state.priorityPlayerId).toBe(B);
        expect(state.passUntilAction?.[0].ignoredStackIds).toEqual([]);

        const reused = pushSpell(state, INSTANT, B);
        reused.id = spell.id;
        state.passCount = 0;
        state.singleShotAutoPass = B;
        drainAutoPasses(state);

        expect(state.priorityPlayerId).toBe(A);
        expect(state.stack.map((s) => s.id)).toEqual([spell.id]);
        expect(state.passUntilAction).toBeUndefined();
    });

    it("a stop clears a single-shot pass parked for the stopped seat", () => {
        const state = armedInMain();
        pushSpell(state, INSTANT, B);
        state.passCount = 0;
        state.singleShotAutoPass = A;
        state.priorityPlayerId = A;
        drainAutoPasses(state);

        expect(state.priorityPlayerId).toBe(A);
        expect(state.passUntilAction).toBeUndefined();
        expect(state.singleShotAutoPass).toBeUndefined();
    });

    it("the player's own spell never stops it", () => {
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        armPassUntilAction(state, A);
        pushSpell(state, INSTANT, A);
        expect(consumePassUntilActionStop(state, A)).toBe(false);
        expect(isPassingUntilAction(state, A)).toBe(true);
    });
});

describe("Pass Until Action — behaves as Pass Turn when nothing happens (issue #5782)", () => {
    it("advances the turn exactly like Pass Turn and is cleared at turn advance", () => {
        const soft = makeState({ phase: "PRECOMBAT_MAIN" });
        soft.autoPassPlayers = [B];
        armPassUntilAction(soft, A);
        drainAutoPasses(soft);

        const hard = makeState({ phase: "PRECOMBAT_MAIN" });
        hard.autoPassPlayers = [B, A];
        drainAutoPasses(hard);

        expect(soft.turn).toBe(2);
        expect(soft.turn).toBe(hard.turn);
        expect(soft.phase).toBe(hard.phase);
        expect(soft.priorityPlayerId).toBe(hard.priorityPlayerId);
        expect(soft.passUntilAction).toBeUndefined();
    });
});

describe("Pass Until Action — inherited safety halts (issue #5782)", () => {
    it("never skips the defender's declare-blockers decision (CR 509.1)", () => {
        const bears = getCardByName("Grizzly Bears").id;
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["attacker"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        state.players[0].battlefield.push(
            makeInstance(bears, { id: "attacker", isAttacking: true })
        );
        state.players[1].battlefield.push(
            makeInstance(bears, { id: "blocker", controllerId: B })
        );
        state.autoPassPlayers = [A];
        armPassUntilAction(state, B);
        drainAutoPasses(state);

        expect(state.phase).toBe("DECLARE_BLOCKERS");
        expect(state.priorityPlayerId).toBe(B);
        expect(state.combat?.blockersConfirmed).toBe(false);
        // The intent survives the halt: it resumes once blockers are confirmed.
        expect(isPassingUntilAction(state, B)).toBe(true);
    });

    it("never passes over an owed pending choice", () => {
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.pendingTarget = {
            playerId: A,
            stackItemId: "x",
        } as unknown as GameState["pendingTarget"];
        armPassUntilAction(state, A);
        drainAutoPasses(state);

        expect(state.priorityPlayerId).toBe(A);
        expect(state.passCount).toBe(0);
        expect(isPassingUntilAction(state, A)).toBe(true);
    });
});

describe("Pass Until Action — queued and cancelled (issue #5782)", () => {
    it("queued without priority, promoted when priority arrives, then stops on a later opponent cast", () => {
        // A passed manually; B holds priority in A's main. A presses now.
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.priorityPlayerId = B;
        state.passCount = 1;
        queuePassUntilAction(state, A);
        expect(state.queuedPassUntilAction).toEqual([
            { playerId: A, ignoredStackIds: [] },
        ]);
        expect(isPassingUntilAction(state, A)).toBe(false);

        // B passes: the step ends, A gets priority in the next one → promoted,
        // and the drain passes for A until B holds priority again.
        state.singleShotAutoPass = B;
        drainAutoPasses(state);
        expect(state.phase).toBe("BEGINNING_OF_COMBAT");
        expect(state.priorityPlayerId).toBe(B);
        expect(state.queuedPassUntilAction).toBeUndefined();
        expect(isPassingUntilAction(state, A)).toBe(true);

        const instant = opponentCasts(state);
        expect(state.priorityPlayerId).toBe(A);
        expect(state.stack.map((s) => s.id)).toEqual([instant.id]);
        expect(state.passUntilAction).toBeUndefined();
    });

    it("cancel clears both the armed and the queued form without moving priority", () => {
        const state = makeState({ phase: "PRECOMBAT_MAIN" });
        state.priorityPlayerId = B;
        armPassUntilAction(state, A);
        queuePassUntilAction(state, A);

        expect(clearPassUntilAction(state, A)).toBe(true);
        expect(state.passUntilAction).toBeUndefined();
        expect(state.queuedPassUntilAction).toBeUndefined();
        expect(state.priorityPlayerId).toBe(B);
        expect(clearPassUntilAction(state, A)).toBe(false);
    });
});
