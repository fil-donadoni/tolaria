// Bot Drafter Pick Rating layer, Slice A (PRD #1296, ADR 0066, issue #1297):
// the ONE new seam this slice adds. Layers a database override (the new
// `cardRatings` table, `convex/schema.ts`) on top of the existing checked-in
// seed file (`pickRatings.ts`'s `getPickRating`) into the SAME
// `GetPickRating` shape `botDrafter.ts`'s `chooseBotPick` already accepts —
// `botDrafter.ts` itself is UNCHANGED by this slice; only WHICH lookup
// `convex/limitedEvents.ts` injects into it changes.
//
// PURE — no `ctx`, no DB access. `resolveEventPickRating` is handed an
// already-scoped `GetDbRating` closure (the actual `ctx.db` read happens in
// `convex/limitedEvents.ts`, the thin mutation shell, mirroring every other
// pure/DB-access split in this module — `eventLogic.ts`'s `ResolveCardMeta`,
// `botDrafter.ts`'s `GetCardEvalMeta`). This keeps the layering logic
// unit-testable with a plain in-memory map, no convex-test harness needed
// (project convention, `convex/__tests__/adminAuth.test.ts`).
import { getPickRating } from "./pickRatings";
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
