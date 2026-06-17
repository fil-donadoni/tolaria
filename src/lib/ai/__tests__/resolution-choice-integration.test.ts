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
const CLONE = getCardByName("Clone").id; // may-pay → choose-permanents (Creature)
const NATURAL_SELECTION = getCardByName("Natural Selection").id; // reorder-library
const PLAINS = getCardByName("Plains").id; // white-producing land
const MOUNTAIN = getCardByName("Mountain").id; // red-producing land
const SHIVAN_DRAGON = getCardByName("Shivan Dragon").id; // 4RR — castable only off red sources

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
        confirmDamage: reject,
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
        // Each candidate carries a projected `cardValue` (ADR 0018, issue #197),
        // and the creature outranks the land by value — not a single is-a-land
        // bit, so the bot fetches the better card.
        const candidates = view.owedChoice!.candidates;
        expect(candidates.every((c) => typeof c.value === "number")).toBe(true);
        const bears = candidates.find((c) => c.id === "bot-lib-bears")!;
        const land = candidates.find((c) => c.id === "bot-lib-land")!;
        expect(bears.value).toBeGreaterThan(land.value);
    });

    it("the projected value lives only on the owed-choice path, never the public projection (no PvP hidden-hand leak)", () => {
        const state = makeTutorState();
        const projected = projectPublicState(state, 1, BOT);
        // The bot-only owed-choice candidates carry `value`...
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice!.candidates.every((c) => "value" in c)).toBe(
            true
        );
        // ...but the 2-player public projection NEVER does: the searched library
        // cards are slim instances with no `value`, so real PvP can't leak a
        // per-card valuation of a hidden hand (issue #197 / ADR 0018 user story).
        const botProjected = projected.players.find((p) => p.id === BOT)!;
        for (const c of botProjected.librarySearch ?? []) {
            expect("value" in c).toBe(false);
        }
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

/** Drive the bot through every choice it is owed until the queue drains or it
 *  owes nothing actionable. Returns the ordered list of action kinds taken — a
 *  chain of choices (e.g. Clone's may-pay → choose-permanents) must complete
 *  without freezing (ADR 0016 user story 4). */
async function driveBotToStable(state: GameState, max = 12): Promise<string[]> {
    const kinds: string[] = [];
    for (let i = 0; i < max; i++) {
        const projected = projectPublicState(state, i + 1, BOT);
        const action = decideBotAction(buildBotView(projected, BOT));
        if (action.kind === "none" || action.kind === "pass") break;
        const move = botActionToMove(action, projected, BOT);
        if (!move) break;
        kinds.push(action.kind);
        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });
        if (!state.pendingChoices) break;
    }
    return kinds;
}

describe("bot resolution-choice full path — remaining kinds (ADR 0016, #165)", () => {
    it("choose-permanents: resolves a chain (may-pay → pick a creature) without freezing", async () => {
        // A creature exists for Clone to copy, so the engine offers the
        // cost-less "enter as a copy?" may-pay, then a choose-permanents pick.
        const victim = makeInstance(BEARS, {
            id: "victim",
            controllerId: HUMAN,
            ownerId: HUMAN,
            zone: "battlefield",
            isSummoningSick: false,
        });
        const state = makeState({
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [
                makePlayer(HUMAN, { battlefield: [victim] }),
                makePlayer(BOT),
            ],
        });
        pushSpell(state, CLONE, BOT);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");

        const kinds = await driveBotToStable(state);

        // The chain completed: accepted the cost-less may-pay, then made a legal
        // choose-permanents pick — and the queue drained (no freeze).
        expect(kinds).toEqual(["may-pay", "resolution-choice"]);
        expect(state.pendingChoices).toBeUndefined();
        // Clone became a copy of the only legal creature candidate (2/2 Bears).
        const clone = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id !== "victim" && c.types.includes("Creature"));
        expect(clone?.power).toBe(2);
        expect(clone?.toughness).toBe(2);
    });

    it("reorder-library: keeps the current order and the resolution completes", async () => {
        const lib = [0, 1, 2, 3].map((i) =>
            makeInstance(FOREST, {
                id: `ns-lib-${i}`,
                controllerId: BOT,
                ownerId: BOT,
                zone: "library",
            })
        );
        const state = makeState({
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [makePlayer(HUMAN), makePlayer(BOT, { library: lib })],
        });
        // Natural Selection: controller reorders the target player's top 3.
        pushSpell(state, NATURAL_SELECTION, BOT, [{ type: "player", id: BOT }]);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("reorder-library");

        // The default keeps the current top-3 order (CR 401.4).
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice).toMatchObject({ kind: "reorder-library" });
        expect(decideBotAction(view)).toEqual({
            kind: "resolution-choice",
            cardInstanceIds: ["ns-lib-0", "ns-lib-1", "ns-lib-2"],
        });

        // Drive to stable (reorder, then the cost-less "shuffle?" may-pay) — the
        // reorder submission is accepted and the game advances (no freeze).
        const kinds = await driveBotToStable(state);
        expect(kinds[0]).toBe("resolution-choice");
        expect(state.pendingChoices).toBeUndefined();
    });
});

/** A state where the bot owes a CR 514.1 cleanup `discard-hand` choice with a
 *  hand of `landsInHand` Plains plus an off-color Shivan Dragon, and
 *  `landsInPlay` Plains already in play. Mirrors the shape
 *  `tryEnqueueCleanupDiscard` builds so the real `applyPendingChoiceSubmit` /
 *  `finalizeCleanupDiscard` commit path runs. */
function makeCleanupDiscardState(
    landsInHand: number,
    landsInPlay: number,
    landId: string = PLAINS
): GameState {
    const handLands = Array.from({ length: landsInHand }, (_, i) =>
        makeInstance(landId, {
            id: `hand-land-${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        })
    );
    const dragon = makeInstance(SHIVAN_DRAGON, {
        id: "shivan",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const playLands = Array.from({ length: landsInPlay }, (_, i) =>
        makeInstance(landId, {
            id: `play-land-${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        })
    );
    const state = makeState({
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, {
                hand: [...handLands, dragon],
                battlefield: playLands,
            }),
        ],
    });
    state.pendingChoices = [
        {
            stackItemId: "",
            step: 0,
            choiceId: `cleanup-discard-${BOT}`,
            playerId: BOT,
            zoneOwnerId: BOT,
            kind: "discard-hand",
            zone: "hand",
            count: 1,
            prompt: "Discard a card (hand size)",
        },
    ];
    state.pendingCleanupDiscard = { playerId: BOT };
    return state;
}

describe("bot resolution-choice full path — discard-hand mana-aware (issue #242)", () => {
    it("1 land in hand + 1 land in play: discards the spell, keeps the land — committed across the real cleanup path", async () => {
        const state = makeCleanupDiscardState(1, 1);
        expect(state.pendingChoices?.[0]?.kind).toBe("discard-hand");

        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        // The owed choice carries the board's mana situation (issue #242).
        expect(view.owedChoice).toMatchObject({ kind: "discard-hand" });
        expect(view.owedChoice?.manaSituation).toMatchObject({
            landsInPlay: 1,
            landsInHand: 1,
        });

        const action = decideBotAction(view);
        expect(action.kind).toBe("resolution-choice");
        const move = botActionToMove(action, projected, BOT);
        if (!move) throw new Error("unreachable");

        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        // The land stayed in hand; the off-color expensive Shivan Dragon went to
        // the graveyard — and the cleanup committed (no freeze).
        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.hand.map((c) => c.id)).toEqual(["hand-land-0"]);
        expect(bot.graveyard.map((c) => c.id)).toEqual(["shivan"]);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("land-flooded: sheds a surplus land, keeps the castable spell", async () => {
        // Mana-developed board (6 Mountains in play) + two more lands in hand.
        // The Dragon is castable off red sources, so it is worth keeping; an
        // extra land is the right pitch since the bot is flooded.
        const state = makeCleanupDiscardState(2, 6, MOUNTAIN);

        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.manaSituation).toMatchObject({
            landsInPlay: 6,
            landsInHand: 2,
            producibleColors: ["R"],
        });

        const action = decideBotAction(view);
        const move = botActionToMove(action, projected, BOT);
        if (!move) throw new Error("unreachable");
        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });

        const bot = state.players.find((p) => p.id === BOT)!;
        // A land was discarded (the surplus), the castable spell kept.
        expect(bot.graveyard.map((c) => c.id)).toEqual(["hand-land-0"]);
        expect(bot.hand.map((c) => c.id)).toContain("shivan");
        expect(state.pendingChoices).toBeUndefined();
    });
});
