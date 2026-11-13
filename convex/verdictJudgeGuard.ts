// The guard in front of the game-end Verdict Proposal judge
// (`convex/verdictJudge.ts`, GLOSSARY.md § Verdict Proposal).
//
// The judge is a PUBLIC action that runs a Brain search on the server, so
// every call is authorized here, in the default runtime, BEFORE any search
// runs. A call is accepted only when:
//
//   - the caller is authenticated and owns the HUMAN seat of a vs-AI game
//     (`vsAiSeats`), and the seat searched is that human seat — the judge
//     judges the player's own decisions, from the player's own view;
//   - the game is OVER: its `gameTicks` row says `gameOver`. That row is
//     written by `saveGameState` (the sole writer) in the same transaction as
//     the snapshot whose `state.gameOver` it mirrors, so it is as
//     authoritative as the fat `gameStates` row and costs ~150 bytes to read
//     instead of the whole position — the client's game-end trigger reads the
//     same field;
//   - the game's position counter is under `VERDICT_JUDGE_POSITIONS_PER_GAME`.
//
// The requested iteration budget is clamped to the hardest shipped preset: the
// client can ask for less, never more. A rejection throws `ConvexError` and,
// being a mutation, writes nothing: the counter moves only for an accepted
// call. The counter row is the ONLY thing the judge writes.

import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getCurrentUserId } from "./auth";
import { DIFFICULTY_BUDGETS } from "./gre/difficulty";
import { vsAiSeats } from "./vsAiSeats";

/** How many positions one game may have judged.
 *
 *  One game end consults the judge at most `perClassQuota` times per Decision
 *  Class (`tolaria.config.json` § verdictProposals): 3 × 11 classes = 33. A
 *  reload while the list is being built can rebuild it from the stored
 *  decisions, so an honest game can spend that twice (66). 100 leaves room for
 *  both and a third partial build, and still caps a game at a fixed, small
 *  amount of server search. */
export const VERDICT_JUDGE_POSITIONS_PER_GAME = 100;

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

/**
 * Authorize one judge consult and count it against the game's bound. Returns
 * the clamped budget the search must run at. Called by the judge action
 * through `ctx.runMutation`, which carries the action caller's identity.
 */
export const claimJudgeConsult = internalMutation({
    args: {
        gameId: v.id("games"),
        seatId: v.string(),
        iterations: v.number(),
        seed: v.number(),
    },
    returns: v.object({ iterations: v.number() }),
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new ConvexError("Game not found.");
        const { humanId } = vsAiSeats(game, userId);
        if (args.seatId !== humanId) {
            throw new ConvexError("The judge searches the human seat only.");
        }
        if (!Number.isInteger(args.seed)) {
            throw new ConvexError("The judge's seed must be an integer.");
        }
        const iterations = clampJudgeIterations(args.iterations);

        const tick = await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .first();
        if (tick?.gameOver !== true) {
            throw new ConvexError("The game is not over.");
        }

        const row = await ctx.db
            .query("verdictJudgeBudgets")
            .withIndex("by_gameId", (q) => q.eq("gameId", args.gameId))
            .unique();
        const used = row?.positions ?? 0;
        if (used >= VERDICT_JUDGE_POSITIONS_PER_GAME) {
            throw new ConvexError("This game has no judge positions left.");
        }
        const now = Date.now();
        if (row) {
            await ctx.db.patch(row._id, {
                positions: used + 1,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("verdictJudgeBudgets", {
                gameId: args.gameId,
                positions: 1,
                updatedAt: now,
            });
        }
        return { iterations };
    },
});
