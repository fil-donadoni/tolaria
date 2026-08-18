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
//     # → { migrated: 25, scanned: 200, isDone: false, cursor: "…" }
//     bunx convex run deckBackfill:migrateGameDecks '{"cursor":"…"}'
//     # → repeat until isDone: true
//
// **`isDone`, not an empty batch, is the completion signal.** These walk
// `games` / `matches`, tables that grow without bound, so a fixed `.take(N)`
// window would re-read the SAME first N rows on every invocation and report
// nothing left to do while every legacy row past index N stayed fat forever —
// silently, since the operator has no other signal. So the walk is a real
// CURSOR: each invocation resumes from where the last one stopped, and only
// `isDone: true` means the whole table has been seen (review finding 4).
//
// Both are IDEMPOTENT: an already-split row is detected by
// `gameHasInlineDecks` / `matchHasInlineDecks` and skipped without a write, so
// a second full walk reports `{ migrated: 0 }` and writes nothing. `limit`
// bounds how many rows ONE invocation rewrites, so a single transaction stays
// small; the cursor is what makes the next invocation continue rather than
// restart.
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
    gameHasInlineDecks,
    matchHasInlineDecks,
    migrateOneGameRow,
    migrateOneMatchRow,
} from "./deckStore";

/** Rows read per page. A backfill has no index to narrow by (there is no "is
 *  legacy" field to index), so it walks the table page by page. */
const PAGE_SIZE = 200;

const BACKFILL_RESULT = v.object({
    migrated: v.number(),
    scanned: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
});

const BACKFILL_ARGS = {
    /** Max rows REWRITTEN by one invocation (bounds the transaction). */
    limit: v.optional(v.number()),
    /** Resume point — the `cursor` the previous invocation returned. Omit to
     *  start at the beginning of the table. */
    cursor: v.optional(v.string()),
};

type BackfillResult = {
    migrated: number;
    scanned: number;
    isDone: boolean;
    cursor: string | null;
};

/** Walks `table` from `args.cursor` in whole pages, migrating every legacy row
 *  it sees, and stops at the first page boundary past the write cap.
 *
 *  WHOLE pages, never a partial one: the cursor handed back is always a
 *  boundary this invocation finished, so resuming from it can never step over
 *  a legacy row the cap made it skip. `limit` is therefore a floor-not-ceiling
 *  cap — one invocation can rewrite up to `limit + PAGE_SIZE - 1` rows — which
 *  is the right trade for a backfill whose alternative is losing rows. */
async function runBackfill<T extends "games" | "matches">(
    ctx: MutationCtx,
    table: T,
    hasInlineDecks: (row: Doc<T>) => boolean,
    migrateOne: (ctx: MutationCtx, row: Doc<T>) => Promise<boolean>,
    args: { limit?: number; cursor?: string }
): Promise<BackfillResult> {
    const limit = args.limit ?? 25;
    let cursor: string | null = args.cursor ?? null;
    let migrated = 0;
    let scanned = 0;
    let isDone = false;
    do {
        const page = await ctx.db
            .query(table)
            .paginate({ cursor, numItems: PAGE_SIZE });
        for (const row of page.page) {
            scanned++;
            if (!hasInlineDecks(row)) continue;
            await migrateOne(ctx, row);
            migrated++;
        }
        cursor = page.continueCursor;
        isDone = page.isDone;
    } while (!isDone && migrated < limit);
    return { migrated, scanned, isDone, cursor: isDone ? null : cursor };
}

export const migrateGameDecks = internalMutation({
    args: BACKFILL_ARGS,
    returns: BACKFILL_RESULT,
    handler: (ctx, args) =>
        runBackfill(ctx, "games", gameHasInlineDecks, migrateOneGameRow, args),
});

export const migrateMatchDecks = internalMutation({
    args: BACKFILL_ARGS,
    returns: BACKFILL_RESULT,
    handler: (ctx, args) =>
        runBackfill(
            ctx,
            "matches",
            matchHasInlineDecks,
            migrateOneMatchRow,
            args
        ),
});
