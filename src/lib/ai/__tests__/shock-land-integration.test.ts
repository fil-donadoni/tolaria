// Integration: bot plays a shock land across the GRE → game.ts → driver
// boundary (CR 614.12, ADR 0051). Drives the SAME pure GRE primitives the real
// `playCard` / `submitLandEntryChoice` mutations call, in the order the executor
// fires them, against a state that has crossed the real wire projection. Proves
// the suspend (`applyPlayLand`), the bot's default pay-choice policy, its
// BotView / OwedChoice, the action→Move translator, the executor mapping, and
// the finalizer line up end-to-end — so "passes in isolation, freezes together"
// cannot ship for the shock-land pay-choice.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { type GameState } from "@convex/gre/state";
import { applyPlayLand } from "@convex/gre/playLand";
import { applyLandEntrySubmit } from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { decideBotAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const HUMAN = "u1-p1";
const BOT = "u1-p2";
const STEAM_VENTS = getCardByName("Steam Vents").id;

function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in shock-land flow");
    };
    return {
        playCard: async ({ playerId, cardInstanceId }) => {
            const p = state.players.find((x) => x.id === playerId)!;
            applyPlayLand(state, p, cardInstanceId);
        },
        announceCast: reject,
        selectTarget: reject,
        confirmTargets: reject,
        tapForPayment: reject,
        activateAbility: reject,
        tapForActivationPayment: reject,
        toggleAttacker: reject,
        confirmAttackers: reject,
        selectBlocker: reject,
        assignBlockerTarget: reject,
        confirmBlockers: reject,
        confirmDamage: reject,
        declareMulligan: reject,
        submitResolutionChoice: reject,
        submitMayPay: reject,
        submitMadnessDecline: reject,
        submitDrawRevealPay: reject,
        submitLandEntryChoice: async ({ playerId, accept }) => {
            applyLandEntrySubmit(state, { playerId, accept });
        },
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
}

function makeShockState(botLife: number): GameState {
    const shock = makeInstance(STEAM_VENTS, {
        id: "shock",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, { life: botLife, hand: [shock] }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

async function runBotPlay(state: GameState) {
    const mutations = engineMutations(state);
    const ctx = { gameId: "g" as never, botId: BOT, mutations };

    // 1. Bot plays the land → applyPlayLand suspends on the pay-choice.
    await executeMove({ kind: "play-land", cardInstanceId: "shock" }, ctx);
    expect(state.pendingChoices?.[0]?.kind).toBe("land-entry-tapped");

    // 2. Bot resolves the owed choice through its default policy, wired the same
    //    way the driver does (view → decide → toMove → execute).
    const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
    const action = decideBotAction(view);
    const move = botActionToMove(
        action,
        projectPublicState(state, 1, BOT),
        BOT
    );
    expect(move).not.toBeNull();
    await executeMove(move!, ctx);
}

describe("bot shock-land full path (CR 614.12, ADR 0051)", () => {
    it("pays 2 life and enters untapped when life is comfortable", async () => {
        const state = makeShockState(20);
        await runBotPlay(state);

        const bot = state.players.find((p) => p.id === BOT)!;
        const land = bot.battlefield.find((c) => c.id === "shock");
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(bot.life).toBe(18);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("declines and enters tapped when it cannot afford the life (CR 118.4)", async () => {
        const state = makeShockState(1);
        await runBotPlay(state);

        const bot = state.players.find((p) => p.id === BOT)!;
        const land = bot.battlefield.find((c) => c.id === "shock");
        expect(land!.isTapped).toBe(true);
        expect(bot.life).toBe(1);
    });
});
