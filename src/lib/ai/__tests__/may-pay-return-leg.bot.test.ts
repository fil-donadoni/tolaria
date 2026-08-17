// Bot integration: a may-pay PERMANENT leg with `action: "return"` across the
// GRE → game.ts → driver boundary (CR 400.7 / 118.9, ADR 0079, issue #1933).
//
// The recurring failure mode this guards is a bot STALL on a new choice
// mechanic: the engine opens a picker the brain doesn't surface, the executor
// submits without ids, `submitMayPay` throws, the driver resets its signature
// and re-answers the SAME state forever. A return leg is especially exposed
// because — unlike its sacrifice sibling — it opens the picker even when only
// ONE permanent is legal, so there is no "auto-resolve" path to fall back on.
//
// `botActionRealisation("may-pay")` already classifies this pending-choice
// shape (it is the SAME `BotAction.kind` a sacrifice-leg may-pay uses — the
// unification is what buys that for free), and the classifier is
// compile-time-exhaustive over `BotAction["kind"]`, so no new branch is owed.
// This suite proves the whole path actually runs.

import { describe, expect, it } from "vitest";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import type { GameState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    fireReturnLegEtb,
    returnLegLand,
    returnLegProbeInstance,
} from "@convex/gre/__tests__/fixtures/mayPayReturnLegProbe";
import { applyMayPaySubmit } from "@convex/gre/pendingChoiceSubmit";
import { botActionRealisation, chooseOwedChoiceAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

/** Fake mutation surface routing `submitMayPay` (with its permanent pick)
 *  through the SAME engine primitive the real `game.ts` mutation calls. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in may-pay return flow");
    };
    return {
        playCard: reject,
        summonCompanion: reject,
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
        submitMayPay: async ({
            playerId,
            accept,
            sacrificeIds,
            discardIds,
        }) => {
            applyMayPaySubmit(state, {
                playerId,
                accept,
                sacrificeIds,
                discardIds,
            });
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

function boardWithProbe(extraLands: string[]): GameState {
    const probe = returnLegProbeInstance("probe", BOT);
    const state = makeState({
        players: [
            makePlayer(HUMAN, { life: 20 }),
            makePlayer(BOT, {
                life: 20,
                battlefield: [
                    probe,
                    ...extraLands.map((id) => returnLegLand(id, BOT)),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    fireReturnLegEtb(state, probe);
    return state;
}

describe("may-pay return leg — bot driver (ADR 0079, issue #1933)", () => {
    it("classifies the choice through the exhaustive dispatch", () => {
        // The return leg reuses the `may-pay` BotAction kind, which
        // `botActionRealisation` already classifies; the switch is exhaustive
        // over `BotAction["kind"]` (`assertNever`), so a genuinely new kind
        // would not compile without a branch.
        expect(botActionRealisation("may-pay")).toBe("executor");
    });

    it("surfaces the permanent pick even with exactly one legal land", () => {
        const state = boardWithProbe(["only"]);
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice?.kind).toBe("may-pay");
        // The engine ALWAYS prompts here — the bot must be told how many
        // permanents to name or it submits an empty pick and freezes.
        expect(view.owedChoice?.sacrificeCount).toBe(1);
        expect(view.owedChoice?.candidates.map((c) => c.id)).toEqual(["only"]);
    });

    it("pays the leg end-to-end: pick → move → mutation → bounced to hand", async () => {
        const state = boardWithProbe(["l1", "l2"]);
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = chooseOwedChoiceAction(view.owedChoice!);
        expect(action.kind).toBe("may-pay");
        if (action.kind !== "may-pay") throw new Error("expected may-pay");
        expect(action.sacrificeIds).toHaveLength(1);

        const move = botActionToMove(action, projected, BOT);
        expect(move).not.toBeNull();
        if (move!.kind !== "may-pay") throw new Error("expected may-pay move");
        expect(move!.sacrificeIds).toEqual(action.sacrificeIds);

        await executeMove(move!, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        const bot = state.players[1];
        if (action.accept) {
            // No freeze and no stall: exactly one permanent went to hand, the
            // probe survived, and nothing was sacrificed.
            expect(bot.hand).toHaveLength(1);
            expect(bot.hand[0].id).toBe(action.sacrificeIds![0]);
            expect(bot.battlefield.some((c) => c.id === "probe")).toBe(true);
            expect(bot.graveyard).toHaveLength(0);
        } else {
            // Declining is also a legal, non-stalling answer: the CR 118
            // "unless" consequence sacrifices the source.
            expect(bot.graveyard.some((c) => c.id === "probe")).toBe(true);
        }
        // Either way the choice was consumed — the driver never sees the same
        // pending choice twice.
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});
