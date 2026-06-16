// Integration: bot resolves a mid-resolution interactive choice across the
// GRE → game.ts → driver boundary (ADR 0016, issue #162 tracer bullet through
// `search-library` / Demonic Tutor).
//
// Like mulligan-integration.test.ts, this drives the SAME pure GRE primitives
// the real `submitResolutionChoice` mutation calls (`applyPendingChoiceSubmit`),
// in the order the executor fires them, against a state that has crossed the
// real wire projection. It proves the bot's default choice policy, its
// `BotView` / `OwedChoice`, the action→Move translator, the executor mapping,
// and the engine's resolution-choice line up end-to-end — so "passes in
// isolation, freezes together" cannot ship.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "@convex/gre/pendingChoiceSubmit";
import { enumerateMoves } from "@convex/gre";
import { decidingPlayer } from "@convex/gre/search";
import { projectPublicState } from "@convex/gameProjections";
import type { CardType } from "@convex/cards/types";
import { decideBotAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const HUMAN = "u1-p1";
const BOT = "u1-p2";
const DEMONIC_TUTOR = getCardByName("Demonic Tutor").id;
const FOREST = getCardByName("Forest").id; // a land (low material)
const BEARS = getCardByName("Grizzly Bears").id; // a creature (higher material)
const IVORY_CUP = getCardByName("Ivory Cup").id; // "you may pay {1}: gain 1 life"

/** Fake mutation surface routing `submitResolutionChoice` / `submitMayPay`
 *  through the SAME engine primitives the real `game.ts` mutations call. Every
 *  other mutation is unexpected in this flow and throws. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in resolution-choice flow");
    };
    return {
        playCard: reject,
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
        declareMulligan: reject,
        submitResolutionChoice: async (args) => {
            applyPendingChoiceSubmit(state, args);
        },
        submitMayPay: async ({ playerId, accept }) => {
            applyMayPaySubmit(state, { playerId, accept });
        },
        passPriority: reject,
    };
}

/** A state where the bot has cast Demonic Tutor and the engine has enqueued the
 *  `search-library` choice (count 1) for the bot. Its library holds one land and
 *  one creature so the material ordering has something to choose between. */
function makeTutorState(): GameState {
    const land = makeInstance(FOREST, {
        id: "bot-lib-land",
        controllerId: BOT,
        ownerId: BOT,
        zone: "library",
    });
    const creature = makeInstance(BEARS, {
        id: "bot-lib-bears",
        controllerId: BOT,
        ownerId: BOT,
        zone: "library",
    });
    const state = makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, { hand: [], library: [land, creature] }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
    pushSpell(state, DEMONIC_TUTOR, BOT);
    // Step 0 of the resolve enqueues the search-library pending choice.
    resolveTopOfStack(state);
    return state;
}

describe("bot resolution-choice full path — search-library (ADR 0016, #162)", () => {
    it("the GRE surfaces no move while the choice is pending (policy stays in the brain)", () => {
        const state = makeTutorState();
        expect(state.pendingChoices?.[0]?.kind).toBe("search-library");
        // Search produces nothing — the bot would freeze without a brain policy.
        expect(enumerateMoves(state, BOT)).toEqual([]);
        expect(decidingPlayer(state)).toBeNull();
    });

    it("buildBotView surfaces the owed choice (kind, count bounds, candidates)", () => {
        const state = makeTutorState();
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.owedChoice).toMatchObject({
            kind: "search-library",
            min: 1,
            max: 1,
        });
        // Both library cards are legal candidates, exposed via `librarySearch`.
        expect(view.owedChoice?.candidates.map((c) => c.id).sort()).toEqual([
            "bot-lib-bears",
            "bot-lib-land",
        ]);
    });

    it("resolves the search without freezing — a legal card moves to hand and the queue drains", async () => {
        const state = makeTutorState();

        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        const action = decideBotAction(view);
        expect(action.kind).toBe("resolution-choice");

        const move = botActionToMove(action, projected, BOT);
        expect(move?.kind).toBe("resolution-choice");
        if (!move) throw new Error("unreachable");

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // Game advanced: the choice queue drained and priority returned to the
        // active player (no freeze).
        expect(state.pendingChoices).toBeUndefined();
        expect(decidingPlayer(state)).toBe(BOT);

        // A legal card was fetched into the bot's hand — the creature, since the
        // material ordering prefers non-lands over lands.
        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.hand.map((c) => c.id)).toEqual(["bot-lib-bears"]);
        expect(bot.library.map((c) => c.id)).toEqual(["bot-lib-land"]);
    });
});

/** A state where the bot's Ivory Cup trigger ("you may pay {1}: gain 1 life")
 *  has resolved far enough to enqueue its `may-pay` choice for the bot. The bot
 *  starts with `floatingMana` colorless mana in its pool. */
function makeMayPayState(floatingMana: number): GameState {
    const cup = makeInstance(IVORY_CUP, {
        id: "cup",
        controllerId: BOT,
        ownerId: BOT,
    });
    const state = makeState({
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, {
                battlefield: [cup],
                life: 20,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: floatingMana },
            }),
        ],
    });
    // Push Ivory Cup's trigger onto the stack with the shape collectTriggers
    // builds (mirrors the lea Ivory Cup test).
    state.stack.push({
        ...cup,
        id: "trig-ivory",
        castById: BOT,
        zone: "stack" as const,
        triggeredAbilityId: "ivory-cup-life",
        triggerEvent: {
            type: "SPELL_CAST" as const,
            casterId: HUMAN,
            spellInstanceId: "spell-x",
            spellCardId: "spell-x-def",
            spellTypes: ["Instant"] as CardType[],
            spellSubtypes: [],
            spellColors: ["W" as const],
        },
        targets: [],
    });
    // First resolve suspends on the may-pay (requestMayPay enqueues it).
    resolveTopOfStack(state);
    return state;
}

describe("bot resolution-choice full path — may-pay (ADR 0016, #164)", () => {
    it("enqueues a may-pay choice that the GRE search cannot resolve", () => {
        const state = makeMayPayState(1);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(enumerateMoves(state, BOT)).toEqual([]);
        expect(decidingPlayer(state)).toBeNull();
    });

    it("accepts when the cost is affordable from the pool — pays {1}, gains life, queue drains", async () => {
        const state = makeMayPayState(1); // {C} in pool covers the {1} cost

        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice).toMatchObject({ kind: "may-pay" });
        expect(view.owedChoice?.affordable).toBe(true);

        const action = decideBotAction(view);
        expect(action).toEqual({ kind: "may-pay", accept: true });

        const move = botActionToMove(action, projected, BOT);
        expect(move).toEqual({ kind: "may-pay", accept: true });
        if (!move) throw new Error("unreachable");

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // Game advanced (no freeze): queue drained, the cost was paid from the
        // pool, and the optional effect resolved (gain 1 life, CR 117.3a).
        expect(state.pendingChoices).toBeUndefined();
        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.manaPool.C).toBe(0);
        expect(bot.life).toBe(21);
    });

    it("declines when the cost is not affordable — submits a legal `no`, queue drains", async () => {
        const state = makeMayPayState(0); // empty pool → cannot pay → decline

        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.affordable).toBe(false);

        const action = decideBotAction(view);
        expect(action).toEqual({ kind: "may-pay", accept: false });

        const move = botActionToMove(action, projected, BOT);
        if (!move) throw new Error("unreachable");
        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // Declining is legal and advances the game: queue drains, no life gained.
        expect(state.pendingChoices).toBeUndefined();
        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.life).toBe(20);
    });
});
