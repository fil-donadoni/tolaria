// The guard in front of the server's game-end Verdict Proposal judge
// (`verdictJudgeGuard.claimJudgeConsult`, issue #9528): who may ask, when, how
// many times per game and at what budget — driven through the REGISTERED
// handler against the shared stub ctx. And the counter row it writes is
// deleted with its game (`deleteGameCascade`).
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteGameCascade } from "../matches";
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

const USER = "u1";
const HUMAN = `${USER}-p1`;
const BOT = `${USER}-p2`;
const GAME = "game-1";

function seeds(
    opts: {
        game?: Partial<Row>;
        gameOver?: boolean | null;
        positions?: number;
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
            positions: opts.positions,
            updatedAt: 0,
        });
    }
    return rows;
}

function claim(
    ctx: MutationCtx,
    extra: Partial<{ seatId: string; iterations: number; seed: number }> = {}
): Promise<{ iterations: number }> {
    return runMutation(claimJudgeConsult, ctx, {
        gameId: GAME,
        seatId: HUMAN,
        iterations: 400,
        seed: 1,
        ...extra,
    });
}

function budgetRows(stub: ReturnType<typeof makeMutationCtx>): Row[] {
    return stub.writes
        .filter((w) => w.table === "verdictJudgeBudgets")
        .map((w) => stub.doc(w.id));
}

describe("verdictJudgeGuard.claimJudgeConsult — an accepted call (issue #9528)", () => {
    it("returns the requested budget and counts the position on the game", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await expect(claim(stub.ctx)).resolves.toEqual({ iterations: 400 });
        await expect(claim(stub.ctx)).resolves.toEqual({ iterations: 400 });
        const rows = budgetRows(stub);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ gameId: GAME, positions: 2 });
    });

    it("clamps an oversized iteration budget to the hardest preset's", async () => {
        const stub = makeMutationCtx(USER, seeds());
        const asked = VERDICT_JUDGE_MAX_ITERATIONS * 1000;
        await expect(claim(stub.ctx, { iterations: asked })).resolves.toEqual({
            iterations: VERDICT_JUDGE_MAX_ITERATIONS,
        });
    });
});

describe("verdictJudgeGuard.claimJudgeConsult — rejections write nothing (issue #9528)", () => {
    it("rejects an unauthenticated caller", async () => {
        const stub = makeMutationCtx(null, seeds());
        await expect(claim(stub.ctx)).rejects.toThrow();
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a caller who is not the human of the game", async () => {
        const stub = makeMutationCtx("u2", seeds());
        await expect(claim(stub.ctx)).rejects.toThrow(/not the player/);
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a game that is not vs-AI", async () => {
        const stub = makeMutationCtx(USER, seeds({ game: { vsAi: false } }));
        await expect(claim(stub.ctx)).rejects.toThrow(/no Bot seat/);
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a search of the Bot's seat", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await expect(claim(stub.ctx, { seatId: BOT })).rejects.toThrow(
            /human seat only/
        );
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a game that is not over", async () => {
        const live = makeMutationCtx(USER, seeds({ gameOver: false }));
        await expect(claim(live.ctx)).rejects.toThrow(/not over/);
        expect(live.writes).toHaveLength(0);
        const noTick = makeMutationCtx(USER, seeds({ gameOver: null }));
        await expect(claim(noTick.ctx)).rejects.toThrow(/not over/);
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
        await expect(claim(stub.ctx)).rejects.toThrow(/no judge positions/);
        expect(stub.writes).toHaveLength(writes);
        expect(stub.doc("budget-1").positions).toBe(
            VERDICT_JUDGE_POSITIONS_PER_GAME
        );
    });

    it("rejects an iteration budget or seed that is not an integer", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await expect(claim(stub.ctx, { iterations: 0 })).rejects.toThrow(
            /positive integer/
        );
        await expect(claim(stub.ctx, { iterations: 2.5 })).rejects.toThrow(
            /positive integer/
        );
        await expect(claim(stub.ctx, { seed: 0.5 })).rejects.toThrow(
            /seed must be an integer/
        );
        expect(stub.writes).toHaveLength(0);
    });
});

describe("deleteGameCascade — the judge's counter row (issue #9528)", () => {
    it("deletes the game's verdictJudgeBudgets row with the game", async () => {
        const stub = makeMutationCtx(USER, [
            ...seeds({ positions: 7 }),
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
        expect(stub.doc("budget-other")).toBeDefined();
    });
});
