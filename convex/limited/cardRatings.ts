// Bot Drafter Pick Rating layer, Slice A (PRD #1296, ADR 0066, issue #1297):
// the ONE new seam this slice adds. Layers a database override (the new
// `cardRatings` table, `convex/schema.ts`) on top of the existing checked-in
// seed file (`pickRatings.ts`'s `getPickRating`) into the SAME
// `GetPickRating` shape `botDrafter.ts`'s `chooseBotPick` already accepts —
// `botDrafter.ts` itself is UNCHANGED by this slice; only WHICH lookup
// `convex/limitedEvents.ts` injects into it changes.
//
// `resolveEventPickRating` (the READ path) is PURE — no `ctx`, no DB access.
// It is handed an already-scoped `GetDbRating` closure (the actual `ctx.db`
// read happens in `convex/limitedEvents.ts`, the thin mutation shell,
// mirroring every other pure/DB-access split in this module —
// `eventLogic.ts`'s `ResolveCardMeta`, `botDrafter.ts`'s `GetCardEvalMeta`).
// This keeps the layering logic unit-testable with a plain in-memory map, no
// convex-test harness needed (project convention,
// `convex/__tests__/adminAuth.test.ts`).
//
// The WRITE path (PRD #1296 Slice B, issue #1298) — `setCardRating` /
// `clearCardRating` below — DOES own `ctx.db` directly, mirroring
// `convex/cubes.ts`'s shape: this module is the Convex-function sibling of
// the pure read-side core, kept in the SAME file because both halves share
// the one `cardRatings` table and the one `(scope, cardId)` key discipline.
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import { assertIsAdmin } from "../auth";
import {
    getPickRating,
    isValidRating,
    PICK_RATING_MIN,
    PICK_RATING_MAX,
} from "./pickRatings";
import type { GetPickRating } from "./botDrafter";

/** Resolves ONE `(scope, cardId)` pair to its DATABASE rating, or `null` when
 *  no row exists for that exact pair — injected so this module never touches
 *  `ctx.db`/the `cardRatings` table directly. `scope` is always already
 *  lowercased by the caller (`resolveEventPickRating` normalizes before
 *  calling), matching `packSlots`' and `pickRatings.ts`'s case discipline. */
export type GetDbRating = (scope: string, cardId: string) => number | null;

/** Builds the layered `GetPickRating` a Limited Event's bot-pick call sites
 *  inject into `chooseBotPick` (PRD #1296 Slice A, issue #1297) — replacing
 *  the old registry-agnostic `pickRatings.ts#getPickRatingByCardId`.
 *
 *  `scopes` is the event's DISTINCT pack-source identities (its `packSlots`,
 *  deduped — a 3-round mono-set Draft has ONE distinct scope even though the
 *  array has 3 entries; a future mixed-set block Draft would have several).
 *  Normalized to lowercase here, once, so neither `getDbRating` nor the seed
 *  lookup below has to re-normalize.
 *
 *  Resolution order per card, EXACTLY as PRD #1296 specifies (Implementation
 *  Decisions: "the one new seam"):
 *
 *    1. Database `(scope, cardId)` for ANY of the event's scopes — checked
 *       first, across every scope, before falling to the seed layer at all.
 *    2. Seed JSON `pickRatings.ts#getPickRating(scope, cardId)` for ANY of
 *       the event's scopes — the pre-existing checked-in-file behavior,
 *       unchanged.
 *    3. `null` — no rating anywhere; `chooseBotPick` falls back to the Pick
 *       Heuristic alone, exactly as it already does for a `null` rating.
 *
 *  A database row for a scope OUTSIDE `scopes` never leaks in: `getDbRating`
 *  is only ever called with a scope drawn from `scopes` itself, so a stray
 *  row rating the SAME `cardId` under a different scope (e.g. a card that
 *  exists in two sets) cannot be picked up by an event that doesn't draft
 *  that scope.
 *
 *  Regression (this issue's acceptance): with `getDbRating` always returning
 *  `null` (an empty `cardRatings` table), this is byte-for-byte the same
 *  layered result the seed-only path already produced — a scope with no
 *  database edits drafts identically to today. */
export function resolveEventPickRating(
    scopes: readonly string[],
    getDbRating: GetDbRating
): GetPickRating {
    const normalizedScopes = Array.from(
        new Set(scopes.map((scope) => scope.toLowerCase()))
    );

    return (cardId: string): number | null => {
        for (const scope of normalizedScopes) {
            const dbRating = getDbRating(scope, cardId);
            if (dbRating !== null) return dbRating;
        }
        for (const scope of normalizedScopes) {
            const seedRating = getPickRating(scope, cardId);
            if (seedRating !== null) return seedRating;
        }
        return null;
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Admin write mutations (PRD #1296 Slice B, issue #1298)
// ─────────────────────────────────────────────────────────────────────────

/** The exact row `setCardRating` inserts/patches: `scope` normalized to
 *  lowercase (the SAME case discipline `resolveEventPickRating` and
 *  `packSlots`/`pickRatings.ts` already use), `cardId` and `rating` carried
 *  verbatim. Pure — no `ctx` — so the write mutation's row-shape decision is
 *  unit-testable directly, without a convex-test harness (project
 *  convention, mirrors `decks.ts`'s `buildPresetPatch`/`buildNewPresetRow`).
 *  Does NOT validate `rating` — bounds are the caller's job
 *  (`isValidRating`, reused from Slice A, never duplicated). */
export function buildCardRatingRow(
    scope: string,
    cardId: string,
    rating: number
): { scope: string; cardId: string; rating: number } {
    return { scope: scope.toLowerCase(), cardId, rating };
}

/** Point lookup on the table's natural primary key — the shared read used by
 *  both `setCardRating` (to decide patch vs. insert) and `clearCardRating`
 *  (to decide whether there's anything to delete). `scope` must already be
 *  normalized (lowercased) by the caller. */
async function loadCardRating(
    ctx: MutationCtx,
    scope: string,
    cardId: string
) {
    return ctx.db
        .query("cardRatings")
        .withIndex("by_scope_and_card", (q) =>
            q.eq("scope", scope).eq("cardId", cardId)
        )
        .unique();
}

/** Admin-only upsert of ONE `(scope, cardId)` rating (PRD #1296 Slice B,
 *  issue #1298). `assertIsAdmin` runs FIRST, the same "gate before anything
 *  else" convention as every admin mutation in `convex/decks.ts` /
 *  `convex/cubes.ts`. Rejects a rating failing `isValidRating` (reused from
 *  Slice A's `pickRatings.ts` — the ONE bounds authority, never
 *  re-implemented here): <0, >5, `NaN`, `Infinity`, or a non-number. Patches
 *  the existing row's rating when `(scope, cardId)` already has one
 *  (identity/`_id` preserved), else inserts a fresh row — mirrors
 *  `cubes.ts`'s `upsertCube`. */
export const setCardRating = mutation({
    args: {
        scope: v.string(),
        cardId: v.string(),
        rating: v.number(),
    },
    returns: v.null(),
    handler: async (ctx, { scope, cardId, rating }) => {
        await assertIsAdmin(ctx);
        if (!isValidRating(rating)) {
            throw new Error(
                `Invalid rating ${rating}: must be a finite number in [${PICK_RATING_MIN}, ${PICK_RATING_MAX}]`
            );
        }
        const row = buildCardRatingRow(scope, cardId, rating);
        const existing = await loadCardRating(ctx, row.scope, row.cardId);
        if (existing) {
            await ctx.db.patch(existing._id, { rating: row.rating });
        } else {
            await ctx.db.insert("cardRatings", row);
        }
        return null;
    },
});

/** Admin-only delete of ONE `(scope, cardId)` rating (PRD #1296 Slice B,
 *  issue #1298) — the card falls back to its seed rating (or the Pick
 *  Heuristic alone) on the very next read, no separate "revert" step needed
 *  (`resolveEventPickRating`'s layering already treats an absent database
 *  row as "fall through"). `assertIsAdmin` runs FIRST. Idempotent: deleting
 *  an already-absent pair is a no-op, not an error — an Admin re-clicking
 *  "clear" (or a stale UI re-submitting) never throws. */
export const clearCardRating = mutation({
    args: {
        scope: v.string(),
        cardId: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, { scope, cardId }) => {
        await assertIsAdmin(ctx);
        const normalizedScope = scope.toLowerCase();
        const existing = await loadCardRating(ctx, normalizedScope, cardId);
        if (existing) {
            await ctx.db.delete(existing._id);
        }
        return null;
    },
});
