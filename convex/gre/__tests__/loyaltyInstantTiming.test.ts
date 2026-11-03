// CR 606.3 timing override — "you may activate her loyalty abilities any time
// you could cast an instant" (issue #2606, The Wandering Emperor).
//
// CR 606.3's window is "any time they have priority and the stack is empty
// during a main phase of their turn". A `loyalty-activation-timing` static on
// the permanent widens it to CR 117.1a's instant window ("any time they have
// priority"), conditionally on "entered this turn" (CR 400.7). The allowance
// half of CR 606.3 (one activation per permanent per turn) is NOT widened.
//
// Every case runs through the shared CR 606 authority
// (`loyaltyActivationViolation`) — the predicate the mutation's
// `assertLoyaltyActivationLegal`, the bot's enumerator and the search's cost
// payer all read.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import type { Phase } from "../types";
import { loyaltyActivationViolation } from "../loyalty";
import { theWanderingEmperor } from "../../cards/sets/neo/white.cards";
import { lilianaOfTheVeil } from "../../cards/sets/isd/black.cards";
import { lightningBolt } from "../../cards/sets/lea/red.cards";

const EMPEROR = theWanderingEmperor().id;
const LILIANA = lilianaOfTheVeil().id;
const PLUS_ONE = { cost: { loyalty: 1 } };
const MINUS_TWO = { cost: { loyalty: -2 } };

/** p1 controls `cardId` (entered on `enteredOnTurn`); the game is on turn 4,
 *  `activePlayerId`'s `phase`, p1 holding priority unless told otherwise. */
function position(opts: {
    cardId?: string;
    enteredOnTurn?: number;
    activePlayerId?: string;
    phase?: Phase;
    priorityPlayerId?: string;
    nonEmptyStack?: boolean;
    used?: number;
}): { state: GameState; pw: CardInstanceState } {
    const pw = makeInstance(opts.cardId ?? EMPEROR, {
        id: "pw",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty: 3 },
        ...(opts.enteredOnTurn !== undefined
            ? { enteredOnTurn: opts.enteredOnTurn }
            : {}),
        ...(opts.used ? { loyaltyActivationsThisTurn: opts.used } : {}),
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [pw] }), makePlayer("p2")],
        turn: 4,
        phase: opts.phase ?? "DECLARE_ATTACKERS",
        activePlayerId: opts.activePlayerId ?? "p2",
        priorityPlayerId: opts.priorityPlayerId ?? "p1",
        stack: [],
    });
    if (opts.nonEmptyStack) pushSpell(state, lightningBolt().id, "p2");
    return { state, pw };
}

describe("loyalty-activation-timing — instant-speed loyalty (CR 606.3 / 117.1a, issue #2606)", () => {
    it("activates on an OPPONENT's turn, in COMBAT, with a NON-EMPTY stack, the turn she entered", () => {
        const { state, pw } = position({
            enteredOnTurn: 4,
            nonEmptyStack: true,
        });
        expect(state.stack.length).toBe(1);
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBeNull();
        expect(loyaltyActivationViolation(state, pw, MINUS_TWO)).toBeNull();
    });

    it("activates in the controller's own end step (not a main phase) the turn she entered", () => {
        const { state, pw } = position({
            enteredOnTurn: 4,
            activePlayerId: "p1",
            phase: "END_STEP",
        });
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBeNull();
    });

    it("still needs PRIORITY — CR 117.1a's instant window is 'any time they have priority'", () => {
        const { state, pw } = position({
            enteredOnTurn: 4,
            priorityPlayerId: "p2",
        });
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBe("timing");
    });

    it("keeps CR 606.3's once-per-turn allowance — instant speed is not a second activation", () => {
        const { state, pw } = position({ enteredOnTurn: 4, used: 1 });
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBe(
            "already-activated"
        );
    });

    it("keeps CR 606.6 — a −N still needs the loyalty at activation time", () => {
        const { state, pw } = position({ enteredOnTurn: 4 });
        pw.counters = { loyalty: 1 };
        expect(loyaltyActivationViolation(state, pw, MINUS_TWO)).toBe(
            "insufficient-loyalty"
        );
    });

    it("LAPSES the turn after she entered — the permanent stays, the permission does not", () => {
        const { state, pw } = position({ enteredOnTurn: 3 });
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBe("timing");
    });

    it("after the lapse, CR 606.3's printed window still applies (own main phase, empty stack)", () => {
        const { state, pw } = position({
            enteredOnTurn: 3,
            activePlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBeNull();
    });

    it("REGRESSION — a planeswalker WITHOUT the grant is held to CR 606.3 exactly, even the turn it entered", () => {
        const { state, pw } = position({ cardId: LILIANA, enteredOnTurn: 4 });
        expect(loyaltyActivationViolation(state, pw, PLUS_ONE)).toBe("timing");
    });

    it("the 'entered this turn' stamp is the one ETB writes — cast with flash on the opponent's turn, then activate", () => {
        // No hand-stamped `enteredOnTurn`: the permission must be met by the
        // stamp the engine itself writes when the spell resolves (CR 400.7).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            turn: 4,
            phase: "END_STEP",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            stack: [],
        });
        pushSpell(state, EMPEROR, "p1");
        resolveTopOfStack(state);
        state.priorityPlayerId = "p1";
        const pw = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === EMPEROR
        );
        expect(pw).toBeDefined();
        expect(pw!.counters?.loyalty).toBe(3);
        expect(loyaltyActivationViolation(state, pw!, PLUS_ONE)).toBeNull();
        // Next turn: same permanent, same position — the grant has lapsed.
        state.turn = 5;
        expect(loyaltyActivationViolation(state, pw!, PLUS_ONE)).toBe("timing");
    });
});
