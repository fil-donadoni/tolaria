// One-shot backfills for the `gameDecks` / `matchDecks` split (issue #2506).
//
// Not strictly required for correctness — every read path in
// `convex/deckStore.ts` folds an inline legacy copy in when no child row
// exists, and no write path strips a card array without first writing the row
// that replaces it — but a row nobody writes to would stay fat forever, and a
// fat row is exactly what `findActiveGameForUser` / `findActiveMatchForUser`
// scan. Run once per deployment after deploying:
//
//     bunx convex run deckBackfill:migrateGameDecks '{}'
//     bunx convex run deckBackfill:migrateMatchDecks '{}'
//
// Both are IDEMPOTENT: an already-split row is detected by
// `gameHasInlineDecks` / `matchHasInlineDecks` and skipped without a write, so
// a second run reports `{ migrated: 0 }` and writes nothing. `limit` bounds one
// invocation's transaction; the returned `remaining` says whether to run again.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
    gameHasInlineDecks,
    matchHasInlineDecks,
    migrateOneGameRow,
    migrateOneMatchRow,
} from "./deckStore";

/** A backfill has no index to narrow by (there is no "is legacy" field to
 *  index), so it walks the table under an explicit cap rather than an unbounded
 *  `collect`. */
const SCAN_LIMIT = 500;

const BACKFILL_RESULT = v.object({
    migrated: v.number(),
    remaining: v.number(),
});

export const migrateGameDecks = internalMutation({
    args: { limit: v.optional(v.number()) },
    returns: BACKFILL_RESULT,
    handler: async (ctx, args) => {
        const limit = args.limit ?? 25;
        const games = await ctx.db.query("games").take(SCAN_LIMIT);
        let migrated = 0;
        let remaining = 0;
        for (const game of games) {
            if (!gameHasInlineDecks(game)) continue;
            if (migrated >= limit) {
                remaining++;
                continue;
            }
            await migrateOneGameRow(ctx, game);
            migrated++;
        }
        return { migrated, remaining };
    },
});

export const migrateMatchDecks = internalMutation({
    args: { limit: v.optional(v.number()) },
    returns: BACKFILL_RESULT,
    handler: async (ctx, args) => {
        const limit = args.limit ?? 25;
        const matches = await ctx.db.query("matches").take(SCAN_LIMIT);
        let migrated = 0;
        let remaining = 0;
        for (const match of matches) {
            if (!matchHasInlineDecks(match)) continue;
            if (migrated >= limit) {
                remaining++;
                continue;
            }
            await migrateOneMatchRow(ctx, match);
            migrated++;
        }
        return { migrated, remaining };
    },
});
