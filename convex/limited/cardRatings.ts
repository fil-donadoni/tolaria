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
import { mutation, query, type MutationCtx } from "../_generated/server";
import { assertIsAdmin, getCurrentUserId } from "../auth";
import {
    getPickRating,
    isValidRating,
    PICK_RATING_MIN,
    PICK_RATING_MAX,
} from "./pickRatings";
import { getBoosterConfig } from "./registry";
import { buildCubePool, isCubeSource } from "./cube";
import { tryGetDefinition } from "../cards";
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

/** One card of a scope, as the editor lists it before any rating is
 *  attached — `cardId` is the canonical `CardDefinition.id` (same id space
 *  `resolveEventPickRating`/`setCardRating` key on), `name` is the display
 *  name the editor renders/search-filters against. */
export interface ScopeCard {
    cardId: string;
    name: string;
}

/** One card of a scope annotated with both rating layers, exactly the shape
 *  PRD #1296's editor read query returns: `dbRating` (an explicit database
 *  override, `null` when unset) and `seedRating` (the checked-in JSON
 *  default, `null` when the scope/card has none) — so the editor can render
 *  the EFFECTIVE value (`dbRating ?? seedRating`) while still showing
 *  whether it's an override or a fallback. */
export interface ScopeCardRating extends ScopeCard {
    dbRating: number | null;
    seedRating: number | null;
}

/** Enumerates the distinct cards of a scope — a Draftable Set's Booster
 *  Config sheets, or the Vintage Cube pool (`cube.ts#buildCubePool`) for the
 *  reserved `vintage-cube` scope (`isCubeSource`, the SAME special-case
 *  `registry.ts#isDraftableSet` and `limitedEvents.ts` already make — no new
 *  cube branch invented here). A set's sheets are keyed by a printing's
 *  `scryfallId`; resolved to the canonical `CardDefinition.id`/`name` via
 *  `tryGetDefinition` and deduped by id (mirrors `pickRatings.ts`'s
 *  `validatePickRatingFile` sheet walk — the SAME "resolves to a card of the
 *  set" enumeration, reused here for listing instead of validating). `scope`
 *  is case-insensitive, matching every other scope lookup in this module.
 *  Returns `[]` for a scope with no checked-in Booster Config — never throws,
 *  so the editor query can render "no cards" instead of failing. Pure — no
 *  `ctx` — so it is directly unit-testable. */
export function listScopeCards(scope: string): ScopeCard[] {
    if (isCubeSource(scope)) {
        const cards: ScopeCard[] = [];
        for (const cardId of buildCubePool()) {
            const def = tryGetDefinition(cardId);
            if (!def) continue;
            cards.push({ cardId: def.id, name: def.name });
        }
        return cards;
    }

    const config = getBoosterConfig(scope);
    if (!config) return [];

    const seen = new Set<string>();
    const cards: ScopeCard[] = [];
    for (const sheet of Object.values(config.sheets)) {
        for (const scryfallId of Object.keys(sheet.cards)) {
            const def = tryGetDefinition(scryfallId);
            if (!def) continue;
            if (seen.has(def.id)) continue;
            seen.add(def.id);
            cards.push({ cardId: def.id, name: def.name });
        }
    }
    return cards;
}

/** Annotates `cards` (a scope's enumerated card list, `listScopeCards`) with
 *  both rating layers — the pure core of the `listScopeCardRatings` query,
 *  split out so it is unit-testable with a plain in-memory `GetDbRating`
 *  closure, no convex-test harness (same discipline as
 *  `resolveEventPickRating` above). `scope` is normalized to lowercase HERE
 *  (once), so `getDbRating` and the seed lookup both see the same casing —
 *  callers must already have normalized `cards` to the SAME scope this
 *  annotates. */
export function buildScopeCardRatings(
    scope: string,
    cards: readonly ScopeCard[],
    getDbRating: GetDbRating
): ScopeCardRating[] {
    const normalizedScope = scope.toLowerCase();
    return cards.map((card) => ({
        ...card,
        dbRating: getDbRating(normalizedScope, card.cardId),
        seedRating: getPickRating(normalizedScope, card.cardId),
    }));
}

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

/** One `cardRatings` row as `listScopeCardRatingsForReplay` ships it — a raw
 *  `(scope, cardId, rating)` triple, deliberately NOT pre-merged with the
 *  seed layer (unlike `ScopeCardRating` above, the admin editor's shape):
 *  the caller (`resolveEventPickRating` via `buildDbRatingLookup` below)
 *  already knows how to layer a DB-only lookup under the seed file itself —
 *  mirrors `cardProfiles.ts`'s `ScopedCardProfile` precedent exactly. */
export interface ScopedCardRating {
    scope: string;
    cardId: string;
    rating: number;
}

/** Turns a flat `listScopeCardRatingsForReplay` result into the `GetDbRating`
 *  closure `resolveEventPickRating` wants — pure, no `ctx`. Mirrors
 *  `cardProfiles.ts`'s `buildDbProfileLookup` exactly: the one shared
 *  "rows -> lookup" step every caller of the scope-rows query needs, kept
 *  out of the query itself since a `useQuery` result has to stay plain
 *  serializable data, not a closure. Case-insensitive on `scope`, matching
 *  `resolveEventPickRating`'s own normalization. */
export function buildDbRatingLookup(
    rows: readonly ScopedCardRating[]
): GetDbRating {
    const byKey = new Map<string, number>();
    for (const row of rows) {
        byKey.set(`${row.scope.toLowerCase()}::${row.cardId}`, row.rating);
    }
    return (scope: string, cardId: string): number | null =>
        byKey.get(`${scope.toLowerCase()}::${cardId}`) ?? null;
}

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
