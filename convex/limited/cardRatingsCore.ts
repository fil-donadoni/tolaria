// Bot Drafter Pick Rating layer — the PURE half (PRD #1296, ADR 0066, issue
// #1297). Layers a database override (the `cardRatings` table,
// `convex/schema.ts`) on top of the existing checked-in seed file
// (`pickRatings.ts`'s `getPickRating`) into the SAME `GetPickRating` shape
// `botDrafter.ts`'s `chooseBotPick` already accepts — `botDrafter.ts` itself
// is UNCHANGED; only WHICH lookup `convex/limitedEvents.ts` injects into it
// changes.
//
// Everything here is PURE — no `ctx`, no DB access, and (this module's whole
// reason for existing as a separate file) NO import of
// `../_generated/server` or `../auth`. The Convex function shells that feed
// these helpers real rows live in the sibling `cardRatings.ts`; a caller that
// runs in the BROWSER — the Draft Lab (`src/lib/limited/draftLabEngine.ts`,
// `src/hooks/useDraftLabReplay.ts`), which ADR 0074 explicitly allows to
// import pure engine modules — imports from HERE.
//
// Why the split (issue: "Uncaught ReferenceError: process is not defined").
// `convex/auth.ts` calls `convexAuth({...})` at module scope, and
// `@convex-dev/auth/server` reads `process.env` while materializing provider
// defaults. When the pure helpers lived in the same module as the
// query/mutation shells, ONE client-side value import of
// `resolveEventPickRating` pulled `cardRatings.ts` -> `../auth` ->
// `convexAuth()` into the Vite bundle, and the whole app died on cold load.
// `scripts/__tests__/client-bundle-purity.test.ts` guards the boundary.
//
// A ctx-owning read/write path belongs in `cardRatings.ts`; a pure
// layering/enumeration helper belongs here. Both halves still share the one
// `cardRatings` table and the one `(scope, cardId)` key discipline.
import { getPickRating } from "./pickRatings";
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

/** The exact row `setCardRating` (`cardRatings.ts`) inserts/patches: `scope`
 *  normalized to lowercase (the SAME case discipline `resolveEventPickRating`
 *  and `packSlots`/`pickRatings.ts` already use), `cardId` and `rating`
 *  carried verbatim. Pure — no `ctx` — so the write mutation's row-shape
 *  decision is unit-testable directly, without a convex-test harness (project
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

/** One `cardRatings` row as `listScopeCardRatingsForReplay`
 *  (`cardRatings.ts`) ships it — a raw `(scope, cardId, rating)` triple,
 *  deliberately NOT pre-merged with the seed layer (unlike `ScopeCardRating`
 *  above, the admin editor's shape): the caller (`resolveEventPickRating` via
 *  `buildDbRatingLookup` below) already knows how to layer a DB-only lookup
 *  under the seed file itself — mirrors `cardProfilesCore.ts`'s
 *  `ScopedCardProfile` precedent exactly. */
export interface ScopedCardRating {
    scope: string;
    cardId: string;
    rating: number;
}

/** Turns a flat `listScopeCardRatingsForReplay` result into the `GetDbRating`
 *  closure `resolveEventPickRating` wants — pure, no `ctx`. Mirrors
 *  `cardProfilesCore.ts`'s `buildDbProfileLookup` exactly: the one shared
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
