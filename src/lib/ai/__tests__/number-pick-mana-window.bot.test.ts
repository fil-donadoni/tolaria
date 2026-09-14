// Bot full path for the CR 608.2g mana window on a paying numeric nomination
// (issue #3569): candidate -> `executeMove` -> the REAL `game.ts` mutations.
//
//   608.2g  If an effect requires a player to pay mana, that player may
//           activate mana abilities before taking that action.
//
// The live engine already opens that window for a `paysMana` number-pick
// (`isManaPaymentChoiceWindow`, `convex/gre/state.ts`) and the human client
// walks through it by clicking a land. The Bot could not: while a pending
// choice is the head `enumerateMoves` emits only that choice's own answers,
// and mana is planned as a `tapPlan` riding on a cast or an activation, which
// a `number-choice` carried none of. CR 500.5 / 106.4 empty the pool at every
// step and phase boundary, so the pool is empty BY RULE at the moment a cycled
// or upkeep trigger asks — the Bot's only legal nomination was 0, forever,
// while every suite written on a PRE-FLOATED pool stayed green.
//
// What this file proves is the half a GRE test cannot: the mutation SEQUENCE
// the executor sends is one the server accepts in that order. The taps go
// through `tapUntap` — not `tapForPayment`, which belongs to the `pendingCast`
// window a mid-resolution nomination is not in — and the server's own live
// range, re-derived at submit, has to have grown by the time the nomination
// lands.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import {
    activateAbilityOnState,
    submitNumberChoice,
    tapUntap,
} from "@convex/game";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "@convex/__tests__/gameMutationHarness";
import { resolveTopOfStack, numberChoiceRange } from "@convex/gre/state";
import type { GameState } from "@convex/gre/state";
import { enumerateMoves } from "@convex/gre/moves";
import { projectPublicState } from "@convex/gameProjections";
import type { Id } from "@convex/_generated/dataModel";
import { executeMove, type MoveMutations } from "../executor";

const GAME_ID = "game-1" as Id<"games">;
const BOT = "p1";
const DECREE = getCardByName("Decree of Justice")!.id;
const PLAINS = getCardByName("Plains")!.id;

/** The Bot holding Decree of Justice with exactly the cycling cost floating
 *  ({2}{W}) and three untapped Plains — the position CR 500.5 guarantees: by
 *  the time the cycled trigger resolves the pool is spent to the last mana and
 *  everything the nomination can spend is still in the ground. */
function boardWithDecree(): GameState {
    return makeState({
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(DECREE, {
                        id: "decree",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                battlefield: [0, 1, 2].map((i) =>
                    makeInstance(PLAINS, {
                        id: `plains-${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                    })
                ),
                // Exactly the cycling cost: nothing is left floating for the
                // nomination, which is the whole point.
                manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 2 },
            }),
            makePlayer("p2"),
        ],
    });
}

/** Cycles the Decree through the same state function the `activateAbility`
 *  mutation calls, then resolves down to the suspended nomination. */
function cycleAndSuspend(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: BOT,
        cardInstanceId: "decree",
        abilityId: "cycling",
    });
    while (state.stack.length > 0 && !state.pendingChoices?.length) {
        if (resolveTopOfStack(state) === null && state.pendingChoices?.length) {
            break;
        }
    }
}

const soldiers = (state: GameState) =>
    state.players[0].battlefield.filter(
        (c) => c.isToken && c.subtypes?.includes("Soldier")
    );

/** `MoveMutations` bound to the REGISTERED `game.ts` handlers over one stub
 *  `MutationCtx`, so the executor's calls are re-validated by the server
 *  exactly as they are in a real game. Everything the nomination flow must not
 *  touch throws. */
function serverMutations(ctx: Parameters<typeof runMutation>[1]): {
    mutations: MoveMutations;
    calls: string[];
} {
    const calls: string[] = [];
    const reject = () => {
        throw new Error("unexpected mutation in the nomination flow");
    };
    const mutations = {
        playCard: reject,
        summonCompanion: reject,
        turnPermanentFaceUp: reject,
        announceCast: reject,
        selectTarget: reject,
        selectTargets: reject,
        confirmTargets: reject,
        tapForPayment: reject,
        tapUntap: async (a: {
            playerId: string;
            cardInstanceId: string;
            manaChoiceIndex?: number;
        }) => {
            calls.push(`tapUntap:${a.cardInstanceId}`);
            await runMutation(
                tapUntap as unknown as Handler<Record<string, unknown>, void>,
                ctx,
                { gameId: GAME_ID, ...a }
            );
        },
        activateAbility: reject,
        activatePlayerAbility: reject,
        activateManaAbility: reject,
        tapForActivationPayment: reject,
        selectSacrifice: reject,
        selectAdditionalCost: reject,
        selectCastExileCost: reject,
        selectActivationCost: reject,
        selectActivationExileCost: reject,
        selectActivationDiscardCost: reject,
        declareAttackers: reject,
        confirmAttackers: reject,
        declareBlockers: reject,
        confirmBlockers: reject,
        confirmDamage: reject,
        declareMulligan: reject,
        submitResolutionChoice: reject,
        submitMayPay: reject,
        submitMadnessDecline: reject,
        submitReboundDecline: reject,
        submitDrawReplacementPay: reject,
        submitLandEntryChoice: reject,
        submitNameCard: reject,
        submitNumberChoice: async (a: { playerId: string; amount: number }) => {
            calls.push(`submitNumberChoice:${a.amount}`);
            await runMutation(
                submitNumberChoice as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                ctx,
                { gameId: GAME_ID, ...a }
            );
        },
        submitRandomRevealAck: reject,
        passPriority: reject,
    } as unknown as MoveMutations;
    return { mutations, calls };
}

describe("the Bot pays a numeric nomination off untapped lands (CR 608.2g, issue #3569)", () => {
    it("enumerates a nomination above the empty pool, carrying the taps that fund it", () => {
        const state = boardWithDecree();
        cycleAndSuspend(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("number-pick");
        expect(head.paysMana).toBe(true);
        // The POOL is empty, so the server's live range is the decline alone —
        // and that was every move the Bot had.
        expect(numberChoiceRange(head, state.players[0])).toEqual({
            min: 0,
            max: 0,
        });

        const moves = enumerateMoves(state, BOT);
        const paying = moves.filter(
            (m) => m.kind === "number-choice" && m.amount > 0
        );
        expect(paying.length).toBeGreaterThan(0);
        for (const move of paying) {
            if (move.kind !== "number-choice") continue;
            expect(move.tapPlan ?? []).toHaveLength(move.amount);
        }
        expect(
            Math.max(
                ...moves.map((m) => (m.kind === "number-choice" ? m.amount : 0))
            )
        ).toBe(3);
    });

    it("executes that move against the REAL mutations — taps first, then the nomination the server now accepts", async () => {
        const state = boardWithDecree();
        cycleAndSuspend(state);
        const move = enumerateMoves(state, BOT).find(
            (m) => m.kind === "number-choice" && m.amount === 3
        )!;

        const stub = makeMutationCtx(BOT, [gameStateSeed(state)]);
        const { mutations, calls } = serverMutations(stub.ctx);
        await executeMove(move, { gameId: GAME_ID, botId: BOT, mutations });

        // The ORDER is the claim: three taps, then the submit. Reversed, the
        // server's live range is still 0 and the submit throws.
        expect(calls).toEqual([
            "tapUntap:plains-0",
            "tapUntap:plains-1",
            "tapUntap:plains-2",
            "submitNumberChoice:3",
        ]);

        const after = stub.state();
        expect(after.pendingChoices ?? []).toHaveLength(0);
        expect(soldiers(after)).toHaveLength(3);
        // CR 107.3f — the mana was really spent, and the lands are really down.
        expect(
            Object.values(after.players[0].manaPool).reduce((s, n) => s + n, 0)
        ).toBe(0);
        expect(
            after.players[0].battlefield.filter((c) => !c.isToken && c.isTapped)
        ).toHaveLength(3);

        // SURFACE (through the reducer, never a hand-built view): three 1/1
        // white Soldiers are what the client is shown.
        const projected = projectPublicState(after, 1, BOT);
        const wire = projected.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Soldier")
        );
        expect(wire).toHaveLength(3);
        expect(wire[0]).toMatchObject({ power: 1, toughness: 1 });
    });
});
