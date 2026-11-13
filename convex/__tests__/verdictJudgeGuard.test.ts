// The guard in front of the server's game-end Verdict Proposal judge
// (`verdictJudgeGuard.claimJudgeConsult`, issue #9528): who may ask, when, how
// many times per game and per user, at what budget, and what it reads —
// driven through the REGISTERED handler against the shared stub ctx. And the
// per-game counter row is deleted with its game (`deleteGameCascade`).
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteGameCascade } from "../matches";
import {
    VERDICT_JUDGE_MAX_ITERATIONS,
    VERDICT_JUDGE_POSITIONS_PER_GAME,
    VERDICT_JUDGE_POSITIONS_PER_USER,
    VERDICT_JUDGE_USER_WINDOW_MS,
    claimJudgeConsult,
} from "../verdictJudgeGuard";
import {
    makeMutationCtx,
    runMutation,
    type Row,
} from "./gameMutationHarness.fixture";

const USER = "u1";
const HUMAN = `${USER}-p1`;
const BOT = `${USER}-p2`;
const GAME = "game-1";

function seeds(
    opts: {
        game?: Partial<Row>;
        gameOver?: boolean | null;
        positions?: number;
        userBudget?: Partial<Row>;
    } = {}
): Row[] {
    const rows: Row[] = [
        {
            _id: GAME,
            __table: "games",
            name: "Game",
            status: "finished",
            solo: true,
            vsAi: true,
            players: [{ id: HUMAN }, { id: BOT }],
            createdAt: 0,
            updatedAt: 0,
            ...opts.game,
        },
    ];
    if (opts.gameOver !== null) {
        rows.push({
            _id: "tick-1",
            __table: "gameTicks",
            gameId: GAME,
            seq: 40,
            phase: "ENDING",
            gameOver: opts.gameOver ?? true,
            updatedAt: 0,
        });
    }
    if (opts.positions !== undefined) {
        rows.push({
            _id: "budget-1",
            __table: "verdictJudgeBudgets",
            gameId: GAME,
            userId: USER,
            humanId: HUMAN,
            botId: BOT,
            positions: opts.positions,
            updatedAt: 0,
        });
    }
    if (opts.userBudget) {
        rows.push({
            _id: "user-budget-1",
            __table: "verdictJudgeUserBudgets",
            userId: USER,
            windowStart: Date.now(),
            positions: 0,
            ...opts.userBudget,
        });
    }
    return rows;
}

function claim(
    ctx: MutationCtx,
    extra: Partial<{
        seatId: string;
        knowledgeSeats: string[];
        iterations: number;
        seed: number;
    }> = {}
): Promise<{ iterations: number }> {
    return runMutation(claimJudgeConsult, ctx, {
        gameId: GAME,
        seatId: HUMAN,
        knowledgeSeats: [HUMAN],
        iterations: 400,
        seed: 1,
        ...extra,
    });
}

function rowsOf(
    stub: ReturnType<typeof makeMutationCtx>,
    table: string
): Row[] {
    const ids = new Set(
        stub.writes.filter((w) => w.table === table).map((w) => w.id)
    );
    return [...ids].map((id) => stub.doc(id));
}

describe("verdictJudgeGuard.claimJudgeConsult — an accepted call (issue #9528)", () => {
    it("returns the requested budget and counts the position on the game and the user", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await expect(claim(stub.ctx)).resolves.toEqual({ iterations: 400 });
        await expect(claim(stub.ctx)).resolves.toEqual({ iterations: 400 });
        const games = rowsOf(stub, "verdictJudgeBudgets");
        expect(games).toHaveLength(1);
        expect(games[0]).toMatchObject({
            gameId: GAME,
            userId: USER,
            humanId: HUMAN,
            botId: BOT,
            positions: 2,
        });
        const users = rowsOf(stub, "verdictJudgeUserBudgets");
        expect(users).toHaveLength(1);
        expect(users[0]).toMatchObject({ userId: USER, positions: 2 });
    });

    it("clamps an oversized iteration budget to the hardest preset's", async () => {
        const stub = makeMutationCtx(USER, seeds());
        const asked = VERDICT_JUDGE_MAX_ITERATIONS * 1000;
        await expect(claim(stub.ctx, { iterations: asked })).resolves.toEqual({
            iterations: VERDICT_JUDGE_MAX_ITERATIONS,
        });
    });

    it("reads the games row and the tick on the first claim only", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await claim(stub.ctx);
        expect(stub.gets).toEqual([GAME]);
        expect(stub.queried).toContain("gameTicks");

        stub.gets.length = 0;
        stub.queried.length = 0;
        await claim(stub.ctx);
        expect(stub.gets).toEqual([]);
        expect(stub.queried).not.toContain("gameTicks");
        expect(stub.queried).toContain("verdictJudgeBudgets");
    });
});

describe("verdictJudgeGuard.claimJudgeConsult — rejections write nothing (issue #9528)", () => {
    it("rejects an unauthenticated caller", async () => {
        const stub = makeMutationCtx(null, seeds());
        await expect(claim(stub.ctx)).rejects.toThrow(
            /Sign in to use the judge/
        );
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a caller who is not the human of the game, on the first claim and on a later one", async () => {
        const first = makeMutationCtx("u2", seeds());
        await expect(claim(first.ctx)).rejects.toThrow(
            /You are not the player of this game/
        );
        expect(first.writes).toHaveLength(0);
        const later = makeMutationCtx("u2", seeds({ positions: 3 }));
        await expect(claim(later.ctx)).rejects.toThrow(
            /You are not the player of this game/
        );
        expect(later.writes).toHaveLength(0);
    });

    it("rejects a game that is not vs-AI", async () => {
        const stub = makeMutationCtx(USER, seeds({ game: { vsAi: false } }));
        await expect(claim(stub.ctx)).rejects.toThrow(/no Bot seat/);
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a search of the Bot's seat, on the first claim and on a later one", async () => {
        const first = makeMutationCtx(USER, seeds());
        await expect(claim(first.ctx, { seatId: BOT })).rejects.toThrow(
            /human seat only/
        );
        const later = makeMutationCtx(USER, seeds({ positions: 3 }));
        await expect(claim(later.ctx, { seatId: BOT })).rejects.toThrow(
            /human seat only/
        );
        expect([...first.writes, ...later.writes]).toHaveLength(0);
    });

    it("rejects knowledge naming a seat outside the game", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await expect(
            claim(stub.ctx, { knowledgeSeats: [HUMAN, "someone-p1"] })
        ).rejects.toThrow(/knowledge names a seat outside this game/);
        expect(stub.writes).toHaveLength(0);
        await expect(
            claim(stub.ctx, { knowledgeSeats: [HUMAN, BOT] })
        ).resolves.toEqual({ iterations: 400 });
    });

    it("rejects a game that is not over", async () => {
        const live = makeMutationCtx(USER, seeds({ gameOver: false }));
        await expect(claim(live.ctx)).rejects.toThrow(/The game is not over/);
        expect(live.writes).toHaveLength(0);
        const noTick = makeMutationCtx(USER, seeds({ gameOver: null }));
        await expect(claim(noTick.ctx)).rejects.toThrow(/The game is not over/);
        expect(noTick.writes).toHaveLength(0);
    });

    it("rejects a call past the per-game position bound", async () => {
        const stub = makeMutationCtx(
            USER,
            seeds({ positions: VERDICT_JUDGE_POSITIONS_PER_GAME - 1 })
        );
        await expect(claim(stub.ctx)).resolves.toEqual({ iterations: 400 });
        expect(stub.doc("budget-1").positions).toBe(
            VERDICT_JUDGE_POSITIONS_PER_GAME
        );
        const writes = stub.writes.length;
        await expect(claim(stub.ctx)).rejects.toThrow(
            /This game has no judge positions left/
        );
        expect(stub.writes).toHaveLength(writes);
    });

    it("rejects a call past the per-user daily bound, and a new window starts once 24 h have elapsed", async () => {
        const full = makeMutationCtx(
            USER,
            seeds({
                userBudget: { positions: VERDICT_JUDGE_POSITIONS_PER_USER },
            })
        );
        await expect(claim(full.ctx)).rejects.toThrow(
            /You have no judge positions left today/
        );
        expect(full.writes).toHaveLength(0);

        const elapsed = makeMutationCtx(
            USER,
            seeds({
                userBudget: {
                    positions: VERDICT_JUDGE_POSITIONS_PER_USER,
                    windowStart: Date.now() - VERDICT_JUDGE_USER_WINDOW_MS,
                },
            })
        );
        await expect(claim(elapsed.ctx)).resolves.toEqual({ iterations: 400 });
        expect(elapsed.doc("user-budget-1").positions).toBe(1);
    });

    it("rejects an iteration budget or seed that is not an integer", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await expect(claim(stub.ctx, { iterations: 0 })).rejects.toThrow(
            /iterations must be a positive integer/
        );
        await expect(claim(stub.ctx, { iterations: 2.5 })).rejects.toThrow(
            /iterations must be a positive integer/
        );
        await expect(claim(stub.ctx, { seed: 0.5 })).rejects.toThrow(
            /seed must be an integer/
        );
        expect(stub.writes).toHaveLength(0);
    });
});

describe("deleteGameCascade — the judge's counter rows (issue #9528)", () => {
    it("deletes the game's verdictJudgeBudgets row with the game, never the user's row", async () => {
        const stub = makeMutationCtx(USER, [
            ...seeds({ positions: 7, userBudget: { positions: 7 } }),
            {
                _id: "budget-other",
                __table: "verdictJudgeBudgets",
                gameId: "game-2",
                positions: 3,
                updatedAt: 0,
            },
        ]);
        await deleteGameCascade(stub.ctx, GAME as Id<"games">);
        expect(stub.deletes).toContain("budget-1");
        expect(stub.deletes).not.toContain("budget-other");
        expect(stub.deletes).not.toContain("user-budget-1");
    });
});
