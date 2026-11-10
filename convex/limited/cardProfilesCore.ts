// Card Profile layer — the PURE half (ADR 0072 "Card synergy as computed
// Capability matching, not enumerated card pairs", PRD #1607 slice 1, issue
// #1608; split into two layers by ADR 0167, issue #8890).
//
// A Card Profile is the data half of ADR 0072's model, stored as TWO layers
// keyed differently (ADR 0167):
//
//   * **Card Capabilities** — `provides` / `requires` (matched against the
//     closed `capabilityRegistry.ts` vocabulary), the Combo Edges, a
//     `reviewed` flag and a census `rationale`. A property of the CARD:
//     keyed by `cardId` alone, one catalogue-wide seed file
//     (`data/card-profiles/capabilities.json`) under one DB table
//     (`cardCapabilities`). They hold in every scope.
//   * **Card Archetypes** — `archetypes` (rows of the Archetype Catalogue,
//     `archetypeCatalogueCore.ts`), their own `reviewed` flag and `rationale`. A property of
//     the card IN an environment: keyed `(scope, cardId)` — the Pack Source
//     scope string space, including `CUBE_SOURCE_KEY` — one seed file per
//     scope (`data/card-profiles/archetypes/<scope>.json`) under one DB table
//     (`cardArchetypes`).
//
// `resolveEventCardProfile` RECOMPOSES both layers into the one
// `GetCardProfile` lookup the drafter, Auto-Build and the Draft Signal
// consume (ADR 0167 §4), each half carrying its own review flag so each
// scorer term discounts by its own layer's review state.
//
// Everything here is PURE — no `ctx`, no DB access, and no import of
// `../_generated/server` or `../auth`, so a BROWSER caller (the Draft Lab,
// which ADR 0074 explicitly allows to import pure engine modules) can import
// it without dragging `convexAuth()` into the Vite bundle. See
// `cardRatingsCore.ts`'s header for the full "process is not defined" story
// this split fixes; `scripts/__tests__/client-bundle-purity.test.ts` guards
// the boundary. The `ctx.db`-owning query/mutation shell lives in the sibling
// `cardProfiles.ts`.
//
// The scorer consumes this seam (issue #1611): `convex/limitedEvents.ts`'s
// `loadEventCardProfile` folds the database rows through
// `resolveEventCardProfile` and injects the resulting `GetCardProfile` into
// `chooseBotPick`, where the Archetype Fit / Capability Fit / Combo Edge
// terms spend it — an UNREVIEWED layer at half weight (ADR 0072).
import { isRegisteredCapability } from "./capabilityRegistry";
import { ARCHETYPE_CATALOGUE_SEED_IDS } from "./archetypeCatalogueCore";
import { resolveCardName } from "../cards";
import { tryGetDefinition } from "../cards/registry";
import { getCardColorIdentity } from "../cards/colors";
import type { Color } from "../cards/types";
import { CUBE_SOURCE_KEY } from "./cubeSource";
import type { ScopeCard } from "./cardRatingsCore";
import capabilitiesJson from "../../data/card-profiles/capabilities.json";
import vintageCubeArchetypesJson from "../../data/card-profiles/archetypes/vintage-cube.json";

/** An explicit, signed, directed pair to one partner card (ADR 0072's Combo
 *  Edge escape hatch). Lives in the Capability layer (issue #8890): scope-
 *  free, an edge weighs only when its partner is in the Pool (ADR 0167 §5). */
export interface ComboEdge {
    cardId: string;
    weight: number;
}

/** One card's Capability layer (ADR 0167 §1) — the shape the
 *  `cardCapabilities` table (`convex/schema.ts`) and the catalogue-wide seed
 *  file share. `provides`/`requires` entries MUST be rows of
 *  `CAPABILITY_REGISTRY` (`capabilityRegistry.ts`) — enforced by
 *  `validateCardCapabilityFile` for the seed layer and by
 *  `cardProfileWriteErrors` at the Admin write boundary. */
export interface CardCapabilities {
    provides: string[];
    requires: string[];
    comboEdges?: ComboEdge[];
    /** LLM-seeded rows start `false`; a human flips it (ADR 0072). */
    reviewed: boolean;
    /** The census's one-line reason, when it wrote one. */
    rationale?: string;
}

/** One card's Archetype layer IN ONE SCOPE (ADR 0167 §2). `archetypes`
 *  entries MUST be Archetype Catalogue row ids (`archetypeCatalogueCore.ts`),
 *  normalized (trimmed + lowercased) — a closed vocabulary because
 *  `archetypeFitTerm` groups picks by EXACT STRING EQUALITY, so
 *  `reanimator`/`reanimate`/`graveyard-reanimator` would be three plans to
 *  the scorer and one to a human. */
export interface CardArchetypes {
    archetypes: string[];
    reviewed: boolean;
    rationale?: string;
}

/** The RECOMPOSED profile the scorer reads (ADR 0167 §4): both layers'
 *  data, plus ONE review flag PER LAYER (issue #8890) — Archetype Fit reads
 *  `archetypesReviewed`, Capability Fit and Combo Edge read
 *  `capabilitiesReviewed`. A layer the card has no row for contributes empty
 *  data and `false` (irrelevant: empty data scores nothing). */
export interface CardProfile {
    archetypes: string[];
    provides: string[];
    requires: string[];
    comboEdges?: ComboEdge[];
    archetypesReviewed: boolean;
    capabilitiesReviewed: boolean;
}

/** The one profile shape the CURRENT Admin editor reads and writes: both
 *  layers' data and a single review act (saving "reviewed" flips BOTH layers;
 *  `reviewed` reads `true` only when every layer present is reviewed). The
 *  desktop rewrite with one tab per layer is a later slice of PRD #8772. */
export interface EditorCardProfile {
    archetypes: string[];
    provides: string[];
    requires: string[];
    comboEdges?: ComboEdge[];
    reviewed: boolean;
}

/** The catalogue-wide checked-in Capability seed file — `cardId`-keyed, no
 *  scope (ADR 0167 §1). An entry is OPTIONAL per card: everything absent
 *  contributes zero from the Capability terms (ADR 0072 Consequences). */
export interface CardCapabilityFile {
    capabilities: Record<string, CardCapabilities>;
}

/** One scope's checked-in Archetype seed file. */
export interface CardArchetypeFile {
    scope: string;
    archetypes: Record<string, CardArchetypes>;
}

/** `capabilities.json` is the LLM-generated Vintage Cube census (issue #1614,
 *  ADR 0072's "Profiles are LLM-seeded and human-reviewed"), split out of the
 *  old single-layer per-scope file (issue #8890). Every row ships
 *  `reviewed: false` — HALF weight (`botDrafter.ts`'s
 *  `UNREVIEWED_PROFILE_WEIGHT`) until a human flips it in the Admin editor. */
const CHECKED_IN_CARD_CAPABILITIES = capabilitiesJson as CardCapabilityFile;

/** Every checked-in Archetype seed file, keyed by lowercase scope (a Convex
 *  function runs in a V8 isolate with no Node builtins, so
 *  `data/card-profiles/archetypes/**` can't be discovered dynamically; add
 *  one entry here per checked-in file). A scope absent from this record
 *  resolves to no seed Archetypes. */
const CHECKED_IN_CARD_ARCHETYPES: Record<string, CardArchetypeFile> = {
    [CUBE_SOURCE_KEY]: vintageCubeArchetypesJson as CardArchetypeFile,
};

/** The catalogue-wide checked-in Capability file. */
export function getCardCapabilityFile(): CardCapabilityFile {
    return CHECKED_IN_CARD_CAPABILITIES;
}

/** A lowercase scope's checked-in Archetype file, or `null` when the scope
 *  ships none. Case-insensitive on the input. */
export function getCardArchetypeFile(scope: string): CardArchetypeFile | null {
    return CHECKED_IN_CARD_ARCHETYPES[scope.toLowerCase()] ?? null;
}

/** Every checked-in Archetype file — the guard sweep reads this so a new
 *  scope's file is validated with zero per-file test authoring. */
export function getAllCheckedInCardArchetypeFiles(): CardArchetypeFile[] {
    return Object.values(CHECKED_IN_CARD_ARCHETYPES);
}

/** One card's SEED Capabilities, or `null`. */
export function getSeedCardCapabilities(
    cardId: string
): CardCapabilities | null {
    return CHECKED_IN_CARD_CAPABILITIES.capabilities[cardId] ?? null;
}

/** One `(scope, cardId)` pair's SEED Archetypes, or `null`. */
export function getSeedCardArchetypes(
    scope: string,
    cardId: string
): CardArchetypes | null {
    return getCardArchetypeFile(scope)?.archetypes[cardId] ?? null;
}

/** One source of BOTH layers — the database (`buildDbProfileLayers` over the
 *  rows `cardProfiles.ts` loads) or the checked-in seed
 *  (`SEED_PROFILE_LAYERS`). Injected so this module never touches `ctx.db`,
 *  and so a layering test can run against a FIXTURE rather than whatever the
 *  real census says about a card. `scope` is always already lowercased by
 *  the caller. */
export interface ProfileLayers {
    getCapabilities(cardId: string): CardCapabilities | null;
    getArchetypes(scope: string, cardId: string): CardArchetypes | null;
}

/** The checked-in seed, as a `ProfileLayers`. */
export const SEED_PROFILE_LAYERS: ProfileLayers = {
    getCapabilities: getSeedCardCapabilities,
    getArchetypes: getSeedCardArchetypes,
};

/** A source with no rows at all — the DB layer before its query resolves. */
export const EMPTY_PROFILE_LAYERS: ProfileLayers = {
    getCapabilities: () => null,
    getArchetypes: () => null,
};

/** The lookup shape a Bot Drafter call site injects into its scorer —
 *  `cardId -> CardProfile | null`. Consumed by `chooseBotPick`/
 *  `scoreCandidate`'s three synergy terms since issue #1611, by Auto-Build
 *  and by the Draft Signal. */
export type GetCardProfile = (cardId: string) => CardProfile | null;

/** Recomposes one card's two layers into the scorer's `CardProfile`, or
 *  `null` when the card has neither (ADR 0072: "a missing profile and a
 *  deliberately empty one are indistinguishable to the scorer"). */
export function composeCardProfile(
    capabilities: CardCapabilities | null,
    archetypes: CardArchetypes | null
): CardProfile | null {
    if (capabilities === null && archetypes === null) return null;
    return {
        archetypes: archetypes ? [...archetypes.archetypes] : [],
        provides: capabilities ? [...capabilities.provides] : [],
        requires: capabilities ? [...capabilities.requires] : [],
        ...(capabilities?.comboEdges === undefined
            ? {}
            : {
                  comboEdges: capabilities.comboEdges.map((edge) => ({
                      ...edge,
                  })),
              }),
        archetypesReviewed: archetypes?.reviewed ?? false,
        capabilitiesReviewed: capabilities?.reviewed ?? false,
    };
}

/** `true` when every layer that carries data is reviewed — what a display
 *  surface (the Draft Lab's badge) means by "this profile is reviewed". An
 *  empty layer is not evidence and never makes a profile "unreviewed". */
export function isCardProfileReviewed(profile: CardProfile): boolean {
    const hasCapabilities =
        profile.provides.length > 0 ||
        profile.requires.length > 0 ||
        (profile.comboEdges?.length ?? 0) > 0;
    return (
        (profile.archetypes.length === 0 || profile.archetypesReviewed) &&
        (!hasCapabilities || profile.capabilitiesReviewed)
    );
}

/** Builds the layered `GetCardProfile` a Limited Event (and the Draft Lab)
 *  injects into the scorer — the same layering discipline
 *  `cardRatingsCore.ts`'s `resolveEventPickRating` established for Pick
 *  Ratings, applied PER LAYER (ADR 0167):
 *
 *    * **Capabilities** — database row for the card, else the seed row. No
 *      scope: they reach every event, including a set the cube census never
 *      tagged (ADR 0167 §1).
 *    * **Archetypes** — database `(scope, cardId)` for ANY of the event's
 *      scopes, checked first across every scope, then the seed for any
 *      scope. A row for a scope OUTSIDE `scopes` never leaks in:
 *      `getArchetypes` is only ever called with a scope drawn from `scopes`
 *      itself.
 *
 *  `scopes` is the event's DISTINCT pack-source identities (its `packSlots`,
 *  deduped). Normalized to lowercase here, once. */
export function resolveEventCardProfile(
    scopes: readonly string[],
    db: ProfileLayers,
    seed: ProfileLayers = SEED_PROFILE_LAYERS
): GetCardProfile {
    const normalizedScopes = Array.from(
        new Set(scopes.map((scope) => scope.toLowerCase()))
    );

    const resolveArchetypes = (cardId: string): CardArchetypes | null => {
        for (const scope of normalizedScopes) {
            const row = db.getArchetypes(scope, cardId);
            if (row !== null) return row;
        }
        for (const scope of normalizedScopes) {
            const row = seed.getArchetypes(scope, cardId);
            if (row !== null) return row;
        }
        return null;
    };

    return (cardId: string): CardProfile | null =>
        composeCardProfile(
            db.getCapabilities(cardId) ?? seed.getCapabilities(cardId),
            resolveArchetypes(cardId)
        );
}

export interface CardProfileValidationResult {
    valid: boolean;
    errors: string[];
}

/** Validates the Capability seed file: every cardId (row key and Combo Edge
 *  partner) resolves to a real card, every `provides`/`requires` string is a
 *  `CAPABILITY_REGISTRY` row, every edge weight is finite. Pure. */
export function validateCardCapabilityFile(
    file: CardCapabilityFile
): CardProfileValidationResult {
    const errors: string[] = [];
    for (const [cardId, row] of Object.entries(file.capabilities)) {
        for (const error of capabilityErrors(cardId, row)) {
            errors.push(`capabilities: ${error}`);
        }
    }
    return { valid: errors.length === 0, errors };
}

/** Validates one scope's Archetype seed file: every cardId resolves to a
 *  real card and every archetype is a row of the catalogue SEED — never the
 *  DB layer, so CI stays offline (ADR 0167) — checked EXACTLY as written,
 *  never normalized first (issue #3597): a seed file is
 *  hand/LLM-authored data whose strings `archetypeFitTerm` groups on
 *  verbatim, so ` Control ` must fail rather than pass as `control`. */
export function validateCardArchetypeFile(
    file: CardArchetypeFile
): CardProfileValidationResult {
    const errors: string[] = [];
    for (const [cardId, row] of Object.entries(file.archetypes)) {
        if (resolveCardName(cardId) === null) {
            errors.push(
                `${file.scope}: cardId "${cardId}" does not resolve to a card`
            );
        }
        for (const archetype of row.archetypes) {
            if (!ARCHETYPE_CATALOGUE_SEED_IDS.has(archetype)) {
                errors.push(
                    `${file.scope}: "${cardId}" declares Archetype "${archetype}", not a catalogue seed row`
                );
            }
        }
    }
    return { valid: errors.length === 0, errors };
}

/** The shared Capability-layer check — ONE authority for the seed guard and
 *  the Admin write boundary, so the two can never drift on what a legal
 *  Capability row is (the `isValidRating` discipline). */
function capabilityErrors(
    cardId: string,
    row: Pick<CardCapabilities, "provides" | "requires" | "comboEdges">
): string[] {
    const errors: string[] = [];
    if (resolveCardName(cardId) === null) {
        errors.push(`cardId "${cardId}" does not resolve to a card`);
    }
    for (const capability of row.provides) {
        if (!isRegisteredCapability(capability)) {
            errors.push(
                `"${cardId}" provides unregistered Capability "${capability}"`
            );
        }
    }
    for (const capability of row.requires) {
        if (!isRegisteredCapability(capability)) {
            errors.push(
                `"${cardId}" requires unregistered Capability "${capability}"`
            );
        }
    }
    for (const edge of row.comboEdges ?? []) {
        if (resolveCardName(edge.cardId) === null) {
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

/** One `cardCapabilities` row as the DB layer ships it. */
export interface CardCapabilitiesRow extends CardCapabilities {
    cardId: string;
}

/** One `cardArchetypes` row as the DB layer ships it. */
export interface ScopedCardArchetypes extends CardArchetypes {
    scope: string;
    cardId: string;
}

/** Both layers' DB rows for a set of scopes — the plain serializable payload
 *  `listScopeCardProfiles` (`cardProfiles.ts`) returns (a `useQuery` result
 *  cannot be a closure) and `loadEventCardProfile` folds. */
export interface ProfileLayerRows {
    capabilities: CardCapabilitiesRow[];
    archetypes: ScopedCardArchetypes[];
}

export const EMPTY_PROFILE_LAYER_ROWS: ProfileLayerRows = {
    capabilities: [],
    archetypes: [],
};

/** A Capability row's layer fields, without its `cardId` key. */
export function capabilitiesOf(row: CardCapabilitiesRow): CardCapabilities {
    return {
        provides: row.provides,
        requires: row.requires,
        ...(row.comboEdges === undefined ? {} : { comboEdges: row.comboEdges }),
        reviewed: row.reviewed,
        ...(row.rationale === undefined ? {} : { rationale: row.rationale }),
    };
}

/** An Archetype row's layer fields, without its `(scope, cardId)` key. */
export function archetypesOf(row: ScopedCardArchetypes): CardArchetypes {
    return {
        archetypes: row.archetypes,
        reviewed: row.reviewed,
        ...(row.rationale === undefined ? {} : { rationale: row.rationale }),
    };
}

/** Folds a flat `ProfileLayerRows` into the `ProfileLayers` closure
 *  `resolveEventCardProfile` wants — the one shared "rows -> lookup" step
 *  every caller of `listScopeCardProfiles` needs. Case-insensitive on
 *  `scope`, matching `resolveEventCardProfile`'s own normalization. */
export function buildDbProfileLayers(rows: ProfileLayerRows): ProfileLayers {
    const capabilities = new Map<string, CardCapabilities>();
    for (const row of rows.capabilities) {
        capabilities.set(row.cardId, capabilitiesOf(row));
    }
    const archetypes = new Map<string, CardArchetypes>();
    for (const row of rows.archetypes) {
        archetypes.set(
            `${row.scope.toLowerCase()}::${row.cardId}`,
            archetypesOf(row)
        );
    }
    return {
        getCapabilities: (cardId) => capabilities.get(cardId) ?? null,
        getArchetypes: (scope, cardId) =>
            archetypes.get(`${scope.toLowerCase()}::${cardId}`) ?? null,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Admin write boundary — PURE pieces only (PRD #1607, ADR 0072, issue
// #1614). The `assertIsAdmin`-gated `setCardProfile`/`clearCardProfile`
// mutations and the editor query own `ctx.db` and live in `cardProfiles.ts`.
// ─────────────────────────────────────────────────────────────────────────

/** Normalizes an Archetype list: trimmed, lowercased, empties dropped,
 *  duplicates removed, input order preserved. Archetypes ARE grouped by exact
 *  string equality in `botDrafter.ts`'s Archetype Fit term, so `Reanimator`
 *  and `reanimator` would silently be two different plans. This function is
 *  the NORMALIZER; the Archetype Catalogue is the VOCABULARY, and the write
 *  boundary runs this first so the catalogue check reads
 *  exactly what will be stored. Pure. */
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

/** Every reason ONE editor write must be rejected, or `[]` when it is legal —
 *  the Capability half through the SAME `capabilityErrors` the seed guard
 *  uses, the Archetype half on the NORMALIZED form (what is about to be
 *  stored: a direct mutation call typing `Control` lands as `control` or is
 *  rejected, never stored as a third spelling) against `catalogue`, the
 *  effective Archetype Catalogue's ids (seed ∪ DB, ADR 0167). Pure. */
export function cardProfileWriteErrors(
    cardId: string,
    profile: EditorCardProfile,
    catalogue: ReadonlySet<string>
): string[] {
    const errors = capabilityErrors(cardId, profile);
    for (const archetype of normalizeArchetypes(profile.archetypes)) {
        if (!catalogue.has(archetype)) {
            errors.push(`Archetype "${archetype}" is not a catalogue row`);
        }
    }
    return errors;
}

/** The exact two rows `setCardProfile` upserts for one editor save: the
 *  card's Capability row (scope-free — an edit made from one scope's editor
 *  holds in every scope, ADR 0167 §1) and its Archetype row for `scope`
 *  (lowercased). `archetypes` normalized, capabilities deduped on the way IN
 *  (`capabilityFitTerm` collapses duplicates defensively, but without this
 *  they would persist and round-trip through the editor forever); one review
 *  act flips both layers. Does NOT validate — `cardProfileWriteErrors`. */
export function buildCardProfileRows(
    scope: string,
    cardId: string,
    profile: EditorCardProfile
): { capabilities: CardCapabilitiesRow; archetypes: ScopedCardArchetypes } {
    return {
        capabilities: {
            cardId,
            provides: [...new Set(profile.provides)],
            requires: [...new Set(profile.requires)],
            ...(profile.comboEdges === undefined
                ? {}
                : {
                      comboEdges: profile.comboEdges.map((edge) => ({
                          ...edge,
                      })),
                  }),
            reviewed: profile.reviewed,
        },
        archetypes: {
            scope: scope.toLowerCase(),
            cardId,
            archetypes: normalizeArchetypes(profile.archetypes),
            reviewed: profile.reviewed,
        },
    };
}

/** Folds one card's two layers into the editor's single-review shape, or
 *  `null` when it has neither. `reviewed` = every PRESENT layer reviewed. */
export function toEditorCardProfile(
    capabilities: CardCapabilities | null,
    archetypes: CardArchetypes | null
): EditorCardProfile | null {
    if (capabilities === null && archetypes === null) return null;
    return {
        archetypes: archetypes ? [...archetypes.archetypes] : [],
        provides: capabilities ? [...capabilities.provides] : [],
        requires: capabilities ? [...capabilities.requires] : [],
        ...(capabilities?.comboEdges === undefined
            ? {}
            : {
                  comboEdges: capabilities.comboEdges.map((edge) => ({
                      ...edge,
                  })),
              }),
        reviewed:
            (capabilities?.reviewed ?? true) && (archetypes?.reviewed ?? true),
    };
}

/** One card of a scope as the Admin editor lists it: `dbProfile` — the
 *  EFFECTIVE profile when the database overrides EITHER layer (the other
 *  layer read from the seed, so a one-layer override never blanks the other
 *  half), `null` when it overrides neither — and `seedProfile`, the checked-
 *  in census default. The editor renders `dbProfile ?? seedProfile`. Mirrors
 *  `cardRatingsCore.ts`'s `ScopeCardRating`. */
export interface ScopeCardProfile extends ScopeCard {
    dbProfile: EditorCardProfile | null;
    seedProfile: EditorCardProfile | null;
    /** The card's colour identity (`getCardColorIdentity`) — what the
     *  Archetype Catalogue rail's colour bar is computed from (ADR 0167). */
    colours: Color[];
}

/** One card's colour identity, `[]` for an id with no definition. */
export function cardColours(cardId: string): Color[] {
    const def = tryGetDefinition(cardId);
    return def === null ? [] : getCardColorIdentity(def);
}

/** Annotates `cards` (a scope's enumerated card list, `cardRatingsCore.ts`'s
 *  `listScopeCards` — REUSED: the Pick Rating and Card Profile editors must
 *  list exactly the same cards for a scope) with both sources. Pure core of
 *  `listScopeCardProfilesForEditor`. `scope` is normalized HERE, once. */
export function buildScopeCardProfiles(
    scope: string,
    cards: readonly ScopeCard[],
    db: ProfileLayers,
    seed: ProfileLayers = SEED_PROFILE_LAYERS
): ScopeCardProfile[] {
    const normalizedScope = scope.toLowerCase();
    return cards.map((card) => {
        const seedCapabilities = seed.getCapabilities(card.cardId);
        const seedArchetypes = seed.getArchetypes(normalizedScope, card.cardId);
        const dbCapabilities = db.getCapabilities(card.cardId);
        const dbArchetypes = db.getArchetypes(normalizedScope, card.cardId);
        const overridden = dbCapabilities !== null || dbArchetypes !== null;
        return {
            ...card,
            colours: cardColours(card.cardId),
            dbProfile: overridden
                ? toEditorCardProfile(
                      dbCapabilities ?? seedCapabilities,
                      dbArchetypes ?? seedArchetypes
                  )
                : null,
            seedProfile: toEditorCardProfile(seedCapabilities, seedArchetypes),
        };
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Profile Census contract — the rationale vocabulary and the residue schema
// (`.claude/skills/profile-census/`, PRD #8772). PURE, so the Admin panel
// (which shows the rationale and the residue) and the offline seed validator
// (`scripts/lib/profile-census.ts`) read ONE definition of each.
// ─────────────────────────────────────────────────────────────────────────

/** The kinds of source a census rationale may name, in the order the skill
 *  lists them. A rationale is `<kind>[+<kind>…]: <one line>` — the kind
 *  prefix tells a reviewer in one glance how far to trust the line (an
 *  `oracle` read is checkable on the card; a `popular-pick` is hearsay). */
export const CENSUS_SOURCE_KINDS = [
    "oracle",
    "set-review",
    "cube-writeup",
    "declared-interaction",
    "popular-pick",
    "rubric",
] as const;

export type CensusSourceKind = (typeof CENSUS_SOURCE_KINDS)[number];

const CENSUS_SOURCE_KIND_SET: ReadonlySet<string> = new Set(
    CENSUS_SOURCE_KINDS
);

/** Every reason `rationale` is not a census rationale, or `[]`. One line, a
 *  `+`-joined list of `CENSUS_SOURCE_KINDS` before the first `: `, a
 *  non-empty reason after it. Pure. */
export function censusRationaleErrors(rationale: string | undefined): string[] {
    if (rationale === undefined || rationale.trim() === "") {
        return ["rationale is missing"];
    }
    if (/[\r\n]/.test(rationale)) return ["rationale spans more than one line"];
    const colon = rationale.indexOf(": ");
    if (colon <= 0) {
        return [
            `rationale "${rationale}" does not open with "<source-kind>: "`,
        ];
    }
    const errors: string[] = [];
    for (const kind of rationale.slice(0, colon).split("+")) {
        if (!CENSUS_SOURCE_KIND_SET.has(kind)) {
            errors.push(
                `rationale names source kind "${kind}", not one of ${CENSUS_SOURCE_KINDS.join(", ")}`
            );
        }
    }
    if (rationale.slice(colon + 2).trim() === "") {
        errors.push("rationale has no reason after its source kind");
    }
    return errors;
}

/** The three census passes. `capability` runs over the card catalogue once
 *  per card; `archetype` over one scope; `delta` applies `rows` (new
 *  catalogue or registry ids) across one scope and leaves every other tag. */
export const CENSUS_PASSES = ["capability", "archetype", "delta"] as const;
export type CensusPass = (typeof CENSUS_PASSES)[number];

/** The `scope` a capability pass's residue names: Capabilities are keyed by
 *  card alone (ADR 0167 §1), so that pass has no Pack Source scope. */
export const CATALOGUE_CENSUS_SCOPE = "catalogue";

/** One Capability the census needed and the registry lacks: the cards that
 *  would PROVIDE it, the cards that would REQUIRE it, one line of why. A
 *  candidate, never a row — promotion is a registry ticket (the skill's
 *  promotion template), never an edit to this file. */
export interface CensusResidueCandidate {
    name: string;
    providers: string[];
    requirers: string[];
    why: string;
}

/** One pass's residue file, `data/card-profiles/residue/<pass>-<scope>.json`.
 *  Read-only data to the engine: no scorer reads it. */
export interface CensusResidueFile {
    pass: CensusPass;
    scope: string;
    /** The ids a `delta` pass applied; absent on the other two passes. */
    rows?: string[];
    candidates: CensusResidueCandidate[];
}

const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cardListErrors(
    candidate: string,
    side: "providers" | "requirers",
    cardIds: unknown
): string[] {
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
        return [`candidate "${candidate}" lists no ${side}`];
    }
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const cardId of cardIds) {
        if (typeof cardId !== "string" || resolveCardName(cardId) === null) {
            errors.push(
                `candidate "${candidate}" ${side}: "${String(cardId)}" does not resolve to a card`
            );
        } else if (seen.has(cardId)) {
            errors.push(`candidate "${candidate}" ${side}: "${cardId}" twice`);
        }
        if (typeof cardId === "string") seen.add(cardId);
    }
    return errors;
}

/** Validates a residue file read as untyped JSON: the pass/scope/rows
 *  header, and per candidate a kebab-case name that is NOT already a
 *  registered Capability (then it is a tag, not a candidate) nor an
 *  Archetype Catalogue seed id (then it is an Archetype), at least one
 *  resolving provider and one resolving requirer (a one-sided Capability
 *  can never match, ADR 0072), and a one-line why. Pure. */
export function validateCensusResidue(
    file: unknown
): CardProfileValidationResult {
    const errors: string[] = [];
    if (typeof file !== "object" || file === null || Array.isArray(file)) {
        return { valid: false, errors: ["residue is not a JSON object"] };
    }
    const residue = file as Record<string, unknown>;
    const allowed = new Set(["pass", "scope", "rows", "candidates"]);
    for (const key of Object.keys(residue)) {
        if (!allowed.has(key)) errors.push(`unknown residue key "${key}"`);
    }
    const pass = residue.pass;
    if (!(CENSUS_PASSES as readonly unknown[]).includes(pass)) {
        errors.push(
            `pass "${String(pass)}" is not one of ${CENSUS_PASSES.join(", ")}`
        );
    }
    const scope = residue.scope;
    if (
        typeof scope !== "string" ||
        scope === "" ||
        scope !== scope.toLowerCase()
    ) {
        errors.push(`scope "${String(scope)}" is not a lowercase scope`);
    } else if ((pass === "capability") !== (scope === CATALOGUE_CENSUS_SCOPE)) {
        errors.push(
            `scope "${scope}": a capability pass and only it names scope "${CATALOGUE_CENSUS_SCOPE}"`
        );
    }
    const rows = residue.rows;
    if (pass === "delta") {
        if (
            !Array.isArray(rows) ||
            rows.length === 0 ||
            rows.some((row) => typeof row !== "string" || !KEBAB_ID.test(row))
        ) {
            errors.push("a delta residue names its rows as kebab-case ids");
        }
    } else if (rows !== undefined) {
        errors.push(`a ${String(pass)} residue carries no rows`);
    }
    const candidates = residue.candidates;
    if (!Array.isArray(candidates)) {
        errors.push("candidates is not an array");
        return { valid: false, errors };
    }
    const names = new Set<string>();
    for (const raw of candidates) {
        if (typeof raw !== "object" || raw === null) {
            errors.push("a candidate is not an object");
            continue;
        }
        const candidate = raw as Record<string, unknown>;
        const name = String(candidate.name);
        for (const key of Object.keys(candidate)) {
            if (!["name", "providers", "requirers", "why"].includes(key)) {
                errors.push(`candidate "${name}": unknown key "${key}"`);
            }
        }
        if (typeof candidate.name !== "string" || !KEBAB_ID.test(name)) {
            errors.push(`candidate name "${name}" is not kebab-case`);
        } else if (isRegisteredCapability(name)) {
            errors.push(
                `candidate "${name}" is already a registered Capability — tag it, do not propose it`
            );
        } else if (ARCHETYPE_CATALOGUE_SEED_IDS.has(name)) {
            errors.push(
                `candidate "${name}" is an Archetype Catalogue row, not a Capability`
            );
        }
        if (names.has(name)) errors.push(`candidate "${name}" listed twice`);
        names.add(name);
        errors.push(...cardListErrors(name, "providers", candidate.providers));
        errors.push(...cardListErrors(name, "requirers", candidate.requirers));
        const why = candidate.why;
        if (typeof why !== "string" || why.trim() === "") {
            errors.push(`candidate "${name}" has no why`);
        } else if (/[\r\n]/.test(why)) {
            errors.push(`candidate "${name}": why spans more than one line`);
        }
    }
    return { valid: errors.length === 0, errors };
}
