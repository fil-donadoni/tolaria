// The server's game-end Verdict Proposal judge (`verdictJudge.ts`, issue
// #9528): the action body authorizes through the guard BEFORE any search runs,
// searches at the budget the guard clamped, never throws for a search failure,
// and answers a captured position exactly as the in-process search does at
// the same iteration budget and seed — the reproducibility the judge exists
// for.
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

describe("verdict judge — the server's answer is the in-process search's (issue #9528)", () => {
    it("a blade position at the judge's fixed budget and seed: the same move", async () => {
        const { human, projected } = capturedPosition();
        const stub = makeMutationCtx(human, seeds(human));
        const { ctx, called } = actionCtx(stub);

        const served = await judgeOnePosition(ctx, args(human, projected));

        const local = searchWithTrace(
            projectedToGameState(projected, undefined, human),
            human,
            { iterations: verdictProposals.iterations },
            verdictProposals.seed
        );
        expect(called).toEqual(["verdictJudgeGuard:claimJudgeConsult"]);
        expect(served.outcome).toBe("move");
        expect(local.move).not.toBeNull();
        expect(served.move).toEqual(local.move);
        expect(served.searchMs).toBeGreaterThanOrEqual(0);
    });
});

describe("verdict judge — the guard runs before any search (issue #9528)", () => {
    it("rejected callers and calls run no search", async () => {
        const { human, projected } = capturedPosition();
        const cases: Array<[string, ReturnType<typeof makeMutationCtx>]> = [
            ["unauthenticated", makeMutationCtx(null, seeds(human))],
            ["non-participant", makeMutationCtx("someone-else", seeds(human))],
            [
                "game not over",
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
                "past the per-game bound",
                makeMutationCtx(
                    human,
                    seeds(human, [
                        {
                            _id: "budget-1",
                            __table: "verdictJudgeBudgets",
                            gameId: GAME,
                            positions: VERDICT_JUDGE_POSITIONS_PER_GAME,
                            updatedAt: 0,
                        },
                    ])
                ),
            ],
        ];
        for (const [label, stub] of cases) {
            const { search, budgets } = countingSearch();
            const { ctx } = actionCtx(stub);
            await expect(
                judgeOnePosition(ctx, args(human, projected), search),
                label
            ).rejects.toThrow();
            expect(budgets, label).toEqual([]);
            expect(stub.writes, label).toEqual([]);
        }
    });

    it("an oversized budget is searched at the clamp, with no time cap", async () => {
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
        expect(budgets).toEqual([{ iterations: VERDICT_JUDGE_MAX_ITERATIONS }]);
    });
});

describe("verdict judge — a search failure (issue #9528)", () => {
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
