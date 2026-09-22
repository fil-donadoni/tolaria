// Card Prints (ADR 0140, issue #4116/#4117) — `upsertBatch` (via
// `bun run prints:sync`) is the ONLY writer of this table; `listByCardId`
// below is its first reader, the deck builder's edition selector (issue
// #4117). Engine transport and token art are later slices of PRD #4115.

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// Kept in sync with `Rarity` (`convex/cards/types.ts`) and the copy in
// `convex/schema.ts` — CR 206's four modelled rarities.
export const rarityValidator = v.union(
    v.literal("common"),
    v.literal("uncommon"),
    v.literal("rare"),
    v.literal("mythic")
);

export const tokenPrintValidator = v.object({
    name: v.string(),
    tokenPrintId: v.string(),
});

export const cardPrintRowValidator = v.object({
    printId: v.string(),
    cardId: v.string(),
    set: v.string(),
    rarity: rarityValidator,
    digital: v.boolean(),
    promo: v.boolean(),
    tokenPrints: v.array(tokenPrintValidator),
});

export interface CardPrintRowFields {
    cardId: string;
    set: string;
    rarity: string;
    digital: boolean;
    promo: boolean;
    tokenPrints: { name: string; tokenPrintId: string }[];
}

/** True when `row` carries exactly the values already stored on `existing` —
 *  order-sensitive on `tokenPrints`, which is fine: both sides are produced
 *  by the same deterministic transform (`scripts/lib/prints-transform.ts`),
 *  reading the same `all_parts` array in the same order every sync. Exported
 *  so this project's no-convex-test-harness pattern (see
 *  `convex/__tests__/banlistSync.test.ts`'s header) can unit-test the pure
 *  core directly rather than only through `upsertBatch`'s handler. */
export function unchanged(
    existing: Doc<"cardPrints">,
    row: CardPrintRowFields
): boolean {
    return (
        existing.cardId === row.cardId &&
        existing.set === row.set &&
        existing.rarity === row.rarity &&
        existing.digital === row.digital &&
        existing.promo === row.promo &&
        existing.tokenPrints.length === row.tokenPrints.length &&
        existing.tokenPrints.every(
            (t, i) =>
                t.name === row.tokenPrints[i].name &&
                t.tokenPrintId === row.tokenPrints[i].tokenPrintId
        )
    );
}

/**
 * Idempotent, never-delete upsert (ADR 0140 §3) keyed by `printId` via
 * `by_printId`: an existing row is PATCHED, a missing one INSERTED, and a
 * printing Scryfall stops listing simply keeps its row — a deck naming it
 * still loads.
 *
 * Skips the write when the stored row already matches (PRD #4115 "the sync
 * never writes an unchanged row" — a no-op patch still re-executes every
 * subscription reading the row for zero semantic change).
 */
export const upsertBatch = internalMutation({
    args: { rows: v.array(cardPrintRowValidator) },
    returns: v.object({
        inserted: v.number(),
        patched: v.number(),
        unchanged: v.number(),
    }),
    handler: async (ctx, { rows }) => {
        let inserted = 0;
        let patched = 0;
        let unchangedCount = 0;
        for (const row of rows) {
            const existing = await ctx.db
                .query("cardPrints")
                .withIndex("by_printId", (q) => q.eq("printId", row.printId))
                .unique();
            if (!existing) {
                await ctx.db.insert("cardPrints", row);
                inserted++;
                continue;
            }
            if (unchanged(existing, row)) {
                unchangedCount++;
                continue;
            }
            await ctx.db.patch(existing._id, row);
            patched++;
        }
        return { inserted, patched, unchanged: unchangedCount };
    },
});

/**
 * The deck builder's edition selector (issue #4117, ADR 0140): every
 * printing of ONE Card ID, paginated (a basic land has on the order of a
 * thousand rows — `.collect()` would ship ~200 KB per dropdown open) and
 * filtered server-side by `allowedSets` when given, so an Old School / Alpha
 * 40 deck's selector never pulls a set it cannot legally offer. Queried only
 * when the dropdown opens (`onOpen` on `EditionDropdown`) — never eagerly.
 */
export const listByCardId = query({
    args: {
        cardId: v.string(),
        allowedSets: v.optional(v.array(v.string())),
        paginationOpts: paginationOptsValidator,
    },
    returns: v.object({
        page: v.array(cardPrintRowValidator),
        isDone: v.boolean(),
        continueCursor: v.string(),
    }),
    handler: async (ctx, { cardId, allowedSets, paginationOpts }) => {
        let q = ctx.db
            .query("cardPrints")
            .withIndex("by_cardId", (idx) => idx.eq("cardId", cardId));
        if (allowedSets) {
            const sets = allowedSets;
            q = q.filter((f) =>
                f.or(...sets.map((set) => f.eq(f.field("set"), set)))
            );
        }
        const result = await q.paginate(paginationOpts);
        return {
            page: result.page.map((row) => ({
                printId: row.printId,
                cardId: row.cardId,
                set: row.set,
                rarity: row.rarity,
                digital: row.digital,
                promo: row.promo,
                tokenPrints: row.tokenPrints,
            })),
            isDone: result.isDone,
            continueCursor: result.continueCursor,
        };
    },
});
