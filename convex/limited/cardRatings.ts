// Bot Drafter Pick Rating layer — the Convex FUNCTION shell (PRD #1296, ADR
// 0066, issues #1297/#1298/#1300). The pure core — `resolveEventPickRating`,
// `buildCardRatingRow`, `listScopeCards`, `buildScopeCardRatings`,
// `buildDbRatingLookup` and their types — lives in the sibling
// `cardRatingsCore.ts` and is imported by both this module and the
// BROWSER-side Draft Lab. This file owns the halves the Lab must never pull
// into its bundle: `ctx.db` access and the admin/auth gate.
//
// The split is load-bearing, not cosmetic: `../auth` runs `convexAuth({...})`
// at module scope, which reads `process.env` — a single client-side VALUE
// import of `resolveEventPickRating` (which used to live here) dragged that
// into the Vite bundle and crashed the app on cold load with "process is not
// defined". `scripts/__tests__/client-bundle-purity.test.ts` guards it.
// Anything pure belongs in `cardRatingsCore.ts`; anything holding `ctx`
// belongs here. Both halves still share the one `cardRatings` table and the
// one `(scope, cardId)` key discipline.
import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { assertIsAdmin, getCurrentUserId } from "../auth";
import { isValidRating, PICK_RATING_MIN, PICK_RATING_MAX } from "./pickRatings";
import {
    buildCardRatingRow,
    buildScopeCardRatings,
    listScopeCards,
    type GetDbRating,
    type ScopeCardRating,
    type ScopedCardRating,
} from "./cardRatingsCore";

// ─────────────────────────────────────────────────────────────────────────
// Admin write mutations (PRD #1296 Slice B, issue #1298)
// ─────────────────────────────────────────────────────────────────────────

/** Point lookup on the table's natural primary key — the shared read used by
 *  both `setCardRating` (to decide patch vs. insert) and `clearCardRating`
 *  (to decide whether there's anything to delete). `scope` must already be
 *  normalized (lowercased) by the caller. */
async function loadCardRating(ctx: MutationCtx, scope: string, cardId: string) {
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

// ─────────────────────────────────────────────────────────────────────────
// Admin editor read query (PRD #1296 Slice C, issue #1300)
// ─────────────────────────────────────────────────────────────────────────

/** Admin-only editor read query (PRD #1296 Slice C, issue #1300): for a
 *  chosen `scope` (a Draftable Set code, or the Vintage Cube's
 *  `vintage-cube` key), returns every card of that scope with
 *  `{ cardId, name, dbRating, seedRating }`, sorted by name for a stable
 *  editor listing. `assertIsAdmin` runs FIRST, the same "gate before
 *  anything else" convention as `setCardRating`/`clearCardRating`. Loads the
 *  scope's `cardRatings` rows via the SAME `by_scope` index
 *  `limitedEvents.ts#loadEventPickRating` already uses (bounded per scope,
 *  never a full-table scan), then folds them into `buildScopeCardRatings`
 *  exactly like the bot read path folds them into `resolveEventPickRating`
 *  — the query and the bot read path share the one `(scope, cardId)` layering
 *  discipline, just projected differently (per-card list vs. a single
 *  lookup closure). */
export const listScopeCardRatings = query({
    args: { scope: v.string() },
    returns: v.array(
        v.object({
            cardId: v.string(),
            name: v.string(),
            dbRating: v.union(v.number(), v.null()),
            seedRating: v.union(v.number(), v.null()),
        })
    ),
    handler: async (ctx, { scope }): Promise<ScopeCardRating[]> => {
        await assertIsAdmin(ctx);
        const normalizedScope = scope.toLowerCase();
        const cards = listScopeCards(normalizedScope);

        const rows = await ctx.db
            .query("cardRatings")
            .withIndex("by_scope", (q) => q.eq("scope", normalizedScope))
            .collect();
        const dbRatings = new Map(rows.map((row) => [row.cardId, row.rating]));
        const getDbRating: GetDbRating = (_scope, cardId) =>
            dbRatings.get(cardId) ?? null;

        return buildScopeCardRatings(normalizedScope, cards, getDbRating).sort(
            (a, b) => a.name.localeCompare(b.name)
        );
    },
});

// ─────────────────────────────────────────────────────────────────────────
// Read-only replay query (issue #1613 fixup, pre-merge review finding 2): a
// real `cardRatings` DB layer for the Draft Lab REPLAY surface. Without
// this, `useDraftLabReplay.ts` scored every "recomputed" pick off the
// checked-in seed file alone (`buildDraftLabPickRating`, which hardwires
// `getDbRating` to `() => null` — the synthetic-mode Lab's OWN documented
// contract, not a bug there) — on any deployment carrying an edited rating
// (PRD #1296's Pick Rating editor), the recomputed column would diverge from
// the REAL historical pick (made under `convex/limitedEvents.ts`'s
// `loadEventPickRating`, which DOES fold in the database) for reasons that
// have nothing to do with the scorer changing — a permanently spurious
// `firstDivergedPickIndex`, the replay's whole tuning signal, gone wrong.
// ─────────────────────────────────────────────────────────────────────────

/** Every `cardRatings` row for a set of scopes — the read-only counterpart to
 *  `convex/limitedEvents.ts`'s inline `loadEventPickRating`, for a CLIENT
 *  consumer that can't call that internal helper directly: the Draft Lab
 *  replay surface (issue #1613 fixup). Mirrors `cardProfiles.ts`'s
 *  `listScopeCardProfiles` exactly, including its gating choice — reading a
 *  scope's edited ratings is informational, not an admin-only capability
 *  (`assertIsAdmin` stays reserved for the WRITE mutations above and the
 *  editor read `listScopeCardRatings`, which additionally folds in the seed
 *  layer for editing UI). In practice only an admin viewer has a live reason
 *  to call this today: the replay surface that feeds it needs the event's
 *  `seed`, which `eventProjection.ts` now exposes only to an admin — but
 *  this query itself places no admin gate on READING ratings, the same
 *  "any authenticated user, not admin-gated" call `listScopeCardProfiles`
 *  already makes for its own informational read. Read-only: no
 *  `insert`/`patch`/`delete` anywhere in this handler, so it carries no
 *  write surface for `draft-lab-no-mutation.test.ts` to catch. Uses the
 *  `by_scope` index per scope — bounded, never a full-table scan, the same
 *  access pattern `loadEventPickRating`/`listScopeCardRatings` already use. */
export const listScopeCardRatingsForReplay = query({
    args: { scopes: v.array(v.string()) },
    returns: v.array(
        v.object({
            scope: v.string(),
            cardId: v.string(),
            rating: v.number(),
        })
    ),
    handler: async (ctx, { scopes }): Promise<ScopedCardRating[]> => {
        await getCurrentUserId(ctx);
        const normalizedScopes = Array.from(
            new Set(scopes.map((scope) => scope.toLowerCase()))
        );
        const rows: ScopedCardRating[] = [];
        for (const scope of normalizedScopes) {
            const scopeRows = await ctx.db
                .query("cardRatings")
                .withIndex("by_scope", (q) => q.eq("scope", scope))
                .collect();
            for (const row of scopeRows) {
                rows.push({
                    scope: row.scope,
                    cardId: row.cardId,
                    rating: row.rating,
                });
            }
        }
        return rows;
    },
});
