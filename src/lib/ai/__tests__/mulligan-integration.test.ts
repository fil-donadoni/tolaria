// Integration: bot view → declareMulligan → bottoming, across the
// GRE → game.ts → driver boundary (issue #145, criterion: full-path test).
//
// The project has no convex-test harness, so — like moves-integration.test.ts —
// this drives the SAME pure GRE primitives the `declareMulligan` /
// `submitResolutionChoice` mutations call, in the order the executor fires them,
// against a state that has crossed the real wire projection. It proves the
// bot's mulligan heuristic, its `BotView`, the executor mapping, and the
// mulligan engine line up end-to-end.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    recordDeclaration,
    applyMulliganBottomChoice,
} from "@convex/gre/mulligan";
import type { GameState, MulliganState } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import type { Phase } from "@convex/gre";
import { decideBotAction } from "../brain";
import { buildBotView, botActionToMove } from "../bot-view";
import { executeMove, type MoveMutations } from "../executor";

const HUMAN = "u1-p1";
const BOT = "u1-p2";
const FOREST = getCardByName("Forest").id;
const BEARS = getCardByName("Grizzly Bears").id;

/** Fake mutation surface that applies the bot's moves to a shared GameState via
 *  the SAME engine primitives the real `game.ts` mutations call. */
function engineMutations(state: GameState): MoveMutations {
    const reject = () => {
        throw new Error("unexpected mutation in mulligan flow");
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
        declareMulligan: async ({ playerId, decision }) => {
            recordDeclaration(state, playerId, decision);
        },
        submitResolutionChoice: async ({ cardInstanceIds }) => {
            applyMulliganBottomChoice(state, cardInstanceIds);
        },
        submitMayPay: reject,
        submitMadnessDecline: reject,
        submitLandEntryChoice: reject,
        submitNameCard: reject,
        submitRandomRevealAck: reject,
        passPriority: reject,
    };
}

/** A 2-player MULLIGAN state where the human is already locked and the bot is
 *  next to declare, having already taken `mulligansTaken` mulligan(s). The
 *  bot's hand is `lands` Forests + `spells` Grizzly Bears. */
function makeMulliganGame(opts: {
    lands: number;
    spells: number;
    botMulligansTaken: number;
}): GameState {
    const botHand = [
        ...Array.from({ length: opts.lands }, (_, i) =>
            makeInstance(FOREST, {
                id: `bot-forest-${i}`,
                controllerId: BOT,
                ownerId: BOT,
                zone: "hand",
            })
        ),
        ...Array.from({ length: opts.spells }, (_, i) =>
            makeInstance(BEARS, {
                id: `bot-bears-${i}`,
                controllerId: BOT,
                ownerId: BOT,
                zone: "hand",
            })
        ),
    ];
    const botLibrary = Array.from({ length: 40 }, (_, i) =>
        makeInstance(FOREST, {
            id: `bot-lib-${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "library",
        })
    );
    const mulligan: MulliganState = {
        mulligansTaken: [0, opts.botMulligansTaken],
        declarations: [null, null],
        locked: [true, false], // human already kept, bot still to declare
        declaringPlayerId: BOT,
        bottoming: false,
    };
    return makeState({
        players: [
            makePlayer(HUMAN, { hand: [], library: [] }),
            makePlayer(BOT, { hand: botHand, library: botLibrary }),
        ],
        phase: "MULLIGAN" as Phase,
        activePlayerId: HUMAN,
        priorityPlayerId: BOT,
        mulligan,
    });
}

/** Run the bot's gate → move → executor for the current state once. Returns the
 *  move executed (or null if the bot owed nothing). */
async function driveBotOnce(
    state: GameState,
    seq: number
): Promise<ReturnType<typeof botActionToMove>> {
    const projected = projectPublicState(state, seq, BOT);
    const view = buildBotView(projected, BOT);
    const action = decideBotAction(view);
    const move = botActionToMove(action, projected, BOT);
    if (move)
        await executeMove(move, {
            gameId: "g" as never,
            botId: BOT,
            mutations: engineMutations(state),
        });
    return move;
}

describe("regression guard: bot never stalls in a mulligan window (issue #163)", () => {
    // An older, intermittent freeze left the bot with no action in the
    // opening-hand mulligan step. The keep/mull work (issue #145) fixed it, but
    // the behaviour was unguarded — a future change could silently reintroduce
    // it. These pin, from the SAME projected bot view the live driver uses, that
    // the bot is always owed a concrete action when it is owed a mulligan
    // decision: never `none`.

    /** decideBotAction for the bot, built from the real wire projection. */
    function decideFromProjection(
        state: GameState
    ): ReturnType<typeof decideBotAction> {
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        return decideBotAction(view);
    }

    it("never returns `none` for a mulligan DECLARATION window owed to the bot", () => {
        // Across every land/spell split of a 7-card hand, and every legal
        // mulligan count, the declaration must resolve to keep or mull.
        for (let lands = 0; lands <= 7; lands++) {
            for (let taken = 0; taken <= 4; taken++) {
                const state = makeMulliganGame({
                    lands,
                    spells: 7 - lands,
                    botMulligansTaken: taken,
                });
                const action = decideFromProjection(state);
                expect(action.kind).not.toBe("none");
                expect(["keep", "mull"]).toContain(action.kind);
            }
        }
    });

    it("never returns `none` for a mulligan BOTTOMING window owed to the bot (legal count of ids)", () => {
        // Drive the bot to a keep so the engine enqueues its bottoming choice,
        // then assert the bottoming window yields a legal mulligan-bottom action
        // (exactly `mulligansTaken` ids, all distinct, all from the hand).
        for (let taken = 1; taken <= 4; taken++) {
            const state = makeMulliganGame({
                lands: 4,
                spells: 3,
                botMulligansTaken: taken,
            });
            // Keep → bottoming enqueued for the bot.
            recordDeclaration(state, BOT, "keep");
            expect(state.mulligan?.bottoming).toBe(true);
            expect(state.pendingChoices?.[0]?.kind).toBe("mulligan-bottom");

            const action = decideFromProjection(state);
            expect(action.kind).toBe("mulligan-bottom");
            if (action.kind !== "mulligan-bottom") {
                throw new Error("unreachable");
            }
            // London mulligan: bottom exactly `taken` cards (CR 103.5).
            expect(action.cardInstanceIds).toHaveLength(taken);
            expect(new Set(action.cardInstanceIds).size).toBe(taken);
            const botHandIds = new Set(
                state.players.find((p) => p.id === BOT)!.hand.map((c) => c.id)
            );
            for (const id of action.cardInstanceIds) {
                expect(botHandIds.has(id)).toBe(true);
            }
        }
    });
});

describe("bot mulligan full path (issue #145)", () => {
    it("keeps a good hand, then bottoms the right number of cards and the game proceeds", async () => {
        // Bot already mulliganed once → must bottom 1 card on keep. Hand has an
        // excess land the heuristic should shed.
        const state = makeMulliganGame({
            lands: 4,
            spells: 3,
            botMulligansTaken: 1,
        });

        // Step 1: declaration window → keep.
        const keep = await driveBotOnce(state, 1);
        expect(keep).toEqual({ kind: "mulligan", decision: "keep" });
        // All players locked → bottoming enqueued for the bot.
        expect(state.mulligan?.bottoming).toBe(true);
        expect(state.pendingChoices?.[0]?.kind).toBe("mulligan-bottom");

        // Step 2: bottoming window → submit a 1-card bottom order.
        const bottom = await driveBotOnce(state, 2);
        expect(bottom?.kind).toBe("mulligan-bottom");
        if (bottom?.kind !== "mulligan-bottom") throw new Error("unreachable");
        expect(bottom.cardInstanceIds).toHaveLength(1);
        // Sheds an excess land first.
        expect(bottom.cardInstanceIds[0]).toMatch(/^bot-forest-/);

        // Mulligan resolved: phase advanced, state cleared, hand trimmed to 6.
        expect(state.mulligan).toBeUndefined();
        expect(state.phase).not.toBe("MULLIGAN");
        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.hand).toHaveLength(6);
        // The bottomed card is on the bottom of the library.
        expect(bot.library[bot.library.length - 1].id).toBe(
            bottom.cardInstanceIds[0]
        );
    });

    it("declares a mulligan for a zero-land opening hand", async () => {
        const state = makeMulliganGame({
            lands: 0,
            spells: 7,
            botMulligansTaken: 0,
        });
        const move = await driveBotOnce(state, 1);
        expect(move).toEqual({ kind: "mulligan", decision: "mull" });
        // The bot redrew a fresh 7 and is to declare again (not yet locked).
        expect(state.mulligan?.bottoming).toBe(false);
        expect(state.mulligan?.mulligansTaken[1]).toBe(1);
    });
});
