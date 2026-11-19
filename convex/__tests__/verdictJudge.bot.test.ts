// The server's game-end Verdict Proposal judge (`verdictJudge.ts`, issue
// #9528): the action body bounds the payload, then authorizes through the
// guard, BEFORE any search runs; it hands the search the captured position,
// the clamped budget and the seed (so the move is the in-process search's);
// it discards a search the wall-clock backstop cut, and never throws for a
// search failure. Issue #10024: the same contract holds when the game's search
// runs in the Node twin (`verdictJudgeNode.ts`) — every wiring and rejection
// test runs once per runtime — and the answer names the runtime it ran in.
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
    VERDICT_JUDGE_NODE_SHARE,
    VERDICT_JUDGE_STATE_MAX_BYTES,
    judgeOnePosition,
    runVerdictJudge,
    verdictJudgeRuntime,
    type JudgePositionArgs,
    type VerdictJudgeRuntime,
} from "../verdictJudge";
import { searchPosition } from "../verdictJudgeNode";
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

/** One game per runtime: `verdictJudgeRuntime` routes `game-1` to Node and
 *  `game-2` to the default runtime (pinned below). */
const GAME_BY_RUNTIME: Record<VerdictJudgeRuntime, string> = {
    node: "game-1",
    default: "game-2",
};
const RUNTIMES = ["default", "node"] as const satisfies VerdictJudgeRuntime[];

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
 *  `seatBelongsToUser` accepts the user's own id as a seat handle. Every
 *  caller the tests sign in as is a tester: the judge is tester-only (issue
 *  #10229). */
function seeds(human: string, extra: Row[] = [], game = "game-1"): Row[] {
    return [
        ...[human, "someone-else"].map((id) => ({
            _id: id,
            __table: "users",
            isTester: true,
        })),
        {
            _id: game,
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
            gameId: game,
            seq: 40,
            phase: "ENDING",
            gameOver: true,
            updatedAt: 0,
        },
        ...extra,
    ];
}

type NodeCall = { name: string; args: Record<string, unknown> };

/** An action ctx whose `runMutation` drives the guard's registered handler
 *  against the stub store, and whose `runAction` drives the Node twin's
 *  registered handler (or `nodeAction`, standing in for it), recording which
 *  function each was asked for and with what. */
function actionCtx(
    stub: ReturnType<typeof makeMutationCtx>,
    nodeAction?: (args: Record<string, unknown>) => unknown
) {
    const called: string[] = [];
    const nodeCalls: NodeCall[] = [];
    const ctx = {
        runMutation: (
            ref: Parameters<typeof getFunctionName>[0],
            a: unknown
        ) => {
            called.push(getFunctionName(ref));
            return runMutation(claimJudgeConsult, stub.ctx, a);
        },
        runAction: async (
            ref: Parameters<typeof getFunctionName>[0],
            a: Record<string, unknown>
        ) => {
            called.push(getFunctionName(ref));
            nodeCalls.push({ name: getFunctionName(ref), args: a });
            if (nodeAction) return nodeAction(a);
            return (
                searchPosition as unknown as {
                    _handler: (ctx: unknown, a: unknown) => unknown;
                }
            )._handler({}, a);
        },
    } as unknown as Pick<ActionCtx, "runMutation" | "runAction">;
    return { ctx, called, nodeCalls };
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

/** Which iteration budgets a search was started at, in either runtime: the
 *  in-process search's budgets, or the Node twin's `iterations` argument. */
function searchedAt(budgets: SearchBudget[], nodeCalls: NodeCall[]): number[] {
    return [
        ...budgets.map((b) => b.iterations as number),
        ...nodeCalls.map((c) => c.args.iterations as number),
    ];
}

function args(
    human: string,
    projected: unknown,
    extra: Partial<JudgePositionArgs> = {},
    game = "game-1"
): JudgePositionArgs {
    return {
        gameId: game as Id<"games">,
        state: projected,
        botId: human,
        iterations: verdictProposals.iterations,
        seed: verdictProposals.seed,
        ...extra,
    };
}

describe("verdict judge — the runtime is the server's, per game (issue #10024)", () => {
    it("routes each fixture game to the runtime the tests below name", () => {
        for (const runtime of RUNTIMES) {
            expect(verdictJudgeRuntime(GAME_BY_RUNTIME[runtime])).toBe(runtime);
        }
    });

    it("splits games by the Node share, and a share of 0 routes none to Node", () => {
        const ids = Array.from({ length: 2000 }, (_, i) => `k${i * 7919}`);
        const node = ids.filter((g) => verdictJudgeRuntime(g) === "node");
        expect(node.length / ids.length).toBeGreaterThan(
            VERDICT_JUDGE_NODE_SHARE - 0.05
        );
        expect(node.length / ids.length).toBeLessThan(
            VERDICT_JUDGE_NODE_SHARE + 0.05
        );
        expect(ids.filter((g) => verdictJudgeRuntime(g, 0) === "node")).toEqual(
            []
        );
    });
});

describe.each(RUNTIMES)(
    "verdict judge — the wiring to the search, %s runtime (issues #9528, #10024)",
    (runtime) => {
        const game = GAME_BY_RUNTIME[runtime];

        it("the captured position, the judge's budget and seed reach the search, and the move is the in-process search's", async () => {
            const { human, projected } = capturedPosition();
            const stub = makeMutationCtx(human, seeds(human, [], game));
            const { ctx, called, nodeCalls } = actionCtx(stub);
            const { search, budgets } = countingSearch();

            const served = await judgeOnePosition(
                ctx,
                args(human, projected, {}, game),
                search
            );

            const local = searchWithTrace(
                projectedToGameState(projected, undefined, human),
                human,
                { iterations: verdictProposals.iterations },
                verdictProposals.seed
            );
            expect(served.runtime).toBe(runtime);
            expect(searchedAt(budgets, nodeCalls)).toEqual([
                verdictProposals.iterations,
            ]);
            if (runtime === "default") {
                expect(called).toEqual(["verdictJudgeGuard:claimJudgeConsult"]);
                expect(budgets[0]).toMatchObject({
                    backstopMs: VERDICT_JUDGE_BACKSTOP_MS,
                });
                expect(budgets[0].timeMs).toBeUndefined();
            } else {
                // The guard first, in the default runtime; then the Node
                // twin, handed the position, the clamped budget and the seed
                // — and no game, no caller: it searches what it is given.
                expect(called).toEqual([
                    "verdictJudgeGuard:claimJudgeConsult",
                    "verdictJudgeNode:searchPosition",
                ]);
                expect(nodeCalls[0].args).toEqual({
                    state: projected,
                    botId: human,
                    iterations: verdictProposals.iterations,
                    seed: verdictProposals.seed,
                });
            }
            expect(served.outcome).toBe("move");
            expect(local.move).not.toBeNull();
            expect(served.move).toEqual(local.move);
            expect(served.searchMs).toBeGreaterThanOrEqual(0);
        });

        it("an oversized budget is searched at the clamp", async () => {
            const { human, projected } = capturedPosition();
            const stub = makeMutationCtx(human, seeds(human, [], game));
            // Records the budget and stops there: a search at the clamp is
            // not what this test pays for.
            const stop = () => {
                throw new Error("stop after the budget");
            };
            const { ctx, nodeCalls } = actionCtx(stub, stop);
            const budgets: SearchBudget[] = [];
            const search: typeof searchWithTrace = (_root, _botId, budget) => {
                budgets.push(budget);
                return stop();
            };
            const served = await judgeOnePosition(
                ctx,
                args(human, projected, { iterations: 10 ** 9 }, game),
                search
            );
            expect(searchedAt(budgets, nodeCalls)).toEqual([
                VERDICT_JUDGE_MAX_ITERATIONS,
            ]);
            expect(budgets.every((b) => b.timeMs === undefined)).toBe(true);
            expect(served).toMatchObject({
                move: null,
                outcome: "search-error",
                runtime,
            });
        });
    }
);

describe("verdict judge — the Node twin failing (issue #10024)", () => {
    it("costs that one decision as search-error naming the runtime, never a throw", async () => {
        const { human, projected } = capturedPosition();
        const game = GAME_BY_RUNTIME.node;
        const stub = makeMutationCtx(human, seeds(human, [], game));
        const { ctx } = actionCtx(stub, () => {
            throw new Error("JavaScript heap out of memory");
        });
        const served = await judgeOnePosition(
            ctx,
            args(human, projected, {}, game)
        );
        expect(served).toMatchObject({
            move: null,
            outcome: "search-error",
            runtime: "node",
        });
        expect(served.message).toMatch(
            /Node judge failed: JavaScript heap out of memory/
        );
        expect(served.searchMs).toBeGreaterThanOrEqual(0);
        // The consult was claimed before the search: it is counted.
        expect(stub.writes.length).toBeGreaterThan(0);
    });
});

describe.each(RUNTIMES)(
    "verdict judge — rejections run no search, %s runtime (issues #9528, #10024)",
    (runtime) => {
        const game = GAME_BY_RUNTIME[runtime];

        it("the guard's rejections: each with its message, no search, nothing written", async () => {
            const { human, projected } = capturedPosition();
            const cases: Array<[RegExp, ReturnType<typeof makeMutationCtx>]> = [
                [
                    /Sign in to use the judge/,
                    makeMutationCtx(null, seeds(human, [], game)),
                ],
                [
                    /You are not the player of this game/,
                    makeMutationCtx("someone-else", seeds(human, [], game)),
                ],
                [
                    /The judge is open to testers only/,
                    makeMutationCtx(
                        human,
                        seeds(human, [], game).map((r) =>
                            r.__table === "users"
                                ? { ...r, isTester: false }
                                : r
                        )
                    ),
                ],
                [
                    /The game is not over/,
                    makeMutationCtx(
                        human,
                        seeds(human, [], game).map((r) =>
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
                        seeds(
                            human,
                            [
                                {
                                    _id: "budget-1",
                                    __table: "verdictJudgeBudgets",
                                    gameId: game,
                                    userId: human,
                                    humanId: human,
                                    botId: `${human}-p2`,
                                    positions: VERDICT_JUDGE_POSITIONS_PER_GAME,
                                    updatedAt: 0,
                                },
                            ],
                            game
                        )
                    ),
                ],
            ];
            for (const [message, stub] of cases) {
                const { search, budgets } = countingSearch();
                const { ctx, nodeCalls } = actionCtx(stub);
                await expect(
                    judgeOnePosition(
                        ctx,
                        args(human, projected, {}, game),
                        search
                    ),
                    String(message)
                ).rejects.toThrow(message);
                expect(searchedAt(budgets, nodeCalls), String(message)).toEqual(
                    []
                );
                expect(stub.writes, String(message)).toEqual([]);
            }
        });

        it("a position over the size bound is refused before the guard is called", async () => {
            const { human, projected } = capturedPosition();
            const stub = makeMutationCtx(human, seeds(human, [], game));
            const { ctx, called, nodeCalls } = actionCtx(stub);
            const { search, budgets } = countingSearch();
            const oversized = {
                ...projected,
                padding: "x".repeat(VERDICT_JUDGE_STATE_MAX_BYTES),
            };
            await expect(
                judgeOnePosition(ctx, args(human, oversized, {}, game), search)
            ).rejects.toThrow(/position is too large/);
            expect(called).toEqual([]);
            expect(searchedAt(budgets, nodeCalls)).toEqual([]);
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
                const stub = makeMutationCtx(human, seeds(human, [], game));
                const { ctx, called, nodeCalls } = actionCtx(stub);
                const { search, budgets } = countingSearch();
                await expect(
                    judgeOnePosition(
                        ctx,
                        args(
                            human,
                            projected,
                            { knowledge: [...knowledge] },
                            game
                        ),
                        search
                    )
                ).rejects.toThrow(message);
                expect(called).toEqual([]);
                expect(searchedAt(budgets, nodeCalls)).toEqual([]);
            }
        });

        it("knowledge naming a seat outside the game is refused by the guard, with no search", async () => {
            const { human, projected } = capturedPosition();
            const stub = makeMutationCtx(human, seeds(human, [], game));
            const { ctx, nodeCalls } = actionCtx(stub);
            const { search, budgets } = countingSearch();
            await expect(
                judgeOnePosition(
                    ctx,
                    args(
                        human,
                        projected,
                        {
                            knowledge: [
                                { playerId: "stranger-p1", cardIds: [] },
                            ],
                        },
                        game
                    ),
                    search
                )
            ).rejects.toThrow(/knowledge names a seat outside this game/);
            expect(searchedAt(budgets, nodeCalls)).toEqual([]);
            expect(stub.writes).toEqual([]);
        });
    }
);

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
