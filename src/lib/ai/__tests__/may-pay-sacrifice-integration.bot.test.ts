// Integration: a may-pay sacrifice cost with a REAL victim choice across the
// GRE → game.ts → driver boundary (issue #940). CR 701.21a — the payer chooses
// which permanent to sacrifice. The bot/solo driver must supply a legal pick so
// a vs-AI / solo game never stalls on the choice.
//
// Witherbloom Charm mode 1 ("You may sacrifice a permanent. If you do, draw two
// cards.") with TWO sacrificeable permanents exercises the pick path: the
// may-pay choice lights up the battlefield, the brain surfaces the sacrifice
// count + candidates, and the executor threads a chosen victim id through the
// SAME `submitMayPay` mutation surface a human's Pay button drives.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p2";
const HUMAN = "u1-p1";
const WITHERBLOOM_CHARM = getCardByName("Witherbloom Charm").id;
// A NON-creature artifact (Black Lotus, mv 0) so an unrelated SBA can't destroy
// it and mask the sacrifice pick.
const ARTIFACT = "b0faa7f2-b547-42c4-a810-839da50dadfe";

/** Fake mutation surface routing `submitMayPay` (with its sacrifice pick) through
 *  the SAME engine primitive the real `game.ts` mutation calls. Every other
 *  mutation is unexpected in this flow and throws. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in may-pay sacrifice flow");
    };
    return {
        playCard: reject,
        summonCompanion: reject,
        turnPermanentFaceUp: reject,
        announceCast: reject,
        selectTarget: reject,
        selectTargets: reject,
        confirmTargets: reject,
        tapForPayment: reject,
        activateAbility: reject,
        tapForActivationPayment: reject,
        selectSacrifice: reject,
        selectActivationCost: reject,
        selectActivationExileCost: reject,
        selectActivationDiscardCost: reject,
        toggleAttacker: reject,
        confirmAttackers: reject,
        selectBlocker: reject,
        assignBlockerTarget: reject,
        confirmBlockers: reject,
        confirmDamage: reject,
        declareMulligan: reject,
        submitResolutionChoice: reject,
        submitMayPay: async ({ playerId, accept, sacrificeIds }) => {
            applyMayPaySubmit(state, { playerId, accept, sacrificeIds });
        },
        submitMadnessDecline: reject,
        submitReboundDecline: reject,
        submitDrawReplacementPay: reject,
        submitLandEntryChoice: reject,
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
}

/** Seed a suspended Witherbloom Charm may-pay with two sacrificeable artifacts
 *  the BOT controls. */
function seedTwoFodder(): GameState {
    const keep = makeInstance(ARTIFACT, {
        id: "keep",
        controllerId: BOT,
        ownerId: BOT,
    });
    const victim = makeInstance(ARTIFACT, {
        id: "victim",
        controllerId: BOT,
        ownerId: BOT,
    });
    const lib = [0, 1].map((i) =>
        makeInstance(ARTIFACT, {
            id: `lib${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, {
                battlefield: [keep, victim],
                library: lib,
                life: 20,
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    const item = pushSpell(state, WITHERBLOOM_CHARM, BOT);
    item.chosenModeId = "sacrifice-draw";
    resolveTopOfStack(state); // suspend on the may-pay pick
    return state;
}

describe("may-pay sacrifice choice — bot driver (issue #940, CR 701.21a)", () => {
    it("surfaces the sacrifice pick to the bot: count + both candidates", () => {
        const state = seedTwoFodder();
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.kind).toBe("may-pay");
        expect(view.owedChoice?.sacrificeCount).toBe(1);
        expect(view.owedChoice?.candidates.map((c) => c.id).sort()).toEqual([
            "keep",
            "victim",
        ]);
    });

    it("supplies a legal victim and resolves without stalling", async () => {
        const state = seedTwoFodder();
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);
        // The action carries a single legal sacrifice pick alongside accept.
        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.accept).toBe(true);
        expect(action.sacrificeIds).toHaveLength(1);
        expect(["keep", "victim"]).toContain(action.sacrificeIds![0]);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // No freeze: the choice drained, exactly one permanent was sacrificed,
        // and the bot drew two cards.
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
    });
});
