// The server's game-end Verdict Proposal judge (`verdictJudge.ts`, issue
// #9528): the action body bounds the payload, then authorizes through the
// guard, BEFORE any search runs; it hands the search the captured position,
// the clamped budget and the seed (so the move is the in-process search's);
// it discards a search the wall-clock backstop cut, and never throws for a
// search failure.
import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import { verdictProposals } from "../../tolaria.config.json";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ScenarioSpec } from "../debugScenarioSpec";
import { projectPublicState } from "../gameProjections";
import { buildBladeState } from "../gre/ai/blade/runner";
import { projectedToGameState } from "../gre/ai/stateAdapter";
import { searchWithTrace, type SearchBudget } from "../gre/search";
import {
    VERDICT_JUDGE_BACKSTOP_MS,
    VERDICT_JUDGE_KNOWLEDGE_MAX_CARDS,
    VERDICT_JUDGE_STATE_MAX_BYTES,
    judgeOnePosition,
    runVerdictJudge,
    type JudgePositionArgs,
} from "../verdictJudge";
import {
    VERDICT_JUDGE_MAX_ITERATIONS,
    VERDICT_JUDGE_POSITIONS_PER_GAME,
    claimJudgeConsult,
} from "../verdictJudgeGuard";
import {
    makeMutationCtx,
    runMutation,
    type Row,
} from "./gameMutationHarness.fixture";

/** The human ("me") on their own main phase, a land in hand. */
const HUMAN_MAIN_PHASE: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

const GAME = "game-1";

/** The position as the client captured it: the human seat's own projection. */
function capturedPosition() {
    const state = buildBladeState({
        label: "verdict judge server fixture",
        spec: HUMAN_MAIN_PHASE,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const human = state.players[0].id;
    return { human, projected: projectPublicState(state, 40, human) };
}

/** A finished vs-AI game whose human seat is `human`, owned by `human` —
 *  `seatBelongsToUser` accepts the user's own id as a seat handle. */
function seeds(human: string, extra: Row[] = []): Row[] {
    return [
        {
            _id: GAME,
            __table: "games",
            name: "Game",
            status: "finished",
            solo: true,
            vsAi: true,
            players: [{ id: human }, { id: `${human}-p2` }],
            createdAt: 0,
            updatedAt: 0,
        },
        {
            _id: "tick-1",
            __table: "gameTicks",
            gameId: GAME,
            seq: 40,
            phase: "ENDING",
            gameOver: true,
            updatedAt: 0,
        },
        ...extra,
    ];
}

/** An action ctx whose `runMutation` drives the guard's registered handler
 *  against the stub store, recording which function it was asked for. */
function actionCtx(stub: ReturnType<typeof makeMutationCtx>) {
    const called: string[] = [];
    const ctx = {
        runMutation: (
            ref: Parameters<typeof getFunctionName>[0],
            a: unknown
        ) => {
            called.push(getFunctionName(ref));
            return runMutation(claimJudgeConsult, stub.ctx, a);
        },
    } as unknown as Pick<ActionCtx, "runMutation">;
    return { ctx, called };
}

/** The real search, recording every budget it is asked to run at. */
function countingSearch() {
    const budgets: SearchBudget[] = [];
    const search: typeof searchWithTrace = (root, botId, budget, ...rest) => {
        budgets.push(budget);
        return searchWithTrace(root, botId, budget, ...rest);
    };
    return { search, budgets };
}

function args(
    human: string,
    projected: unknown,
    extra: Partial<JudgePositionArgs> = {}
): JudgePositionArgs {
    return {
        gameId: GAME as Id<"games">,
        state: projected,
        botId: human,
        iterations: verdictProposals.iterations,
        seed: verdictProposals.seed,
        ...extra,
    };
}

describe("verdict judge — the wiring to the search (issue #9528)", () => {
    it("the captured position, the judge's budget and seed reach the search, under the backstop, and the move is the in-process search's", async () => {
        const { human, projected } = capturedPosition();
        const stub = makeMutationCtx(human, seeds(human));
        const { ctx, called } = actionCtx(stub);
        const { search, budgets } = countingSearch();

        const served = await judgeOnePosition(
            ctx,
            args(human, projected),
            search
        );

        const local = searchWithTrace(
            projectedToGameState(projected, undefined, human),
            human,
            { iterations: verdictProposals.iterations },
            verdictProposals.seed
        );
        expect(called).toEqual(["verdictJudgeGuard:claimJudgeConsult"]);
        expect(budgets).toHaveLength(1);
        expect(budgets[0]).toMatchObject({
            iterations: verdictProposals.iterations,
            backstopMs: VERDICT_JUDGE_BACKSTOP_MS,
        });
        expect(budgets[0].timeMs).toBeUndefined();
        expect(served.outcome).toBe("move");
        expect(local.move).not.toBeNull();
        expect(served.move).toEqual(local.move);
        expect(served.searchMs).toBeGreaterThanOrEqual(0);
    });

    it("an oversized budget is searched at the clamp", async () => {
        const { human, projected } = capturedPosition();
        const stub = makeMutationCtx(human, seeds(human));
        const { ctx } = actionCtx(stub);
        const budgets: SearchBudget[] = [];
        // Records the budget and stops there: a search at the clamp is not
        // what this test pays for.
        const search: typeof searchWithTrace = (_root, _botId, budget) => {
            budgets.push(budget);
            throw new Error("stop after the budget");
        };
        await judgeOnePosition(
            ctx,
            args(human, projected, { iterations: 10 ** 9 }),
            search
        );
        expect(budgets).toHaveLength(1);
        expect(budgets[0].iterations).toBe(VERDICT_JUDGE_MAX_ITERATIONS);
        expect(budgets[0].timeMs).toBeUndefined();
    });
});

describe("verdict judge — rejections run no search (issue #9528)", () => {
    it("the guard's rejections: each with its message, no search, nothing written", async () => {
        const { human, projected } = capturedPosition();
        const cases: Array<[RegExp, ReturnType<typeof makeMutationCtx>]> = [
            [/Sign in to use the judge/, makeMutationCtx(null, seeds(human))],
            [
                /You are not the player of this game/,
                makeMutationCtx("someone-else", seeds(human)),
            ],
            [
                /The game is not over/,
                makeMutationCtx(
                    human,
                    seeds(human).map((r) =>
                        r.__table === "gameTicks"
                            ? { ...r, gameOver: false }
                            : r
                    )
                ),
            ],
            [
                /This game has no judge positions left/,
                makeMutationCtx(
                    human,
                    seeds(human, [
                        {
                            _id: "budget-1",
                            __table: "verdictJudgeBudgets",
                            gameId: GAME,
                            userId: human,
                            humanId: human,
                            botId: `${human}-p2`,
                            positions: VERDICT_JUDGE_POSITIONS_PER_GAME,
                            updatedAt: 0,
                        },
                    ])
                ),
            ],
        ];
        for (const [message, stub] of cases) {
            const { search, budgets } = countingSearch();
            const { ctx } = actionCtx(stub);
            await expect(
                judgeOnePosition(ctx, args(human, projected), search),
                String(message)
            ).rejects.toThrow(message);
            expect(budgets, String(message)).toEqual([]);
            expect(stub.writes, String(message)).toEqual([]);
        }
    });

    it("a position over the size bound is refused before the guard is called", async () => {
        const { human, projected } = capturedPosition();
        const stub = makeMutationCtx(human, seeds(human));
        const { ctx, called } = actionCtx(stub);
        const { search, budgets } = countingSearch();
        const oversized = {
            ...projected,
            padding: "x".repeat(VERDICT_JUDGE_STATE_MAX_BYTES),
        };
        await expect(
            judgeOnePosition(ctx, args(human, oversized), search)
        ).rejects.toThrow(/position is too large/);
        expect(called).toEqual([]);
        expect(budgets).toEqual([]);
    });

    it("knowledge over its bounds is refused before the guard is called", async () => {
        const { human, projected } = capturedPosition();
        const tooMany = [human, `${human}-p2`, "third"].map((playerId) => ({
            playerId,
            cardIds: [],
        }));
        const tooLong = [
            {
                playerId: human,
                cardIds: Array.from(
                    { length: VERDICT_JUDGE_KNOWLEDGE_MAX_CARDS + 1 },
                    () => "card"
                ),
            },
        ];
        for (const [knowledge, message] of [
            [tooMany, /knowledge names more than two seats/],
            [tooLong, /knowledge lists too many cards/],
        ] as const) {
            const stub = makeMutationCtx(human, seeds(human));
            const { ctx, called } = actionCtx(stub);
            const { search, budgets } = countingSearch();
            await expect(
                judgeOnePosition(
                    ctx,
                    args(human, projected, { knowledge: [...knowledge] }),
                    search
                )
            ).rejects.toThrow(message);
            expect(called).toEqual([]);
            expect(budgets).toEqual([]);
        }
    });

    it("knowledge naming a seat outside the game is refused by the guard, with no search", async () => {
        const { human, projected } = capturedPosition();
        const stub = makeMutationCtx(human, seeds(human));
        const { ctx } = actionCtx(stub);
        const { search, budgets } = countingSearch();
        await expect(
            judgeOnePosition(
                ctx,
                args(human, projected, {
                    knowledge: [{ playerId: "stranger-p1", cardIds: [] }],
                }),
                search
            )
        ).rejects.toThrow(/knowledge names a seat outside this game/);
        expect(budgets).toEqual([]);
        expect(stub.writes).toEqual([]);
    });
});

describe("verdict judge — answers that are not reproducible (issue #9528)", () => {
    it("a search the wall-clock backstop ended is discarded as search-error", () => {
        const { human, projected } = capturedPosition();
        const cut: typeof searchWithTrace = (...a) => {
            const r = searchWithTrace(...a);
            return { ...r, trace: { ...r.trace!, stoppedBy: "time" } };
        };
        const result = runVerdictJudge(
            { state: projected, botId: human, iterations: 10, seed: 1 },
            cut
        );
        expect(result).toMatchObject({
            move: null,
            outcome: "search-error",
        });
        expect(result.message).toMatch(/backstop cut the search short/);
    });

    it("a search that throws comes back as search-error, never a throw", () => {
        const { human, projected } = capturedPosition();
        const result = runVerdictJudge(
            {
                state: projected,
                botId: human,
                iterations: 10,
                seed: 1,
            },
            () => {
                throw new Error("search exploded");
            }
        );
        expect(result).toMatchObject({
            move: null,
            outcome: "search-error",
            message: "search exploded",
        });
    });
});
