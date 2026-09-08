// `$event.spell` — the SPELL_CAST cast-spell ref and `counter` by ref
// (issue #3206, ADR 0049).
//
// A triggered ability that counters the spell that triggered it announces NO
// target (CR 603.2 — a trigger's targets are chosen as it goes on the stack,
// and this one names none), so `counter`'s `EffectTargetRef` had nothing to
// point at: the spell exists only as a field of the firing event. `SPELL_CAST`
// now carries its `EVENT_FIELD_REGISTRY` rows, and `$event.spell` is the first
// `"stack-object"` field — neither a permanent (a battlefield recheck would
// reject every spell on the stack) nor a player.
//
// Driven through the REAL cast path (`tryAutoCommitPendingCast`, the function
// the `castSpell` mutation calls) so the trigger is collected and placed by the
// engine, not hand-built.

import { describe, it, expect } from "vitest";
import {
    activateAbilityOnState,
    finalizeTargetSelection,
    tryAutoCommitPendingCast,
} from "../../game";
import { getCardByName } from "../../cards";
import { resolveTopOfStack } from "../state";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const DECREE = getCardByName("Decree of Silence").id;
const COUNTERSPELL = getCardByName("Counterspell").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

/** p1 controls Decree of Silence with `depletion` counters already on it; p2
 *  is mid-cast of a Grizzly Bears, one commit away from the stack. */
function stateWithDecree(depletion = 0): GameState {
    const decree = makeInstance(DECREE, {
        id: "decree",
        controllerId: "p1",
        ownerId: "p1",
        ...(depletion > 0 ? { counters: { depletion } } : {}),
    });
    const bears = makeInstance(GRIZZLY_BEARS, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [decree] }),
            makePlayer("p2", {
                hand: [bears],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
            }),
        ],
        activePlayerId: "p2",
        priorityPlayerId: "p2",
        pendingCast: {
            playerId: "p2",
            cardInstanceId: "bears",
            manaCost: { G: 1, generic: 1 },
            tappedLandIds: [],
        },
    });
}

/** The head pending choice when it is the "you may" prompt. */
function mayPayHead(state: GameState) {
    const head = (state.pendingChoices ?? [])[0];
    return head?.kind === "may-pay" ? head : undefined;
}

function decreeOf(state: GameState) {
    return state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === "decree");
}

describe("Decree of Silence — counter the triggering spell (CR 601.2i / 701.6a)", () => {
    it("counters the opponent's spell and adds a depletion counter", () => {
        const state = stateWithDecree();
        tryAutoCommitPendingCast(state, "p2");
        // The spell and its cast trigger are both on the stack (CR 603.3).
        expect(state.stack.map((s) => s.id)).toContain("bears");
        expect(state.stack).toHaveLength(2);

        resolveTopOfStack(state); // the Decree trigger

        // CR 701.6a — the spell is off the stack, in its owner's graveyard.
        expect(state.stack.map((s) => s.id)).not.toContain("bears");
        expect(
            state.players.find((p) => p.id === "p2")!.graveyard.map((c) => c.id)
        ).toContain("bears");
        expect(decreeOf(state)?.counters?.depletion).toBe(1);
    });

    it("sacrifices itself on the THIRD depletion counter (CR 122.1 / 701.21a)", () => {
        const state = stateWithDecree(2);
        tryAutoCommitPendingCast(state, "p2");
        resolveTopOfStack(state);

        expect(decreeOf(state), "Decree sacrificed itself").toBeUndefined();
        expect(
            state.players.find((p) => p.id === "p1")!.graveyard.map((c) => c.id)
        ).toContain("decree");
        // The counter still happened — the sacrifice is the clause AFTER it.
        expect(state.stack.map((s) => s.id)).not.toContain("bears");
    });

    it("does NOT sacrifice on the second counter", () => {
        const state = stateWithDecree(1);
        tryAutoCommitPendingCast(state, "p2");
        resolveTopOfStack(state);
        expect(decreeOf(state)?.counters?.depletion).toBe(2);
    });

    it("skips cleanly when the spell already left the stack (CR 608.2b)", () => {
        const state = stateWithDecree();
        tryAutoCommitPendingCast(state, "p2");

        // p1 responds with a Counterspell aimed at the same spell, ON TOP of
        // Decree's trigger, and it resolves first — so by the time the trigger
        // resolves its `$event.spell` names nothing on the stack.
        pushSpell(state, COUNTERSPELL, "p1", [{ type: "spell", id: "bears" }]);
        resolveTopOfStack(state); // Counterspell
        expect(state.stack.map((s) => s.id)).not.toContain("bears");

        // A DECOY spell, put on the stack after the trigger was raised. It is
        // what makes this test discriminating: if `$event.spell` resolved to
        // nothing and `counter` simply never ran, the decoy survives — which is
        // the same observable outcome as a correct fizzle. So the assertion is
        // that the decoy is UNTOUCHED while the trigger's other clause DID
        // happen: the Op ran, resolved the ref, and fizzled inside
        // `ctx.counter` on a spell that had left, rather than countering
        // whatever else happened to be on the stack.
        pushSpell(state, GRIZZLY_BEARS, "p2");
        // Seat the decoy at the BOTTOM so the trigger is still what resolves
        // next (a second cast would raise a second Decree trigger and change
        // the position under test).
        const decoy = state.stack.pop()!;
        state.stack.unshift(decoy);

        // The trigger must not throw, and its OTHER clauses must still happen.
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(decreeOf(state)?.counters?.depletion).toBe(1);
        expect(
            state.stack.map((s) => s.id),
            "the fizzle countered NOTHING ELSE — a ref that resolved to nothing and an Op that never ran would leave the same board, so the decoy is what tells them apart"
        ).toEqual([decoy.id]);
    });

    it("does not fire on its OWN controller's spells (CR 603.2)", () => {
        // The same board with the seats swapped: the CASTER is the one who
        // controls Decree, so `casterId !== self.controllerId` is false.
        const decree = makeInstance(DECREE, {
            id: "decree",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bears = makeInstance(GRIZZLY_BEARS, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [decree],
                    hand: [bears],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
                }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            pendingCast: {
                playerId: "p2",
                cardInstanceId: "bears",
                manaCost: { G: 1, generic: 1 },
                tappedLandIds: [],
            },
        });
        tryAutoCommitPendingCast(state, "p2");

        // The spell is on the stack ALONE — no trigger above it, no counter
        // placed. The positive tests above prove the identical commit DOES
        // raise a trigger when the caster is an opponent, so this is a real
        // discriminating pair rather than a cast that silently failed.
        expect(state.stack.map((s) => s.id)).toEqual(["bears"]);
        expect(
            state.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === "decree")?.counters?.depletion
        ).toBeUndefined();
    });
});

// CR 702.29c — "When you cycle this card, you may counter target spell."
// Decree of Silence is the pool's FIRST shipped consumer of `cycledTrigger`,
// so this is also the first end-to-end exercise of the cycling-trigger seam.
describe("Decree of Silence — the cycling trigger (CR 702.29c)", () => {
    /** Decree in p1's hand with {4}{U}{U} floating, and an opponent spell on
     *  the stack for the trigger to target. */
    function cyclingState(): GameState {
        const decree = makeInstance(DECREE, {
            id: "decree",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [decree],
                    manaPool: { W: 0, U: 2, B: 0, R: 0, G: 0, C: 4 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        pushSpell(state, GRIZZLY_BEARS, "p2");
        return state;
    }

    /** Cycles Decree and gets its trigger onto the stack, targeting the spell
     *  already there. Returns the state, mid-flight. */
    function cycle(state: GameState): void {
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "decree",
            abilityId: "cycling",
        });
        // The cycling DRAW ability is on the stack; resolving it lets the
        // CARD_DISCARDED trigger (already collected) be placed.
        const pt = state.pendingTarget;
        if (pt) {
            pt.selected = [{ type: "spell", id: state.stack[0]!.id }];
            finalizeTargetSelection(state, pt, "p1");
        }
    }

    it("fires on the cycling discard and counters when the controller says yes", () => {
        const state = cyclingState();
        const spellId = state.stack[0]!.id;
        cycle(state);
        // Drain the stack down to the cycled trigger's own resolution, which
        // suspends on the "you may" prompt.
        for (let i = 0; i < 6 && !mayPayHead(state); i++) {
            if (state.stack.length === 0) break;
            resolveTopOfStack(state);
        }
        expect(
            mayPayHead(state),
            "the may-counter prompt is a real decision, not an auto-yes"
        ).toBeDefined();

        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.stack.map((s) => s.id)).not.toContain(spellId);
    });

    it("leaves the spell alone when the controller declines", () => {
        const state = cyclingState();
        const spellId = state.stack[0]!.id;
        cycle(state);
        for (let i = 0; i < 6 && !mayPayHead(state); i++) {
            if (state.stack.length === 0) break;
            resolveTopOfStack(state);
        }
        expect(mayPayHead(state)).toBeDefined();

        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.stack.map((s) => s.id)).toContain(spellId);
    });
});
