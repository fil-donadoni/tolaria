// The Wandering Emperor's instant-speed loyalty (issue #2606, CR 606.3 /
// 117.1a), the FULL PATH in one file: GRE state → wire (`projectPublicState`)
// → the client's real reducer (`buildTriggerStateView` with its `turnState`)
// → the ability menu (`getStackAbilities`) → the mutation core
// (`activateAbilityOnState`, `convex/game.ts`).
//
// The permission is conditional on "entered this turn", which the client can
// only answer from the turn-scoped `enteredThisTurn` row the reducer fills off
// the wire `enteredOnTurn` + `GameState.turn`. A dropped field anywhere on that
// path leaves the ability server-legal and UI-dead — the bug class
// `.claude/rules/gre-development.md` § Frontend wiring analysis names — so
// every assertion goes through the real projection, never a hand-built view.
import { describe, it, expect } from "vitest";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import type { GameState } from "@convex/gre/state";
import type { Phase } from "@convex/gre/types";
import { activateAbilityOnState } from "@convex/game";
import { theWanderingEmperor } from "@convex/cards/sets/neo/white.cards";
import { lilianaOfTheVeil } from "@convex/cards/sets/isd/black.cards";
import {
    grizzlyBears,
    lightningBolt,
} from "@convex/cards/sets/lea/index.cards";

const EMPEROR = theWanderingEmperor();
const PLUS_ONE = "the-wandering-emperor-plus1";
const MINUS_ONE = "the-wandering-emperor-minus1";

/** Game turn 6, p2 (the opponent) attacking — p1 holds priority with a
 *  Lightning Bolt on the stack: not p1's turn, not a main phase, stack not
 *  empty. The walker entered on `enteredOnTurn`. */
function board(opts: {
    cardId?: string;
    enteredOnTurn: number;
    phase?: Phase;
}): GameState {
    const state = makeState({
        turn: 6,
        phase: opts.phase ?? "DECLARE_BLOCKERS",
        activePlayerId: "p2",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(opts.cardId ?? EMPEROR.id, {
                        id: "pw",
                        controllerId: "p1",
                        ownerId: "p1",
                        counters: { loyalty: 3 },
                        enteredOnTurn: opts.enteredOnTurn,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "bear",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: true,
                    }),
                ],
            }),
        ],
    });
    pushSpell(state, lightningBolt().id, "p2");
    return state;
}

/** The ability ids p1's menu offers on `pw`, through the real wire + reducer,
 *  exactly as `useBattlefieldInteraction` builds its `abilityStateView`. */
function offered(state: GameState): string[] {
    const projected = projectPublicState(state, 1, "p1");
    const players = projected.players as unknown as Player[];
    const all = players.map((p) => ({
        id: p.id,
        life: p.life,
        hand: [],
        battlefield: p.battlefield as unknown as CardInstance[],
        graveyard: [],
    }));
    const view = buildTriggerStateView(
        all,
        projected.activePlayerId,
        undefined,
        undefined,
        {
            turn: projected.turn,
            controlChangedThisTurn: projected.controlChangedThisTurn,
        }
    );
    const pw = all[0].battlefield.find((c) => c.id === "pw")!;
    return getStackAbilities(pw, projected.phase as Phase, true, view, 20).map(
        (a) => a.id
    );
}

describe("The Wandering Emperor — instant-speed loyalty, GRE → wire → UI → game.ts (CR 606.3 / 117.1a)", () => {
    it("is OFFERED and ACCEPTED on the opponent's turn, in combat, over a non-empty stack, the turn she entered", () => {
        const state = board({ enteredOnTurn: 6 });
        expect(state.stack).toHaveLength(1);

        const ids = offered(state);
        expect(ids).toContain(PLUS_ONE);
        expect(ids).toContain(MINUS_ONE);

        // The server agrees: the −1 (no target) goes on the stack over the
        // Bolt, and CR 606.4's cost is paid on activation, not on resolution.
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "pw",
            abilityId: MINUS_ONE,
        });
        expect(state.stack).toHaveLength(2);
        expect(state.stack[1].abilityId).toBe(MINUS_ONE);
        const pw = state.players[0].battlefield.find((c) => c.id === "pw")!;
        expect(pw.counters?.loyalty).toBe(2);
        expect(pw.loyaltyActivationsThisTurn).toBe(1);

        // CR 606.3's allowance still holds: the menu and the mutation both
        // refuse the second activation this turn. This harness drives the
        // mutation core directly and runs no priority loop (as
        // `convex/__tests__/loyaltyActivationFullPath.test.ts` does), so
        // CR 117.3c's hand-back to the activator is done here.
        state.priorityPlayerId = "p1";
        expect(offered(state)).not.toContain(PLUS_ONE);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "pw",
                abilityId: PLUS_ONE,
            })
        ).toThrow(/already been activated/);
    });

    it("is HIDDEN and REJECTED the turn after she entered — the permission lapsed", () => {
        const state = board({ enteredOnTurn: 5 });
        expect(offered(state)).not.toContain(PLUS_ONE);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "pw",
                abilityId: MINUS_ONE,
            })
        ).toThrow(/sorcery speed/);
    });

    it("REGRESSION — a planeswalker without the grant stays hidden off its controller's main phase", () => {
        const state = board({
            cardId: lilianaOfTheVeil().id,
            enteredOnTurn: 6,
        });
        expect(offered(state)).toEqual([]);
    });
});
