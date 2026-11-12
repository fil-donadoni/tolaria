// The Bot answers the opening-hand action window (CR 103.6a): "If this card is
// in your opening hand, you may begin the game with it on the battlefield."
//
// Driven from the SAME projected bot view the live driver uses, through the
// executor into the engine's own submit seam (`applyPendingChoiceSubmit`, the
// body of `submitResolutionChoice`). The choice is optional (`min` 0), so the
// generic minimal-legal default would decline every time; the Bot puts every
// eligible card instead.

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinitionAsync } from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { makeMulliganState, recordDeclaration } from "@convex/gre/mulligan";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import type { GameState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import type { Phase } from "@convex/gre";
import { decideBotAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const HUMAN = "u1-p1";
const BOT = "u1-p2";
const BEARS = getCardByName("Grizzly Bears").id;

// Served only inside each test (`withTemporaryDefinitionAsync`), never left in
// the registry: `bot-node` shares a worker across files.
const LEYLINE: CardDefinition = {
    id: "synthetic-opening-hand-bot",
    name: "Synthetic Opening-Hand Enchantment",
    rarity: "rare",
    oracleText:
        "If this card is in your opening hand, you may begin the game with it on the battlefield.",
    manaCost: { generic: 2, G: 2 },
    types: ["Enchantment"],
    openingHandAction: "begin-on-battlefield",
};

const REVEALER: CardDefinition = {
    id: "synthetic-opening-hand-reveal-bot",
    name: "Synthetic Opening-Hand Revealer",
    rarity: "rare",
    oracleText:
        "You may reveal this card from your opening hand. If you do, at the beginning of your first upkeep, you gain 3 life.",
    manaCost: { X: 3 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    openingHandAction: "reveal",
    openingHandReveal: {
        oracleText: "At the beginning of your first upkeep, you gain 3 life.",
        effects: [{ op: "gainLife", player: "controller", amount: 3 }],
    },
};

/** Both seats kept; the Bot (not the starting player) holds two copies of the
 *  opening-hand card beside five Bears, the human holds none. */
function windowOwedToBot(
    botCards: [string, string] = [LEYLINE.id, LEYLINE.id]
): GameState {
    const hand = (owner: string, defs: string[]) =>
        defs.map((cardId, i) =>
            makeInstance(cardId, {
                id: `${owner}-hand-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "hand",
            })
        );
    const library = (owner: string) =>
        Array.from({ length: 20 }, (_, i) =>
            makeInstance(BEARS, {
                id: `${owner}-lib-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    const state = makeState({
        players: [
            makePlayer(HUMAN, {
                hand: hand(HUMAN, Array(7).fill(BEARS)),
                library: library(HUMAN),
            }),
            makePlayer(BOT, {
                hand: hand(BOT, [
                    botCards[0],
                    BEARS,
                    botCards[1],
                    ...Array(4).fill(BEARS),
                ]),
                library: library(BOT),
            }),
        ],
        phase: "MULLIGAN" as Phase,
        activePlayerId: HUMAN,
        priorityPlayerId: HUMAN,
        turn: 1,
    });
    state.mulligan = makeMulliganState(state);
    recordDeclaration(state, HUMAN, "keep");
    recordDeclaration(state, BOT, "keep");
    return state;
}

/** Only `submitResolutionChoice` is expected; it applies through the engine's
 *  own submit seam. Anything else is a wrong route. */
function engineMutations(state: GameState): MoveMutations {
    return new Proxy({} as MoveMutations, {
        get: (_target, name) =>
            name === "submitResolutionChoice"
                ? async (
                      args: Parameters<typeof applyPendingChoiceSubmit>[1]
                  ) => applyPendingChoiceSubmit(state, args)
                : () => {
                      throw new Error(`unexpected mutation ${String(name)}`);
                  },
    });
}

describe("Bot — opening-hand actions (CR 103.6a)", () => {
    it("puts every eligible opening-hand card onto the battlefield, and the game starts", async () => {
        await withTemporaryDefinitionAsync(LEYLINE, async () => {
            const state = windowOwedToBot();
            expect(state.pendingChoices?.[0]?.kind).toBe("opening-hand-action");
            expect(state.pendingChoices?.[0]?.playerId).toBe(BOT);

            const projected = projectPublicState(state, 1, BOT);
            const action = decideBotAction(buildBotView(projected, BOT));
            const move = botActionToMove(action, projected, BOT);
            expect(move?.kind).toBe("resolution-choice");
            if (move?.kind !== "resolution-choice")
                throw new Error("unreachable");
            expect([...move.cardInstanceIds].sort()).toEqual([
                `${BOT}-hand-0`,
                `${BOT}-hand-2`,
            ]);

            await executeMove(move, {
                gameId: "g" as never,
                botId: BOT,
                mutations: engineMutations(state),
            });
            const bot = state.players[1];
            expect(bot.battlefield.map((c) => c.id).sort()).toEqual([
                `${BOT}-hand-0`,
                `${BOT}-hand-2`,
            ]);
            expect(state.mulligan).toBeUndefined();
            expect(state.phase).toBe("UPKEEP");
        });
    });

    it("reveals every offered opening-hand card (CR 103.6b), scheduling its first-upkeep trigger", async () => {
        await withTemporaryDefinitionAsync(REVEALER, async () => {
            const state = windowOwedToBot([REVEALER.id, REVEALER.id]);
            const projected = projectPublicState(state, 1, BOT);
            const action = decideBotAction(buildBotView(projected, BOT));
            const move = botActionToMove(action, projected, BOT);
            if (move?.kind !== "resolution-choice")
                throw new Error("expected a resolution choice");
            expect([...move.cardInstanceIds].sort()).toEqual([
                `${BOT}-hand-0`,
                `${BOT}-hand-2`,
            ]);

            await executeMove(move, {
                gameId: "g" as never,
                botId: BOT,
                mutations: engineMutations(state),
            });
            const bot = state.players[1];
            // Revealed, not put onto the battlefield; the trigger waits for the
            // Bot's own first upkeep (the human is on the play).
            expect(bot.battlefield).toHaveLength(0);
            expect(bot.hand).toHaveLength(7);
            expect(state.delayedTriggers?.map((t) => t.targetPlayerId)).toEqual(
                [BOT, BOT]
            );
            expect(state.phase).toBe("UPKEEP");
        });
    });
});
