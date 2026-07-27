// Card Profile layer (ADR 0072 "Card synergy as computed Capability
// matching, not enumerated card pairs", PRD #1607 slice 1, issue #1608).
//
// A Card Profile is the data half of ADR 0072's model: which Archetype(s) a
// card steers toward, which Capabilities it PROVIDES and REQUIRES (matched
// against the closed `capabilityRegistry.ts` vocabulary), and any Combo Edge
// weights to specific partner cards. Stored EXACTLY like Pick Ratings (ADR
// 0066): a `cardProfiles` table keyed `(scope, cardId)` — the same Pack
// Source scope string space, including `CUBE_SOURCE_KEY` — layered over an
// optional checked-in seed file, resolved by one pure seam mirroring
// `cardRatings.ts`'s `resolveEventPickRating`.
//
// `resolveEventCardProfile` (the READ path) is PURE — no `ctx`, no DB
// access — handed an already-scoped `GetDbProfile` closure exactly like
// `resolveEventPickRating` is handed `GetDbRating`; the actual `ctx.db` read
// happens in the thin `listScopeCardProfiles` query below, mirroring how
// `cardRatings.ts` co-locates its pure read-side core with the Convex
// function shell that feeds it real rows.
//
// THIS SLICE IS STILL A DATA FOUNDATION for the SCORER (issue #1608's
// acceptance): no call site feeds `GetCardProfile` into `chooseBotPick` yet.
// `convex/limited/botDrafter.ts` is UNCHANGED — wiring `resolveEventCardProfile`
// into `chooseBotPick` is a LATER PRD #1607 slice (slice 4, "Archetype +
// Capability + Combo Edge terms"), once the scorer itself understands a
// unified 0-5 scale (slice 2, ADR 0073) it can spend a Capability-match
// contribution on. `listScopeCardProfiles` (issue #1612 fixup) exists so a
// DISPLAY-only consumer — the Draft Lab's `DraftLabProfileBadge` — can read
// real `cardProfiles` rows instead of being permanently wired to a `() =>
// null` DB layer; it is a read-only query (no mutation, no write), so it
// does not touch ADR 0074's "the Draft Lab writes nothing" guarantee.
import { isRegisteredCapability } from "./capabilityRegistry";
import { tryGetDefinition } from "../cards";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUserId } from "../auth";

/** One `(scope, cardId)` Card Profile row — the shape both the `cardProfiles`
 *  table (`convex/schema.ts`) and any checked-in seed file share. `provides`/
 *  `requires` entries MUST be rows of `CAPABILITY_REGISTRY`
 *  (`capabilityRegistry.ts`) — enforced by `validateCardProfileFile` below
 *  for the seed layer, and by the same check at the (future) Admin write
 *  boundary for the database layer. `archetypes` is free text (a named
 *  strategy like `reanimator`/`artifacts`/`jeskai-tempo`, ADR 0072) —
 *  deliberately NOT gated by a closed registry: archetypes are a coarse,
 *  ergonomic label the scorer groups picks by, not a matching vocabulary
 *  that needs the same "silently forks into three spellings" guard a
 *  Capability match does. */
export interface CardProfile {
    archetypes: string[];
    provides: string[];
    requires: string[];
    comboEdges?: { cardId: string; weight: number }[];
    reviewed: boolean;
}

/** A single checked-in Card Profile seed file — one per scope, mirroring
 *  `pickRatings.ts`'s `PickRatingFile` shape (`setCode` + a `cardId`-keyed
 *  record). */
export interface CardProfileFile {
    scope: string;
    /** cardId -> profile. An entry is OPTIONAL per card, same discipline as
     *  `PickRatingFile.ratings`: only cards worth profiling need an entry,
     *  everything absent contributes zero from these terms (ADR 0072
     *  Consequences). */
    profiles: Record<string, CardProfile>;
}

/** No checked-in Card Profile seed file ships with this slice (ADR 0072:
 *  "Profiles are LLM-seeded and human-reviewed" — authoring the actual
 *  Vintage Cube census is later PRD #1607 work, not this data-foundation
 *  slice). Structured identically to `pickRatings.ts`'s
 *  `CHECKED_IN_PICK_RATINGS` — a Convex function runs in a V8 isolate with
 *  no Node builtins, so `data/card-profiles/**` (once it exists) can't be
 *  discovered dynamically; add one entry here per future checked-in file. An
 *  empty registry here is exactly ADR 0072's "a scope with no `cardProfiles`
 *  rows and no seed file contributes exactly zero from these terms" case —
 *  every scope resolves to the `null` layer today. */
const CHECKED_IN_CARD_PROFILES: Record<string, CardProfileFile> = {};

/** Resolves a lowercase scope to its checked-in Card Profile file, or `null`
 *  when the scope ships with no profiles data — mirrors `pickRatings.ts`'s
 *  `getPickRatingFile`. Case-insensitive on the input. */
export function getCardProfileFile(scope: string): CardProfileFile | null {
    return CHECKED_IN_CARD_PROFILES[scope.toLowerCase()] ?? null;
}

/** Looks up a single card's profile within one named scope's checked-in seed
 *  file. `null` when the scope has no checked-in file, or the file has no
 *  entry for this card — mirrors `pickRatings.ts`'s `getPickRating`. */
export function getCardProfile(
    scope: string,
    cardId: string
): CardProfile | null {
    const file = getCardProfileFile(scope);
    if (!file) return null;
    const profile = file.profiles[cardId];
    return profile === undefined ? null : profile;
}

/** Resolves ONE `(scope, cardId)` pair to its DATABASE profile, or `null`
 *  when no row exists for that exact pair — injected so this module never
 *  touches `ctx.db`/the `cardProfiles` table directly, mirroring
 *  `cardRatings.ts`'s `GetDbRating`. `scope` is always already lowercased by
 *  the caller (`resolveEventCardProfile` normalizes before calling). */
export type GetDbProfile = (
    scope: string,
    cardId: string
) => CardProfile | null;

/** The lookup shape a (future) Bot Drafter call site would inject into its
 *  scorer — `cardId -> CardProfile | null`, mirroring `botDrafter.ts`'s
 *  `GetPickRating` shape. Not consumed anywhere yet (issue #1608's
 *  acceptance: `botDrafter.ts` is untouched by this slice). */
export type GetCardProfile = (cardId: string) => CardProfile | null;

/** Resolves ONE `(scope, cardId)` pair to its checked-in SEED profile, or
 *  `null` — the same shape `getCardProfile` already has. Exists as its own
 *  named type (rather than inlining `typeof getCardProfile`) so
 *  `resolveEventCardProfile`'s optional third parameter is independently
 *  injectable, mirroring `GetDbProfile`'s "never touch the real source
 *  directly" discipline. Defaults to the real `getCardProfile` in
 *  `resolveEventCardProfile`, so production behavior is unchanged; a test
 *  can inject a fake one to exercise the seed layer even while this slice
 *  ships zero checked-in seed data (`CHECKED_IN_CARD_PROFILES` is `{}` —
 *  see that const's doc comment). Without this seam the middle layering
 *  outcome ("seed row present, no DB row") is structurally untestable until
 *  a real Vintage Cube census file exists. */
export type GetSeedProfile = (
    scope: string,
    cardId: string
) => CardProfile | null;

/** Builds the layered `GetCardProfile` a (future) Limited Event call site
 *  would inject into the scorer (PRD #1607 slice 4) — same shape and same
 *  layering discipline `cardRatings.ts`'s `resolveEventPickRating` already
 *  established for Pick Ratings.
 *
 *  `scopes` is the event's DISTINCT pack-source identities (its
 *  `packSlots`, deduped). Normalized to lowercase here, once.
 *
 *  `getSeedProfile` defaults to the real checked-in-file lookup
 *  (`getCardProfile` above) — a caller never has to pass it. It exists as an
 *  explicit parameter (rather than a hardcoded call to `getCardProfile`,
 *  which is how `cardRatings.ts`'s `resolveEventPickRating` calls
 *  `pickRatings.ts`'s `getPickRating`) because THIS module ships zero
 *  checked-in seed data this slice (`CHECKED_IN_CARD_PROFILES` is `{}`):
 *  `cardRatings.bot.test.ts` can prove real seed-fallback/override behavior
 *  by reading an entry out of the real `lea.json`, but there is no
 *  equivalent real Card Profile seed row to read yet. Injecting the seed
 *  lookup lets the layering itself — not the (still-empty) seed content —
 *  be proven directly.
 *
 *  Resolution order per card, mirroring `resolveEventPickRating` exactly:
 *
 *    1. Database `(scope, cardId)` for ANY of the event's scopes — checked
 *       first, across every scope, before falling to the seed layer at all.
 *    2. Seed `getSeedProfile(scope, cardId)` for ANY of the event's scopes
 *       — the checked-in-file layer.
 *    3. `null` — no profile anywhere; a (future) scorer treats this
 *       identically to an unprofiled card contributing zero Capability/
 *       Archetype terms (ADR 0072 Consequences).
 *
 *  A database row for a scope OUTSIDE `scopes` never leaks in: `getDbProfile`
 *  is only ever called with a scope drawn from `scopes` itself — the SAME
 *  scope-isolation guarantee `resolveEventPickRating` gives Pick Ratings (a
 *  profile in scope `vintage-cube` cannot leak into an event drafting only
 *  `lea`, even for a shared `cardId`). */
export function resolveEventCardProfile(
    scopes: readonly string[],
    getDbProfile: GetDbProfile,
    getSeedProfile: GetSeedProfile = getCardProfile
): GetCardProfile {
    const normalizedScopes = Array.from(
        new Set(scopes.map((scope) => scope.toLowerCase()))
    );

    return (cardId: string): CardProfile | null => {
        for (const scope of normalizedScopes) {
            const dbProfile = getDbProfile(scope, cardId);
            if (dbProfile !== null) return dbProfile;
        }
        for (const scope of normalizedScopes) {
            const seedProfile = getSeedProfile(scope, cardId);
            if (seedProfile !== null) return seedProfile;
        }
        return null;
    };
}

export interface CardProfileValidationResult {
    valid: boolean;
    errors: string[];
}

/** Validates a Card Profile file's `provides`/`requires` Capability strings
 *  against the closed registry (`capabilityRegistry.ts`'s
 *  `isRegisteredCapability`) and its cardIds against the real card catalogue
 *  — the same two-check shape `pickRatings.ts`'s `validatePickRatingFile`
 *  applies to ratings ("resolves to a real card" + "in-bounds"), adapted to
 *  a Capability-vocabulary bound instead of a numeric one. Pure — no I/O —
 *  runs identically over checked-in JSON (a future catalogue-wide guard) or
 *  a hand-built fixture (this slice's negative unit tests, issue #1608's
 *  "guard test fails on an unregistered Capability name" acceptance). */
export function validateCardProfileFile(
    file: CardProfileFile
): CardProfileValidationResult {
    const errors: string[] = [];

    for (const [cardId, profile] of Object.entries(file.profiles)) {
        if (!tryGetDefinition(cardId)) {
            errors.push(
                `${file.scope}: profiled cardId "${cardId}" does not resolve to a card`
            );
        }
        for (const capability of profile.provides) {
            if (!isRegisteredCapability(capability)) {
                errors.push(
                    `${file.scope}: "${cardId}" provides unregistered Capability "${capability}"`
                );
            }
        }
        for (const capability of profile.requires) {
            if (!isRegisteredCapability(capability)) {
                errors.push(
                    `${file.scope}: "${cardId}" requires unregistered Capability "${capability}"`
                );
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/** Every checked-in Card Profile file — the catalogue-wide guard test
 *  (`__tests__/capabilityRegistry.bot.test.ts`) sweeps this so a future
 *  seed-file addition is validated automatically, with zero per-file test
 *  authoring (mirrors `pickRatings.bot.test.ts`'s sweep over
 *  `CHECKED_IN_PICK_RATINGS`). */
export function getAllCheckedInCardProfileFiles(): CardProfileFile[] {
    return Object.values(CHECKED_IN_CARD_PROFILES);
}

// ─────────────────────────────────────────────────────────────────────────
// Read-only query (issue #1612 fixup): a real `cardProfiles` DB layer for a
// DISPLAY-only consumer (the Draft Lab). No write mutation exists here — the
// Admin write boundary this module's header comment defers is still a later
// PRD #1607 slice.
// ─────────────────────────────────────────────────────────────────────────

/** One `cardProfiles` row as `listScopeCardProfiles` ships it — a
 *  `CardProfile` plus the `(scope, cardId)` key it was read under, so a
 *  caller can fold several scopes' rows into one lookup without a second
 *  round trip per scope. */
export interface ScopedCardProfile extends CardProfile {
    scope: string;
    cardId: string;
}

/** Turns a flat `listScopeCardProfiles` result (below) into the
 *  `GetDbProfile` closure `resolveEventCardProfile` wants — pure, no `ctx`.
 *  `listScopeCardProfiles` itself returns the flat row list, not a closure
 *  (a `useQuery` result has to be plain serializable data); this is the one
 *  shared "rows -> lookup" step every caller of that query needs, so it
 *  lives here once instead of being hand-rolled per caller — today that's
 *  `useDraftLab.ts`, folding a live `useQuery` result into
 *  `buildDraftLabCardProfile`. Case-insensitive on `scope`, matching
 *  `resolveEventCardProfile`'s own normalization. */
export function buildDbProfileLookup(
    rows: readonly ScopedCardProfile[]
): GetDbProfile {
    const byKey = new Map<string, CardProfile>();
    for (const row of rows) {
        byKey.set(`${row.scope.toLowerCase()}::${row.cardId}`, row);
    }
    return (scope: string, cardId: string): CardProfile | null =>
        byKey.get(`${scope.toLowerCase()}::${cardId}`) ?? null;
}

const scopedCardProfileValidator = v.object({
    scope: v.string(),
    cardId: v.string(),
    archetypes: v.array(v.string()),
    provides: v.array(v.string()),
    requires: v.array(v.string()),
    comboEdges: v.optional(
        v.array(v.object({ cardId: v.string(), weight: v.number() }))
    ),
    reviewed: v.boolean(),
});

/** Every `cardProfiles` row for a set of scopes — the ONE place this module
 *  touches `ctx.db` directly, mirroring `cardRatings.ts`'s
 *  `listScopeCardRatings`. Unlike that editor query, this is NOT admin-gated
 *  (`getCurrentUserId`, not `assertIsAdmin`): the Draft Lab is a synthetic
 *  developer surface any authenticated user can open (issue #1612), and
 *  reading a Card Profile to render an "unreviewed" badge is informational,
 *  not an Admin-only capability — the SAME "any authenticated user, not
 *  admin-gated" call `listLimitedDraftableSets` already makes for its own
 *  informational read. Read-only: no `insert`/`patch`/`delete` anywhere in
 *  this handler, so it carries no write surface for
 *  `draft-lab-no-mutation.test.ts` to catch.
 *
 *  `scopes` is the caller's distinct pack-source identities (mirrors
 *  `resolveEventCardProfile`'s own `scopes` parameter); normalized to
 *  lowercase here, once. Uses the `by_scope` index per scope — bounded, never
 *  a full-table scan — the same access pattern
 *  `limitedEvents.ts#loadEventPickRating` uses for `cardRatings`. */
export const listScopeCardProfiles = query({
    args: { scopes: v.array(v.string()) },
    returns: v.array(scopedCardProfileValidator),
    handler: async (ctx, { scopes }): Promise<ScopedCardProfile[]> => {
        await getCurrentUserId(ctx);
        const normalizedScopes = Array.from(
            new Set(scopes.map((scope) => scope.toLowerCase()))
        );
        const rows: ScopedCardProfile[] = [];
        for (const scope of normalizedScopes) {
            const scopeRows = await ctx.db
                .query("cardProfiles")
                .withIndex("by_scope", (q) => q.eq("scope", scope))
                .collect();
            for (const row of scopeRows) {
                rows.push({
                    scope: row.scope,
                    cardId: row.cardId,
                    archetypes: row.archetypes,
                    provides: row.provides,
                    requires: row.requires,
                    comboEdges: row.comboEdges,
                    reviewed: row.reviewed,
                });
            }
        }
        return rows;
    },
});
