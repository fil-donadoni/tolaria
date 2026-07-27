// Card Profile layer — the PURE half (ADR 0072 "Card synergy as computed
// Capability matching, not enumerated card pairs", PRD #1607 slice 1, issue
// #1608).
//
// A Card Profile is the data half of ADR 0072's model: which Archetype(s) a
// card steers toward, which Capabilities it PROVIDES and REQUIRES (matched
// against the closed `capabilityRegistry.ts` vocabulary), and any Combo Edge
// weights to specific partner cards. Stored EXACTLY like Pick Ratings (ADR
// 0066): a `cardProfiles` table keyed `(scope, cardId)` — the same Pack
// Source scope string space, including `CUBE_SOURCE_KEY` — layered over an
// optional checked-in seed file, resolved by one pure seam mirroring
// `cardRatingsCore.ts`'s `resolveEventPickRating`.
//
// Everything here is PURE — no `ctx`, no DB access, and no import of
// `../_generated/server` or `../auth`, so a BROWSER caller (the Draft Lab,
// which ADR 0074 explicitly allows to import pure engine modules) can import
// it without dragging `convexAuth()` into the Vite bundle. See
// `cardRatingsCore.ts`'s header for the full "process is not defined" story
// this split fixes; `scripts/__tests__/client-bundle-purity.test.ts` guards
// the boundary. The `ctx.db`-owning query shell lives in the sibling
// `cardProfiles.ts`.
//
// The scorer NOW consumes this seam (issue #1611): `convex/limitedEvents.ts`'s
// `loadEventCardProfile` folds the database rows through
// `resolveEventCardProfile` and injects the resulting `GetCardProfile` into
// `chooseBotPick`, where the Archetype Fit / Capability Fit / Combo Edge terms
// spend it — an UNREVIEWED row at half weight (ADR 0072). Issue #1614 closes
// the loop at both ends: the checked-in Vintage Cube census below is the seed
// layer's first real content, and `normalizeArchetypes`/`cardProfileWriteErrors`/
// `buildCardProfileRow`/`buildScopeCardProfiles` further down are the pure
// pieces the `assertIsAdmin`-gated `setCardProfile`/`clearCardProfile`
// mutations and the Admin editor query (`cardProfiles.ts`) build on — pure
// row-shape/validation logic belongs HERE, only the `ctx.db`/`assertIsAdmin`
// shells live in the sibling file.
import { isRegisteredCapability } from "./capabilityRegistry";
import { tryGetDefinition } from "../cards";
import { CUBE_SOURCE_KEY } from "./cubeSource";
import type { ScopeCard } from "./cardRatingsCore";
import vintageCubeProfilesJson from "../../data/card-profiles/vintage-cube.json";

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

/** Every checked-in Card Profile seed file, keyed by lowercase scope —
 *  structured identically to `pickRatings.ts`'s `CHECKED_IN_PICK_RATINGS` (a
 *  Convex function runs in a V8 isolate with no Node builtins, so
 *  `data/card-profiles/**` can't be discovered dynamically; add one entry
 *  here per checked-in file).
 *
 *  `vintage-cube.json` is the LLM-generated census (issue #1614, ADR 0072's
 *  "Profiles are LLM-seeded and human-reviewed"; ADR 0044 is the precedent
 *  for LLM-generated repo data). EVERY row in it carries `reviewed: false` —
 *  it contributes at HALF the contextual cap (`botDrafter.ts`'s
 *  `UNREVIEWED_PROFILE_WEIGHT`) until a human flips the flag through the
 *  Admin editor, which is the whole point of the flag: a confidently wrong
 *  LLM assertion is visible in the Draft Lab without being allowed to decide
 *  picks. A scope absent from this record still resolves to the `null` layer
 *  (ADR 0072: "a scope with no `cardProfiles` rows and no seed file
 *  contributes exactly zero from these terms"). */
const CHECKED_IN_CARD_PROFILES: Record<string, CardProfileFile> = {
    [CUBE_SOURCE_KEY]: vintageCubeProfilesJson as CardProfileFile,
};

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
 *  `cardRatingsCore.ts`'s `GetDbRating`. `scope` is always already lowercased
 *  by the caller (`resolveEventCardProfile` normalizes before calling). */
export type GetDbProfile = (
    scope: string,
    cardId: string
) => CardProfile | null;

/** The lookup shape a Bot Drafter call site injects into its scorer —
 *  `cardId -> CardProfile | null`, mirroring `botDrafter.ts`'s
 *  `GetPickRating` shape. Consumed by `chooseBotPick`/`scoreCandidate`'s
 *  three synergy terms since issue #1611. */
export type GetCardProfile = (cardId: string) => CardProfile | null;

/** Resolves ONE `(scope, cardId)` pair to its checked-in SEED profile, or
 *  `null` — the same shape `getCardProfile` already has. Exists as its own
 *  named type (rather than inlining `typeof getCardProfile`) so
 *  `resolveEventCardProfile`'s optional third parameter is independently
 *  injectable, mirroring `GetDbProfile`'s "never touch the real source
 *  directly" discipline. Defaults to the real `getCardProfile` in
 *  `resolveEventCardProfile`, so production behavior is unchanged; a test
 *  can inject a fake one to exercise the middle layering outcome ("seed row
 *  present, no DB row") against a FIXTURE rather than against whatever the
 *  real Vintage Cube census (issue #1614) happens to say about a particular
 *  card — a layering test must not be coupled to census content. */
export type GetSeedProfile = (
    scope: string,
    cardId: string
) => CardProfile | null;

/** Builds the layered `GetCardProfile` a (future) Limited Event call site
 *  would inject into the scorer (PRD #1607 slice 4) — same shape and same
 *  layering discipline `cardRatingsCore.ts`'s `resolveEventPickRating`
 *  already established for Pick Ratings.
 *
 *  `scopes` is the event's DISTINCT pack-source identities (its
 *  `packSlots`, deduped). Normalized to lowercase here, once.
 *
 *  `getSeedProfile` defaults to the real checked-in-file lookup
 *  (`getCardProfile` above) — a caller never has to pass it. It exists as an
 *  explicit parameter (rather than a hardcoded call to `getCardProfile`,
 *  which is how `cardRatingsCore.ts`'s `resolveEventPickRating` calls
 *  `pickRatings.ts`'s `getPickRating`) because THIS module ships zero
 *  checked-in seed data this slice (`CHECKED_IN_CARD_PROFILES` is `{}`):
 *  `cardRatings.bot.test.ts` can prove real seed-fallback/override behavior
 *  by reading an entry out of the real `lea.json`, but there is no
 *  equivalent real Card Profile seed row to read yet. Injecting the seed
 *  lookup lets the layering itself — not the seed content — be proven
 *  directly. The Vintage Cube census (issue #1614) now fills the real seed
 *  layer, so tests can ALSO assert against it, but the seam stays: a
 *  layering test must not be coupled to whatever the census happens to say
 *  about a particular card.
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

/** One `cardProfiles` row as `listScopeCardProfiles` (`cardProfiles.ts`)
 *  ships it — a `CardProfile` plus the `(scope, cardId)` key it was read
 *  under, so a caller can fold several scopes' rows into one lookup without
 *  a second round trip per scope. */
export interface ScopedCardProfile extends CardProfile {
    scope: string;
    cardId: string;
}

/** Turns a flat `listScopeCardProfiles` result into the `GetDbProfile`
 *  closure `resolveEventCardProfile` wants — pure, no `ctx`.
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

// ─────────────────────────────────────────────────────────────────────────
// Admin write boundary — PURE pieces only (PRD #1607, ADR 0072, issue #1614).
// The `assertIsAdmin`-gated `setCardProfile`/`clearCardProfile` mutations and
// the admin-gated `listScopeCardProfilesForEditor` query own `ctx.db` and
// live in the sibling `cardProfiles.ts`; everything below is unit-testable
// with no convex-test harness, mirroring `cardRatingsCore.ts`'s
// `buildCardRatingRow`/`buildScopeCardRatings`.
// ─────────────────────────────────────────────────────────────────────────

/** Normalizes a free-text Archetype list: trimmed, lowercased, empties
 *  dropped, duplicates removed, input order preserved. Archetypes are NOT
 *  gated by a closed registry (see `CardProfile`'s doc comment) — but they
 *  ARE grouped by exact string equality in `botDrafter.ts`'s Archetype Fit
 *  term, so `Reanimator` and `reanimator` would silently be two different
 *  plans. Case-folding here is the cheapest possible guard against that fork
 *  WITHOUT introducing a registry: the same reasoning `scope` normalization
 *  already applies (user-facing/data-driven text normalizes; internal engine
 *  vocabulary — a Capability id — stays case-SENSITIVE, see
 *  `isRegisteredCapability`). Pure. */
export function normalizeArchetypes(archetypes: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of archetypes) {
        const normalized = raw.trim().toLowerCase();
        if (normalized === "" || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

/** Every reason ONE profile write must be rejected, or `[]` when it is
 *  legal — the SAME two checks `validateCardProfileFile` applies to the seed
 *  layer ("resolves to a real card" + "every Capability is a registry row"),
 *  reused here so the database layer and the checked-in layer can never
 *  drift apart on what a legal profile is (the `isValidRating` discipline
 *  `setCardRating` established: ONE bounds authority, never two copies).
 *  Pure — no `ctx`. */
export function cardProfileWriteErrors(
    cardId: string,
    profile: CardProfile
): string[] {
    const errors: string[] = [];
    if (!tryGetDefinition(cardId)) {
        errors.push(`cardId "${cardId}" does not resolve to a card`);
    }
    for (const capability of profile.provides) {
        if (!isRegisteredCapability(capability)) {
            errors.push(`unregistered Capability provided: "${capability}"`);
        }
    }
    for (const capability of profile.requires) {
        if (!isRegisteredCapability(capability)) {
            errors.push(`unregistered Capability required: "${capability}"`);
        }
    }
    for (const edge of profile.comboEdges ?? []) {
        if (!tryGetDefinition(edge.cardId)) {
            errors.push(
                `combo edge partner "${edge.cardId}" does not resolve to a card`
            );
        }
        if (!Number.isFinite(edge.weight)) {
            errors.push(
                `combo edge to "${edge.cardId}" has a non-finite weight`
            );
        }
    }
    return errors;
}

/** The exact row `setCardProfile` (`cardProfiles.ts`) inserts/patches: `scope`
 *  lowercased (the case discipline `resolveEventCardProfile`/`packSlots`/
 *  `cardRatingsCore.ts` already share), `archetypes` normalized, everything
 *  else carried verbatim. Pure — no `ctx` — so the write mutation's row-shape
 *  decision is unit-testable directly, mirroring `cardRatingsCore.ts`'s
 *  `buildCardRatingRow`. Does NOT validate — that is `cardProfileWriteErrors`'
 *  job, never duplicated here. */
export function buildCardProfileRow(
    scope: string,
    cardId: string,
    profile: CardProfile
): ScopedCardProfile {
    return {
        scope: scope.toLowerCase(),
        cardId,
        archetypes: normalizeArchetypes(profile.archetypes),
        // Deduped on the way IN: `capabilityFitTerm` already collapses
        // duplicates defensively (issue #1611 review), so a repeated entry
        // never double-counts a synergy — but without this it would persist
        // and round-trip through the editor forever.
        provides: [...new Set(profile.provides)],
        requires: [...new Set(profile.requires)],
        ...(profile.comboEdges === undefined
            ? {}
            : { comboEdges: profile.comboEdges.map((edge) => ({ ...edge })) }),
        reviewed: profile.reviewed,
    };
}

/** One card of a scope annotated with BOTH profile layers, the shape the
 *  Admin editor lists: `dbProfile` (an explicit database override, `null`
 *  when unset) and `seedProfile` (the checked-in census default, `null` when
 *  the scope/card has none) — so the editor renders the EFFECTIVE profile
 *  (`dbProfile ?? seedProfile`) while still showing whether it is an
 *  override or the seed. Mirrors `cardRatingsCore.ts`'s `ScopeCardRating`. */
export interface ScopeCardProfile extends ScopeCard {
    dbProfile: CardProfile | null;
    seedProfile: CardProfile | null;
}

/** Annotates `cards` (a scope's enumerated card list, `cardRatingsCore.ts`'s
 *  `listScopeCards` — REUSED, never re-implemented: the Admin editors for
 *  Pick Ratings and Card Profiles must list exactly the same cards for a
 *  scope) with both profile layers. Pure core of the editor query
 *  (`cardProfiles.ts`'s `listScopeCardProfilesForEditor`), so it is
 *  unit-testable with a plain in-memory `GetDbProfile`, no convex-test
 *  harness — same split as `buildScopeCardRatings`. `scope` is normalized
 *  HERE, once. */
export function buildScopeCardProfiles(
    scope: string,
    cards: readonly ScopeCard[],
    getDbProfile: GetDbProfile,
    getSeedProfile: GetSeedProfile = getCardProfile
): ScopeCardProfile[] {
    const normalizedScope = scope.toLowerCase();
    return cards.map((card) => ({
        ...card,
        dbProfile: getDbProfile(normalizedScope, card.cardId),
        seedProfile: getSeedProfile(normalizedScope, card.cardId),
    }));
}
