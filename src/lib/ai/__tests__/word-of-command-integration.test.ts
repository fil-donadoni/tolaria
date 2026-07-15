// Integration: Word of Command in a vs-AI game across the GRE → game.ts →
// driver boundary (PRD #575 / slice 6 #581, ADR 0037 Acting Player).
//
// Word of Command splits the prompt-answering role (the Acting Player =
// `PendingChoice.playerId`) from the controlled opponent (whose resources/zones
// the chosen card uses, `zoneOwnerId`). This test proves both sides of the
// control relationship through the SAME pure primitives the real mutations
// call, in the order the executor fires them, against state that has crossed the
// real wire projection:
//
//   - When the BOT controls Word of Command it is the Acting Player, so every
//     routed choice (card pick from the opponent's hand, the cast spell's
//     target) is keyed to the bot (`playerId === botId`). The brain must answer
//     each with a LEGAL submission so the resolution never freezes.
//   - When the BOT is the controlled OPPONENT every WoC choice is keyed to the
//     human Acting Player (`playerId === human !== botId`), so the bot surfaces
//     NO owed choice and makes no decision.
//
// Authority stays server-side (ADR 0001): the bot's picks are submitted and
// validated by `applyPendingChoiceSubmit` exactly like a human move.

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
    applyLandEntrySubmit,
    applyNameCardSubmit,
    applyRandomRevealAck,
} from "@convex/gre/pendingChoiceSubmit";
import { projectPublicState } from "@convex/gameProjections";
import { decideBotAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const HUMAN = "u1-p1";
const BOT = "u1-p2";
const WORD_OF_COMMAND = getCardByName("Word of Command").id;
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id;
const DARK_RITUAL = getCardByName("Dark Ritual").id;
const SWAMP = getCardByName("Swamp").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** Fake mutation surface routing the resolution-choice family through the SAME
 *  engine primitives the real `game.ts` mutations call. Every other mutation is
 *  unexpected in this flow and throws. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in Word of Command flow");
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
        submitMadnessDecline: reject,
        submitLandEntryChoice: async ({ playerId, accept }) => {
            applyLandEntrySubmit(state, { playerId, accept });
        },
        submitNameCard: async ({ playerId, cardName }) => {
            applyNameCardSubmit(state, { playerId, cardName });
        },
        submitRandomRevealAck: async ({ playerId, stackItemId, choiceId }) => {
            applyRandomRevealAck(state, { playerId, stackItemId, choiceId });
        },
        passPriority: reject,
    };
}

/** Drive one bot decision against the projected state and apply it through the
 *  server primitives. Returns the resolved action so the caller can assert it.
 *  Throws if the bot owes no resolution action (would freeze the game). */
async function driveBotChoice(state: GameState): Promise<string> {
    const projected = projectPublicState(state, 1, BOT);
    const view = buildBotView(projected, BOT);
    const action = decideBotAction(view);
    const move = botActionToMove(action, projected, BOT);
    if (!move) {
        throw new Error(
            `bot owes no resolution move for choice kind ${
                view.owedChoice?.kind ?? "none"
            } (would freeze)`
        );
    }
    await executeMove(move, {
        gameId: "g" as never,
        botId: BOT,
        mutations: engineMutations(state),
    });
    return action.kind;
}

describe("Word of Command — bot controls it (Acting Player = bot, #581)", () => {
    // Bot (Acting Player) casts Word of Command at the human; the human's hand
    // holds a Lightning Bolt. The human controls a Mountain so the controlled
    // cast can be paid from the human's lands only (the oracle's restriction).
    function seedBoltScenario(): GameState {
        const oppBolt = makeInstance(LIGHTNING_BOLT, {
            id: "human-bolt",
            controllerId: HUMAN,
            ownerId: HUMAN,
            zone: "hand",
        });
        const oppMountain = makeInstance(MOUNTAIN, {
            id: "human-mountain",
            controllerId: HUMAN,
            ownerId: HUMAN,
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer(HUMAN, {
                    hand: [oppBolt],
                    battlefield: [oppMountain],
                    life: 20,
                }),
                makePlayer(BOT, { life: 20 }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        pushSpell(state, WORD_OF_COMMAND, BOT, [{ type: "player", id: HUMAN }]);
        // Step 0 enqueues the card-pick choice keyed to the bot (Acting Player).
        resolveTopOfStack(state);
        return state;
    }

    it("the card-pick choice is keyed to the bot, with the opponent's hand exposed", () => {
        const state = seedBoltScenario();
        const head = state.pendingChoices?.[0];
        expect(head).toMatchObject({
            playerId: BOT, // Acting Player answers
            zoneOwnerId: HUMAN, // ...from the opponent's hand
            kind: "choose-hand-card",
        });
        // The bot (Acting Player) knows the opponent's hand it looked at, so the
        // wire projection exposes the Bolt as a real candidate (not a null slot).
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        expect(view.owedChoice?.kind).toBe("choose-hand-card");
        expect(view.owedChoice?.candidates.map((c) => c.id)).toContain(
            "human-bolt"
        );
    });

    it("picks the Bolt then aims it — resolution never freezes, the Bolt is on the opponent's stack", async () => {
        const state = seedBoltScenario();

        // 1) Card pick from the opponent's hand.
        expect(await driveBotChoice(state)).toBe("resolution-choice");
        // 2) Target pick for the controlled Bolt (any-target → choose-damage-target).
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-damage-target");
        expect(await driveBotChoice(state)).toBe("resolution-choice");

        // No freeze: the choice queue drained.
        expect(state.pendingChoices).toBeUndefined();
        // The Bolt was cast as the OPPONENT's spell (CR 601) but routed by the
        // bot (Acting Player, ADR 0037).
        const boltOnStack = state.stack.find(
            (s) => (s.card as { id?: string }).id === LIGHTNING_BOLT
        );
        expect(boltOnStack).toBeDefined();
        expect(boltOnStack?.castById).toBe(HUMAN);
        expect(boltOnStack?.actingPlayerId).toBe(BOT);
        expect(boltOnStack?.targets).toHaveLength(1);
        // Paid from the opponent's Mountain only (the oracle's mana restriction).
        expect(
            state.players[0].battlefield.find((c) => c.id === "human-mountain")
                ?.isTapped
        ).toBe(true);
    });

    it("picks a non-targeted spell (Dark Ritual) and casts it from the opponent's lands", async () => {
        const oppRitual = makeInstance(DARK_RITUAL, {
            id: "human-ritual",
            controllerId: HUMAN,
            ownerId: HUMAN,
            zone: "hand",
        });
        const oppSwamp = makeInstance(SWAMP, {
            id: "human-swamp",
            controllerId: HUMAN,
            ownerId: HUMAN,
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer(HUMAN, {
                    hand: [oppRitual],
                    battlefield: [oppSwamp],
                }),
                makePlayer(BOT),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        pushSpell(state, WORD_OF_COMMAND, BOT, [{ type: "player", id: HUMAN }]);
        resolveTopOfStack(state);

        // Single card-pick choice; no target needed for Dark Ritual.
        expect(await driveBotChoice(state)).toBe("resolution-choice");
        expect(state.pendingChoices).toBeUndefined();

        const ritualOnStack = state.stack.find(
            (s) => (s.card as { id?: string }).id === DARK_RITUAL
        );
        expect(ritualOnStack?.castById).toBe(HUMAN);
        expect(ritualOnStack?.actingPlayerId).toBe(BOT);
    });
});

describe("Word of Command — bot is the controlled opponent (no decisions, #581)", () => {
    // The HUMAN (Acting Player) casts Word of Command at the BOT; the bot's hand
    // holds a Lightning Bolt. Every WoC choice is keyed to the human, so the bot
    // must surface no owed choice and make no decision.
    function seedBotControlled(): GameState {
        const botBolt = makeInstance(LIGHTNING_BOLT, {
            id: "bot-bolt",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const botMountain = makeInstance(MOUNTAIN, {
            id: "bot-mountain",
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer(HUMAN, { life: 20 }),
                makePlayer(BOT, {
                    hand: [botBolt],
                    battlefield: [botMountain],
                    life: 20,
                }),
            ],
            activePlayerId: HUMAN,
            priorityPlayerId: HUMAN,
        });
        pushSpell(state, WORD_OF_COMMAND, HUMAN, [{ type: "player", id: BOT }]);
        resolveTopOfStack(state);
        return state;
    }

    it("the card-pick choice is keyed to the human, not the bot", () => {
        const state = seedBotControlled();
        expect(state.pendingChoices?.[0]).toMatchObject({
            playerId: HUMAN,
            zoneOwnerId: BOT,
            kind: "choose-hand-card",
        });
    });

    it("the bot surfaces no owed choice and owes no resolution move", () => {
        const state = seedBotControlled();
        const projected = projectPublicState(state, 1, BOT);
        const view = buildBotView(projected, BOT);
        // The choice belongs to the human Acting Player — the bot owes nothing.
        expect(view.owedChoice).toBeUndefined();
        const action = decideBotAction(view);
        expect(botActionToMove(action, projected, BOT)).toBeNull();
    });
});
