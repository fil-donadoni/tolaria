// Card Prints (ADR 0140, issue #4116/#4117) — `upsertBatch` (via
// `bun run prints:sync`) is the ONLY writer of this table; `listByCardId`
// below is its first reader, the deck builder's edition selector (issue
// #4117); `getByPrintIds` serves the deck builder's resolver (issue #4118) and
// `tokenPrintsForGame` the board's token art (issue #4120).

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

export const definitionTokenRowValidator = v.object({
    cardId: v.string(),
    tokenPrints: v.array(tokenPrintValidator),
});

/** True when `row` carries exactly the Token Prints already stored on
 *  `existing` — same order-sensitive comparison as `unchanged`, for the same
 *  reason (one deterministic transform feeds both sides). */
export function definitionTokensUnchanged(
    existing: Doc<"definitionTokenPrints">,
    row: {
        cardId: string;
        tokenPrints: { name: string; tokenPrintId: string }[];
    }
): boolean {
    return (
        existing.tokenPrints.length === row.tokenPrints.length &&
        existing.tokenPrints.every(
            (t, i) =>
                t.name === row.tokenPrints[i].name &&
                t.tokenPrintId === row.tokenPrints[i].tokenPrintId
        )
    );
}

/**
 * Idempotent, never-delete upsert of the definition printings' Token Prints
 * (ADR 0140 §4, issue #4120), keyed by `cardId` via `by_cardId`. Like
 * `upsertBatch`, an unchanged row is never written: a no-op patch would still
 * re-execute every Game-load subscription holding it.
 */
export const upsertDefinitionTokensBatch = internalMutation({
    args: { rows: v.array(definitionTokenRowValidator) },
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
                .query("definitionTokenPrints")
                .withIndex("by_cardId", (q) => q.eq("cardId", row.cardId))
                .unique();
            if (!existing) {
                await ctx.db.insert("definitionTokenPrints", row);
                inserted++;
            } else if (definitionTokensUnchanged(existing, row)) {
                unchangedCount++;
            } else {
                await ctx.db.patch(existing._id, row);
                patched++;
            }
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

/** Most print ids one `getByPrintIds` call reads — a deck is 60-100 cards, so
 *  this bounds the read set without ever truncating a real deck. */
const MAX_PRINT_IDS = 300;

/**
 * Rows for the printings a working deck names (issue #4118) — the deck
 * builder builds its `ResolveCard` from these (`makeResolveCardFromRows`), the
 * same resolver the server gate builds from the same table. Point reads by
 * `by_printId` only: no range scan, and rows are immutable to a reader.
 */
export const getByPrintIds = query({
    args: { printIds: v.array(v.string()) },
    returns: v.array(cardPrintRowValidator),
    handler: async (ctx, { printIds }) => {
        const rows = await Promise.all(
            [...new Set(printIds.slice(0, MAX_PRINT_IDS))].map((printId) =>
                ctx.db
                    .query("cardPrints")
                    .withIndex("by_printId", (q) => q.eq("printId", printId))
                    .unique()
            )
        );
        return rows.flatMap((row) =>
            row
                ? [
                      {
                          printId: row.printId,
                          cardId: row.cardId,
                          set: row.set,
                          rarity: row.rarity,
                          digital: row.digital,
                          promo: row.promo,
                          tokenPrints: row.tokenPrints,
                      },
                  ]
                : []
        );
    },
});

/** The slim row `tokenPrintsForGame` ships. */
export interface TokenPrintRowFields {
    printId: string;
    cardId: string;
    tokenPrints: { name: string; tokenPrintId: string }[];
}

/** The Card ID each requested id stands for: a chosen printing's row names
 *  its Card ID; an id with no row is taken to BE a Card ID (an unpinned deck
 *  entry names its definition printing, which `cardPrints` never holds).
 *  Pure core of `tokenPrintsForGame`. */
export function cardIdsOf(
    printIds: readonly string[],
    rows: readonly { printId: string; cardId: string }[]
): string[] {
    const byPrintId = new Map(rows.map((r) => [r.printId, r.cardId]));
    return [...new Set(printIds.map((id) => byPrintId.get(id) ?? id))];
}

/** The rows `tokenPrintsForGame` returns, in the one shape the client
 *  indexes by `printId`: every `cardPrints` row read, plus a synthetic row for
 *  each definition printing (`printId === cardId`) that links a token. A
 *  `cardPrints` row that can neither name a token nor point at another
 *  printing is dropped (its own Card ID, no Token Prints). Pure core of
 *  `tokenPrintsForGame`. */
export function toTokenPrintRows(
    rows: readonly TokenPrintRowFields[],
    definitions: readonly {
        cardId: string;
        tokenPrints: { name: string; tokenPrintId: string }[];
    }[]
): TokenPrintRowFields[] {
    const slim = rows
        .filter((r) => r.tokenPrints.length > 0 || r.cardId !== r.printId)
        .map((r) => ({
            printId: r.printId,
            cardId: r.cardId,
            tokenPrints: r.tokenPrints,
        }));
    const have = new Set(slim.map((r) => r.printId));
    const synthetic = definitions
        .filter((d) => d.tokenPrints.length > 0 && !have.has(d.cardId))
        .map((d) => ({
            printId: d.cardId,
            cardId: d.cardId,
            tokenPrints: d.tokenPrints,
        }));
    return [...slim, ...synthetic];
}

/**
 * The Game-load Token Print fetch (ADR 0140 §4, issue #4120): ONE query for
 * every Print ID in both decks, so a token's art is known the moment the board
 * renders and never flickers. Point reads only (`by_printId`, `by_cardId`
 * unique) — no range scan. The client's resolver (`src/lib/tokenArt.ts`) reads
 * a token's `sourcePrintId` row first, then the DEFINITION printing's, which
 * lives in `definitionTokenPrints` because the sync never writes it to
 * `cardPrints`; both arrive here as rows keyed by `printId`, the definition's
 * with `printId === cardId`.
 */
export const tokenPrintsForGame = query({
    args: { printIds: v.array(v.string()) },
    returns: v.array(
        v.object({
            printId: v.string(),
            cardId: v.string(),
            tokenPrints: v.array(tokenPrintValidator),
        })
    ),
    handler: async (ctx, { printIds }) => {
        const wanted = [...new Set(printIds.slice(0, MAX_PRINT_IDS))];
        const rows = (
            await Promise.all(
                wanted.map((printId) =>
                    ctx.db
                        .query("cardPrints")
                        .withIndex("by_printId", (q) =>
                            q.eq("printId", printId)
                        )
                        .unique()
                )
            )
        ).flatMap((r) => (r ? [r] : []));
        const definitions = (
            await Promise.all(
                cardIdsOf(wanted, rows).map((cardId) =>
                    ctx.db
                        .query("definitionTokenPrints")
                        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
                        .unique()
                )
            )
        ).flatMap((r) => (r ? [r] : []));
        return toTokenPrintRows(rows, definitions);
    },
});
