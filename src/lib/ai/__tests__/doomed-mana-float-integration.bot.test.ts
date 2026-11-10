// Bot full path for the doomed-mana-source float (issue #8355): enumerated
// Move -> `executeMove` -> the REAL `game.ts` mutations.
//
//   605.3a  A player may activate a mana ability whenever they have priority.
//   106.4   Mana empties from the pool at the end of each step and phase.
//
// City of Traitors' "when you play another land, sacrifice this land" is on
// the stack with City untapped. The Bot taps City in response through
// `tapUntap` — the same mutation a human's click on the land makes — both
// seats pass through `passPriority`, the sacrifice resolves, and the {C}{C} is
// still in the pool, where `announceCast` + `tapForPayment` spend it on a
// {2}{G} creature with the new Forest. What this proves that the GRE test
// cannot: the server accepts the float as a standalone activation with the
// trigger on the stack, keeps its mana through the resolution, and accepts
// the spend.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    announceCast,
    passPriority,
    tapForPayment,
    tapUntap,
} from "@convex/game";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
    type Row,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { GameState } from "@convex/gre/state";
import { enumerateMoves } from "@convex/gre/moves";
import { buildPositionFromSpec } from "@convex/gre/ai/blade/build";
import { findBladeScenario } from "@convex/gre/ai/blade/registry";
import type { Id } from "@convex/_generated/dataModel";
import { executeMove, type MoveMutations } from "../executor";

const GAME_ID = "game-1" as Id<"games">;
const SPENDER_LABEL =
    "doomed mana float: City of Traitors taps in response to its own sacrifice to fund a three-drop (#8355)";
const CITY = getCardByName("City of Traitors").id;
const SENTINEL = getCardByName("Sentinel of the Nameless City").id;

function position(): GameState {
    const scenario = findBladeScenario(SPENDER_LABEL);
    if (!scenario) throw new Error("missing blade entry");
    return buildPositionFromSpec(scenario.spec, scenario.setup, SPENDER_LABEL);
}

type Ctx = Parameters<typeof runMutation>[1];
const real =
    (handler: unknown, ctx: Ctx, calls: string[], name: string) =>
    async (args: Record<string, unknown>) => {
        calls.push(name);
        await runMutation(
            handler as Handler<Record<string, unknown>, void>,
            ctx,
            { gameId: GAME_ID, ...args }
        );
    };

/** `MoveMutations` bound to the REGISTERED handlers this flow uses; every
 *  other mutation throws. */
function serverMutations(ctx: Ctx, calls: string[]): MoveMutations {
    return new Proxy(
        {
            tapUntap: real(tapUntap, ctx, calls, "tapUntap"),
            announceCast: real(announceCast, ctx, calls, "announceCast"),
            tapForPayment: real(tapForPayment, ctx, calls, "tapForPayment"),
        } as Record<string, unknown>,
        {
            get(target, key: string) {
                if (key in target) return target[key];
                return () => {
                    throw new Error(`unexpected mutation ${key}`);
                };
            },
        }
    ) as unknown as MoveMutations;
}

/** Drive one seat's real mutation over the persisted row, returning the next
 *  row. The row is carried COMPACT, exactly as `saveGameState` wrote it: a
 *  re-seeded expanded state would be read back as if it were compact. */
async function step(
    row: Row,
    act: (ctx: Ctx) => Promise<unknown>,
    as: string
): Promise<{ row: Row; state: GameState }> {
    const stub = makeMutationCtx(as, [row]);
    await act(stub.ctx);
    return { row: { ...stub.doc("gs-1") }, state: stub.state() };
}

const pool = (state: GameState) =>
    Object.values(state.players[0].manaPool).reduce((s, n) => s + n, 0);
const defIdOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

describe("the Bot floats a doomed source's mana through the real mutations (CR 605.3a / 106.4, issue #8355)", () => {
    it("tapUntap floats {C}{C} with the trigger on the stack, the mana survives the sacrifice, and the cast spends it", async () => {
        let state = position();
        let row = gameStateSeed(state);
        const bot = state.players[0].id;
        const opp = state.players[1].id;
        const calls: string[] = [];

        const float = enumerateMoves(state, bot).find(
            (m) => m.kind === "activate-mana-ability"
        );
        expect(float).toBeDefined();
        ({ row, state } = await step(
            row,
            (ctx) =>
                executeMove(float!, {
                    gameId: GAME_ID,
                    botId: bot,
                    mutations: serverMutations(ctx, calls),
                }),
            bot
        ));
        expect(calls).toEqual(["tapUntap"]);
        expect(state.stack).toHaveLength(1);
        expect(state.players[0].manaPool.C).toBe(2);

        // Both seats pass: the sacrifice trigger resolves (CR 117.4).
        for (const pid of [bot, opp]) {
            ({ row, state } = await step(
                row,
                (ctx) =>
                    runMutation(
                        passPriority as unknown as Handler<
                            Record<string, unknown>,
                            void
                        >,
                        ctx,
                        { gameId: GAME_ID, playerId: pid }
                    ),
                pid
            ));
        }
        expect(state.stack).toHaveLength(0);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(
            state.players[0].battlefield.some((c) => defIdOf(c) === CITY)
        ).toBe(false);
        expect(state.players[0].manaPool.C).toBe(2);

        const cast = enumerateMoves(state, bot).find(
            (m) => m.kind === "cast-spell"
        );
        expect(cast).toBeDefined();
        ({ row, state } = await step(
            row,
            (ctx) =>
                executeMove(cast!, {
                    gameId: GAME_ID,
                    botId: bot,
                    mutations: serverMutations(ctx, calls),
                }),
            bot
        ));
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map(defIdOf)).toEqual([SENTINEL]);
        expect(pool(state)).toBe(0);
    });
});
