// The guard in front of the game-end Verdict Proposal judge
// (`convex/verdictJudge.ts`, GLOSSARY.md § Verdict Proposal).
//
// The judge is a PUBLIC action that runs a Brain search on the server, so
// every call is authorized here BEFORE any search runs. A call is accepted only
// when:
//
//   - the caller is authenticated and owns the HUMAN seat of a vs-AI game
//     (`vsAiSeats`), and the seat searched is that human seat — the judge
//     judges the player's own decisions, from the player's own view; every
//     seat `knowledge` names is one of the game's two seats;
//   - the game is OVER: its `gameTicks` row says `gameOver`. That row is
//     written by `saveGameState` (the sole writer) in the same transaction as
//     the snapshot whose `state.gameOver` it mirrors, so it is as
//     authoritative as the fat `gameStates` row and costs ~150 bytes to read
//     instead of the whole position;
//   - the game's position counter is under `VERDICT_JUDGE_POSITIONS_PER_GAME`
//     and the caller's daily counter under `VERDICT_JUDGE_POSITIONS_PER_USER`.
//
// READS. The full check (the ~8 KB `games` row with its decklists, the tick)
// runs on a game's FIRST accepted claim only. That claim stores the caller
// and the two seats on the game's counter row; every later claim reads that
// small row instead, and is accepted iff its caller and seats match — a game
// that was over stays over. Database bandwidth is billed by the whole
// document read, so the fat row is read once per game, not once per position.
//
// The requested iteration budget is clamped to the hardest shipped preset: the
// client can ask for less, never more. A rejection throws `ConvexError` and,
// being a mutation, writes nothing: the counters move only for an accepted
// call. The two counter rows are the ONLY things the judge writes.

import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentUserId } from "./auth";
import { DIFFICULTY_BUDGETS } from "./gre/difficulty";
import { vsAiSeats, type VsAiSeats } from "./vsAiSeats";

/** How many positions one game may have judged.
 *
 *  One game end consults the judge at most `perClassQuota` times per Decision
 *  Class (`tolaria.config.json` § verdictProposals): 3 × 11 classes = 33. A
 *  reload while the list is being built can rebuild it from the stored
 *  decisions, so an honest game can spend that twice (66). 100 leaves room for
 *  both and a third partial build, and still caps a game at a fixed, small
 *  amount of server search. */
export const VERDICT_JUDGE_POSITIONS_PER_GAME = 100;

/** How many positions one user may have judged per
 *  {@link VERDICT_JUDGE_USER_WINDOW_MS}. The per-game bound alone lets a user
 *  who creates and concedes games buy unlimited searches; this caps the user.
 *  2,000 is ~60 honest game ends a day at the 33 positions one game end asks
 *  for — more vs-Bot games than a person plays in a day. */
export const VERDICT_JUDGE_POSITIONS_PER_USER = 2000;

/** The per-user window: fixed, 24 h, starting at the first claim after the
 *  previous window elapsed. */
export const VERDICT_JUDGE_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The most iterations one judge consult may search: the hardest shipped
 *  difficulty preset's. The judge's own budget is far below it; the clamp is
 *  what keeps a client from asking for more. */
export const VERDICT_JUDGE_MAX_ITERATIONS = Math.max(
    ...Object.values(DIFFICULTY_BUDGETS).map((b) => b.iterations ?? 0)
);

/** A requested iteration budget, clamped to
 *  {@link VERDICT_JUDGE_MAX_ITERATIONS}. Throws on anything that is not a
 *  positive integer — a budget that does not read is never a budget of 0. */
export function clampJudgeIterations(requested: number): number {
    if (!Number.isInteger(requested) || requested < 1) {
        throw new ConvexError(
            "The judge's iterations must be a positive integer."
        );
    }
    return Math.min(requested, VERDICT_JUDGE_MAX_ITERATIONS);
}

/** The caller, or a `ConvexError` the client can tell apart. */
async function callerId(ctx: MutationCtx): Promise<Id<"users">> {
    try {
        return await getCurrentUserId(ctx);
    } catch {
        throw new ConvexError("Sign in to use the judge.");
    }
}

/** The seat checks every claim makes, against seats resolved either from the
 *  `games` row (first claim) or from the counter row (later claims). */
function assertSeats(
    seats: VsAiSeats,
    seatId: string,
    knowledgeSeats: readonly string[]
): void {
    if (seatId !== seats.humanId) {
        throw new ConvexError("The judge searches the human seat only.");
    }
    if (knowledgeSeats.some((s) => s !== seats.humanId && s !== seats.botId)) {
        throw new ConvexError(
            "The judge's knowledge names a seat outside this game."
        );
    }
}

/** The game's counter row, or — on its first claim — the full check, whose
 *  result the row will remember. */
async function authorizeGame(
    ctx: MutationCtx,
    gameId: Id<"games">,
    userId: Id<"users">,
    row: Doc<"verdictJudgeBudgets"> | null
): Promise<VsAiSeats> {
    if (row) {
        if (row.userId !== userId) {
            throw new ConvexError("You are not the player of this game.");
        }
        return { humanId: row.humanId, botId: row.botId };
    }
    const game = await ctx.db.get(gameId);
    if (!game) throw new ConvexError("Game not found.");
    const seats = vsAiSeats(game, userId);
    const tick = await ctx.db
        .query("gameTicks")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .first();
    if (tick?.gameOver !== true) {
        throw new ConvexError("The game is not over.");
    }
    return seats;
}

/** Count one position against the caller's daily window, or refuse. */
async function claimUserPosition(
    ctx: MutationCtx,
    userId: Id<"users">,
    now: number
): Promise<void> {
    const row = await ctx.db
        .query("verdictJudgeUserBudgets")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique();
    const fresh = !row || now - row.windowStart >= VERDICT_JUDGE_USER_WINDOW_MS;
    const used = fresh ? 0 : row.positions;
    if (used >= VERDICT_JUDGE_POSITIONS_PER_USER) {
        throw new ConvexError("You have no judge positions left today.");
    }
    const next = {
        windowStart: fresh ? now : row.windowStart,
        positions: used + 1,
    };
    if (row) await ctx.db.patch(row._id, next);
    else await ctx.db.insert("verdictJudgeUserBudgets", { userId, ...next });
}

/**
 * Authorize one judge consult and count it against the game's and the user's
 * bounds. Returns the clamped budget the search must run at. Called by the
 * judge action through `ctx.runMutation`, which carries the action caller's
 * identity.
 */
export const claimJudgeConsult = internalMutation({
    args: {
        gameId: v.id("games"),
        seatId: v.string(),
        /** The `playerId` of every `knowledge` entry — not the card lists. */
        knowledgeSeats: v.array(v.string()),
        iterations: v.number(),
        seed: v.number(),
    },
    returns: v.object({ iterations: v.number() }),
    handler: async (ctx, args) => {
        const userId = await callerId(ctx);
        if (!Number.isInteger(args.seed)) {
            throw new ConvexError("The judge's seed must be an integer.");
        }
        const iterations = clampJudgeIterations(args.iterations);

        const row = await ctx.db
            .query("verdictJudgeBudgets")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .unique();
        const seats = await authorizeGame(ctx, args.gameId, userId, row);
        assertSeats(seats, args.seatId, args.knowledgeSeats);
        const used = row?.positions ?? 0;
        if (used >= VERDICT_JUDGE_POSITIONS_PER_GAME) {
            throw new ConvexError("This game has no judge positions left.");
        }

        const now = Date.now();
        await claimUserPosition(ctx, userId, now);
        if (row) {
            await ctx.db.patch(row._id, {
                positions: used + 1,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("verdictJudgeBudgets", {
                gameId: args.gameId,
                userId,
                humanId: seats.humanId,
                botId: seats.botId,
                positions: 1,
                updatedAt: now,
            });
        }
        return { iterations };
    },
});
