// The sorcery window on the ability menu (issue #10318, CR 307.1 / 606.3 /
// 602.5d), the FULL PATH: GRE state → wire (`projectPublicState`) → the
// client's real reducer (`buildTriggerStateView` with its `turnWindow`) → the
// ability menu (`getStackAbilities`) → the mutation core
// (`activateAbilityOnState`, `convex/game.ts`).
//
// A loyalty ability (CR 606.3) and an "activate only as a sorcery" one
// (CR 602.5d) are open only while the stack is empty and their controller holds
// priority. The menu used to narrow that to "own turn + main phase", so it
// offered both with a spell on the stack and the click died as an opaque
// "Server Error". Every assertion goes through the real projection.
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
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
import { LOYALTY_VIOLATION_MESSAGE } from "@convex/gre/loyalty";
import { lilianaOfTheVeil } from "@convex/cards/sets/isd/black.cards";
import { dauthiVoidwalker } from "@convex/cards/sets/mh2/black.cards";
import { theWanderingEmperor } from "@convex/cards/sets/neo/white.cards";
import { tranquility } from "@convex/cards/sets/lea/index.cards";

const LILIANA_PLUS = "liliana-veil-plus1";
const LILIANA_MINUS = "liliana-veil-minus2";
const DAUTHI_ABILITY = "dauthi-voidwalker-cast";
const EMPEROR_PLUS = "the-wandering-emperor-plus1";

/** Turn 5, p1's precombat main. p1 controls Liliana of the Veil (loyalty 5),
 *  Dauthi Voidwalker (no summoning sickness) and, optionally, The Wandering
 *  Emperor (entered this turn — her instant-timing grant is live). */
function board(opts: {
    spellOnStack: boolean;
    priorityPlayerId?: string;
}): GameState {
    const state = makeState({
        turn: 5,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: opts.priorityPlayerId ?? "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(lilianaOfTheVeil().id, {
                        id: "liliana",
                        controllerId: "p1",
                        ownerId: "p1",
                        counters: { loyalty: 5 },
                        enteredOnTurn: 3,
                    }),
                    makeInstance(dauthiVoidwalker().id, {
                        id: "dauthi",
                        controllerId: "p1",
                        ownerId: "p1",
                        enteredOnTurn: 3,
                    }),
                    makeInstance(theWanderingEmperor().id, {
                        id: "emperor",
                        controllerId: "p1",
                        ownerId: "p1",
                        counters: { loyalty: 3 },
                        enteredOnTurn: 5,
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    // The controller's own sorcery, waiting on the stack (the repro).
    if (opts.spellOnStack) pushSpell(state, tranquility().id, "p1");
    return state;
}

/** The ability ids p1's menu offers on `instanceId`, through the real wire and
 *  reducer, exactly as `useBattlefieldInteraction` builds `abilityStateView`. */
function offered(state: GameState, instanceId: string): string[] {
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
        },
        undefined,
        undefined,
        {
            stack: projected.stack,
            priorityPlayerId: projected.priorityPlayerId,
        }
    );
    const card = all[0].battlefield.find((c) => c.id === instanceId)!;
    return getStackAbilities(
        card,
        projected.phase as Phase,
        true,
        view,
        20
    ).map((a) => a.id);
}

describe("sorcery-timing abilities on the ability menu, GRE → wire → UI → game.ts (issue #10318, CR 606.3 / 602.5d)", () => {
    it("a loyalty ability is HIDDEN while the controller's own spell is on the stack", () => {
        const state = board({ spellOnStack: true });
        expect(state.stack).toHaveLength(1);
        const ids = offered(state, "liliana");
        expect(ids).not.toContain(LILIANA_PLUS);
        expect(ids).not.toContain(LILIANA_MINUS);
    });

    it("an 'activate only as a sorcery' ability is HIDDEN while the stack is non-empty", () => {
        const state = board({ spellOnStack: true });
        expect(offered(state, "dauthi")).not.toContain(DAUTHI_ABILITY);
    });

    it("both are HIDDEN when the controller does not hold priority, even with an empty stack", () => {
        const state = board({ spellOnStack: false, priorityPlayerId: "p2" });
        expect(offered(state, "liliana")).not.toContain(LILIANA_PLUS);
        expect(offered(state, "dauthi")).not.toContain(DAUTHI_ABILITY);
    });

    it("both are OFFERED with an empty stack in the controller's main phase while they hold priority", () => {
        const state = board({ spellOnStack: false });
        const lilianaIds = offered(state, "liliana");
        expect(lilianaIds).toContain(LILIANA_PLUS);
        expect(lilianaIds).toContain(LILIANA_MINUS);
        expect(offered(state, "dauthi")).toContain(DAUTHI_ABILITY);
    });

    it("an instant-timing loyalty grant stays OFFERED over a non-empty stack (The Wandering Emperor)", () => {
        const state = board({ spellOnStack: true });
        expect(offered(state, "emperor")).toContain(EMPEROR_PLUS);
    });

    it("the server rejects the loyalty activation with a readable ConvexError and leaves the state unchanged", () => {
        const state = board({ spellOnStack: true });
        const before = JSON.stringify(state);
        let thrown: unknown;
        try {
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "liliana",
                abilityId: LILIANA_PLUS,
            });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(ConvexError);
        expect((thrown as ConvexError<string>).data).toBe(
            LOYALTY_VIOLATION_MESSAGE.timing
        );
        expect(JSON.stringify(state)).toBe(before);
    });

    it("the server rejects the sorcery-speed activation with a readable ConvexError", () => {
        const state = board({ spellOnStack: true });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "dauthi",
                abilityId: DAUTHI_ABILITY,
            })
        ).toThrow(ConvexError);
    });
});
