/** Target-filter registry — the single compile-bound authority for target
 *  legality (ADR 0068, PRD #1407). This is slice **T1** (issue #1408):
 *  registry scaffold + the PERMANENT kind only, folding in the existing
 *  `intrinsicPermanentTargetViolation` shared predicate. Spell/player/card
 *  kinds land in T2/T3; the `FilterKey = keyof Omit<TargetRequirement,
 *  StructuralKey>` compile-time forcing function arms in T4 — this module
 *  intentionally keys the registry by an explicit permanent-filter list for
 *  now (`PERMANENT_FILTER_KEYS`), not by `keyof Omit<...>`, so it compiles
 *  standalone before every kind has an entry.
 *
 *  **Lower once, check everywhere** (the whole point): `lower` resolves a
 *  `TargetRequirement` field to its `PendingTarget` carry value (X-resolution,
 *  `string | string[]` normalization) — that value IS the corresponding
 *  `PendingTarget` field. `getLegalTargets` lowers then runs `checks.permanent`
 *  per candidate; `selectTarget` (`game.ts`) runs the SAME check against the
 *  already-lowered `PendingTarget`. Offered set == accepted set by
 *  construction — there is no second implementation of any filter to drift
 *  (the Phelia bug class, `78c0279c`).
 *
 *  This module has NO dependency on `./rules` — `rules.ts` and `game.ts`
 *  import from here instead, so the dependency direction stays acyclic. The
 *  handful of low-level predicates the checks need (`hasColor`,
 *  `matchesMvFilter`, `resolveMvFilter`, `matchesBattlefieldController`) moved
 *  here from `rules.ts`; `rules.ts` re-exports them for backward
 *  compatibility with existing callers/imports. */
import type { CardType, Color, TargetRequirement } from "../cards/types";
import type { CardInstanceState, GameState } from "./state";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
import { hasSupertypeLive } from "./snow";
import { manaValue } from "./constants";
import { tryGetDefinition } from "../cards";

// ─── Shared low-level predicates (moved from rules.ts) ──────────────────────

/** True if the permanent/stack item has at least one of the given color in
 *  its mana cost (CR 202.2). Used by TargetRequirement.colorFilter. */
export function hasColor(card: CardInstanceState, color: Color): boolean {
    return STATIC_EFFECT_CTX.getColors(card).includes(color);
}

/** Resolves a TargetRequirement.mvFilter's `"X"` placeholders against the
 *  announced chosenX so downstream code only sees numeric bounds.
 *  Used by getLegalTargets and selectTarget validation. */
export function resolveMvFilter(
    filter: TargetRequirement["mvFilter"] | undefined,
    chosenX: number | undefined
): { min?: number; max?: number; equals?: number } | undefined {
    if (!filter) return undefined;
    const resolveOne = (v: number | "X" | undefined): number | undefined => {
        if (v === undefined) return undefined;
        if (v === "X") return chosenX ?? 0;
        return v;
    };
    return {
        ...(filter.min !== undefined ? { min: resolveOne(filter.min)! } : {}),
        ...(filter.max !== undefined ? { max: resolveOne(filter.max)! } : {}),
        ...(filter.equals !== undefined
            ? { equals: resolveOne(filter.equals)! }
            : {}),
    };
}

/** Computes mana value for a target lookup. For permanents on the
 *  battlefield, X-cost permanents currently report 0 for X (the chosen X
 *  is not persisted on the resulting permanent). */
function mvOfPermanent(card: CardInstanceState): number {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return manaValue(def?.manaCost);
}

/** Tests a resolved mvFilter against a target's mana value. Empty filter
 *  always matches; otherwise all declared bounds (min/max/equals) must hold. */
export function matchesMvFilter(
    filter: { min?: number; max?: number; equals?: number } | undefined,
    mv: number
): boolean {
    if (!filter) return true;
    if (filter.equals !== undefined && mv !== filter.equals) return false;
    if (filter.min !== undefined && mv < filter.min) return false;
    if (filter.max !== undefined && mv > filter.max) return false;
    return true;
}

/** CR 109.3 / 102.1 — the single authority on a battlefield/permanent target's
 *  controller-relationship filter (`TargetRequirement.controller`). Both
 *  `getLegalTargets` (which permanents may be offered) and the `selectTarget`
 *  mutation's permanent branch (which permanents the server will accept —
 *  anti-spoof) route through this predicate so the two can never disagree.
 *
 *  - `"you"`      — the permanent's controller is the chooser (Simulacrum).
 *  - `"opponent"` — the controller is NOT the chooser (Nettling Imp). A missing
 *                   `chooserId` can never satisfy this.
 *  - `"active"`   — the controller is the active player regardless of who is
 *                   choosing (Arcum's Whistle).
 *  - `"any"` / undefined — no controller restriction. */
export function matchesBattlefieldController(
    controllerId: string,
    chooserId: string | undefined,
    activePlayerId: string,
    filter: TargetRequirement["controller"]
): boolean {
    switch (filter ?? "any") {
        case "you":
            return chooserId !== undefined && controllerId === chooserId;
        case "opponent":
            return chooserId !== undefined && controllerId !== chooserId;
        case "active":
            return controllerId === activePlayerId;
        case "any":
            return true;
    }
}

/** `T | T[] | undefined` → `T[] | undefined` normalization shared by every
 *  `lower()` that accepts the shorthand-single-value authoring convenience. */
function arr<T>(v: T | T[] | undefined): T[] | undefined {
    return v === undefined ? undefined : Array.isArray(v) ? v : [v];
}

// ─── Registry shape (ADR 0068) ──────────────────────────────────────────────

/** The four object kinds a `TargetRequirement` can resolve to. Only
 *  `"permanent"` has registry entries in T1 — spell/player/card land in
 *  T2/T3. */
export type TargetKind = "permanent" | "spell" | "player" | "card";

/** Context threaded into every `check`. Source-dependent (chooser/active
 *  player/source characteristics) so a filter's check can read them without
 *  each descriptor re-deriving them. */
export interface TargetFilterCtx {
    state: GameState;
    sourceColors: readonly Color[];
    sourceTypes: readonly CardType[];
    sourceSubtypes: readonly string[];
    chooserId?: string;
    activePlayerId: string;
    sourceIsSpell?: boolean;
}

/** One filter's full contract: `lower` resolves the requirement field to its
 *  carried value (the `PendingTarget` field), `checks` maps a `TargetKind` to
 *  the legality predicate for candidates of that kind. Loop semantics
 *  (identical at every call site): a filter whose lowered value is
 *  `undefined` is skipped; a filter whose value is present but whose
 *  candidate kind is absent from `checks` excludes that candidate. */
export interface FilterDescriptor<V> {
    lower(req: TargetRequirement, chosenX?: number): V | undefined;
    checks: Partial<{
        permanent: (
            candidate: CardInstanceState,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
        spell: (
            candidate: unknown,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
        player: (
            candidate: unknown,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
        card: (
            candidate: unknown,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
    }>;
}

/** Identity helper that lets each descriptor be authored with its own
 *  strongly-typed `V` (inferred from the literal passed in) before being
 *  folded into the loosely-typed `REGISTRY` map below. */
function defineFilter<V>(d: FilterDescriptor<V>): FilterDescriptor<V> {
    return d;
}

// ─── T1 permanent-filter descriptors ────────────────────────────────────────
// One entry per filter currently covered by `intrinsicPermanentTargetViolation`
// (CR 109.1 / 115 / 202 / 205 / 613 / 701.20), plus `controller` (CR 109.3 /
// 102.1, via `matchesBattlefieldController`). Messages match the prior
// hand-written implementations verbatim — this is a behavior-preserving
// refactor, not a behavior change.

const controllerFilter = defineFilter<TargetRequirement["controller"]>({
    lower: (req) => req.controller,
    checks: {
        permanent: (card, value, ctx) => {
            if (
                matchesBattlefieldController(
                    card.controllerId,
                    ctx.chooserId,
                    ctx.activePlayerId,
                    value
                )
            ) {
                return null;
            }
            return value === "you"
                ? "Must target a permanent you control"
                : value === "opponent"
                  ? "Must target a permanent an opponent controls"
                  : "Must target a permanent the active player controls";
        },
    },
});

// CR 205.3 — subtype filter ("target Mountains"): at least one present.
const subtypeFilterDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.subtypeFilter),
    checks: {
        permanent: (card, value) =>
            value.some((s) => card.subtypes.includes(s))
                ? null
                : `Target must be ${value.join(" or ")}`,
    },
});

// CR 205.4a — live supertype filter ("target snow lands"): ALL present.
const supertypeFilterDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.supertypeFilter),
    checks: {
        permanent: (card, value) =>
            value.every((s) => hasSupertypeLive(card, s))
                ? null
                : `Target must be ${value.join(" and ")}`,
    },
});

// CR 205.4a — negative supertype filter ("target nonbasic land").
const excludeSupertypesDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.excludeSupertypes),
    checks: {
        permanent: (card, value) =>
            value.some((s) => hasSupertypeLive(card, s))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 109.1 — type-exclude filter ("nonland permanent", "nonartifact").
const excludeTypesDescriptor = defineFilter<CardType[]>({
    lower: (req) => arr(req.excludeTypes),
    checks: {
        permanent: (card, value) =>
            value.some((t) => card.types.includes(t))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 202.2 — color-exclude filter (Terror's "nonblack").
const excludeColorsDescriptor = defineFilter<Color[]>({
    lower: (req) => arr(req.excludeColors),
    checks: {
        permanent: (card, value) =>
            value.some((c) => hasColor(card, c))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 205.3 — subtype-exclude filter (Nettling Imp's "non-Wall").
const excludeSubtypesDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.excludeSubtypes),
    checks: {
        permanent: (card, value) =>
            value.some((s) => card.subtypes.includes(s))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 202.2 — positive color filter (Circle of Protection).
const colorFilterDescriptor = defineFilter<Color>({
    lower: (req) => req.colorFilter,
    checks: {
        permanent: (card, value) =>
            hasColor(card, value) ? null : `Target must be ${value}`,
    },
});

// CR 202.2 — OR-over-colors filter ("a black or red source").
const colorFilterAnyDescriptor = defineFilter<ReadonlyArray<Color>>({
    lower: (req) => req.colorFilterAny,
    checks: {
        permanent: (card, value) =>
            value.some((c) => hasColor(card, c))
                ? null
                : `Target must be ${value.join(" or ")}`,
    },
});

// CR 701.20 — tap-state filter ("target tapped/untapped ~").
const tappedFilterDescriptor = defineFilter<"tapped" | "untapped">({
    lower: (req) => req.tappedFilter,
    checks: {
        permanent: (card, value) => {
            if (value === "tapped" && !card.isTapped)
                return "Target must be tapped";
            if (value === "untapped" && card.isTapped)
                return "Target must be untapped";
            return null;
        },
    },
});

// CR 508.1 / 509.1 — combat-role filter ("target attacking/blocking ~").
// NOTE: unlike the other array-shorthand filters, `lower` intentionally does
// NOT normalize to an array — the `PendingTarget.combatRoleFilter` carry
// preserves the requirement's original scalar-or-array shape (matching the
// pre-refactor `pendingTargetFiltersFromRequirement`, which copied it through
// unchanged). Normalization to an array happens inside the `permanent` check
// instead, exactly where the original `intrinsicPermanentTargetViolation` did it.
const combatRoleFilterDescriptor = defineFilter<
    "attacking" | "blocking" | ("attacking" | "blocking")[]
>({
    lower: (req) => req.combatRoleFilter,
    checks: {
        permanent: (card, value) => {
            const roles = arr(value)!;
            const ok = roles.some(
                (r) =>
                    (r === "attacking" && card.isAttacking) ||
                    (r === "blocking" && card.isBlocking)
            );
            return ok ? null : `Target must be ${roles.join(" or ")}`;
        },
    },
});

// CR 702 — positive keyword filter ("target creature with flying").
const requireAbilityDescriptor = defineFilter<string>({
    lower: (req) => req.requireAbility,
    checks: {
        permanent: (card, value) =>
            card.staticAbilities.includes(value)
                ? null
                : `Target must have ${value}`,
    },
});

// CR 702 — negative keyword filter ("target creature without flying").
const excludeAbilityDescriptor = defineFilter<string>({
    lower: (req) => req.excludeAbility,
    checks: {
        permanent: (card, value) =>
            card.staticAbilities.includes(value)
                ? `Target must not have ${value}`
                : null,
    },
});

// CR 601.2c — "other than ~" / reflexive self-exclude (Phelia, Sorceress
// Queen). Carries the source id resolved from `excludeSource` by the caller.
const excludeInstanceIdsDescriptor = defineFilter<ReadonlyArray<string>>({
    lower: (req) =>
        req.excludeInstanceIds && req.excludeInstanceIds.length > 0
            ? [...req.excludeInstanceIds]
            : undefined,
    checks: {
        permanent: (card, value) =>
            value.includes(card.id) ? "Can't target that permanent" : null,
    },
});

// CR 613 layer 7c — effective power bounds.
const powerFilterDescriptor = defineFilter<{ min?: number; max?: number }>({
    lower: (req) => req.powerFilter,
    checks: {
        permanent: (card, value, ctx) => {
            const power = getEffectivePower(ctx.state, card);
            if (value.min !== undefined && power < value.min)
                return `Target must have power ≥ ${value.min}`;
            if (value.max !== undefined && power > value.max)
                return `Target must have power ≤ ${value.max}`;
            return null;
        },
    },
});

// CR 613 layer 7c — effective toughness bounds.
const toughnessFilterDescriptor = defineFilter<{
    min?: number;
    max?: number;
}>({
    lower: (req) => req.toughnessFilter,
    checks: {
        permanent: (card, value, ctx) => {
            const toughness = getEffectiveToughness(ctx.state, card);
            if (value.min !== undefined && toughness < value.min)
                return `Target must have toughness ≥ ${value.min}`;
            if (value.max !== undefined && toughness > value.max)
                return `Target must have toughness ≤ ${value.max}`;
            return null;
        },
    },
});

// CR 202.3 — mana-value filter, X-resolved at `lower` time.
const mvFilterDescriptor = defineFilter<{
    min?: number;
    max?: number;
    equals?: number;
}>({
    lower: (req, chosenX) => resolveMvFilter(req.mvFilter, chosenX),
    checks: {
        permanent: (card, value) =>
            matchesMvFilter(value, mvOfPermanent(card))
                ? null
                : "Target does not match the required mana value",
    },
});

/** The permanent-applicable filter keys T1 registers. `controller` is listed
 *  first so a controller violation surfaces before any intrinsic-filter
 *  violation, matching the prior hand-written check order at both call
 *  sites. NOT `keyof Omit<TargetRequirement, StructuralKey>` yet — that
 *  compile-time forcing function is T4's keystone (ADR 0068); this is an
 *  explicit list so T1 compiles standalone before every kind has coverage. */
export const PERMANENT_FILTER_KEYS = [
    "controller",
    "subtypeFilter",
    "supertypeFilter",
    "excludeSubtypes",
    "excludeSupertypes",
    "excludeTypes",
    "excludeColors",
    "colorFilter",
    "colorFilterAny",
    "tappedFilter",
    "combatRoleFilter",
    "requireAbility",
    "excludeAbility",
    "excludeInstanceIds",
    "powerFilter",
    "toughnessFilter",
    "mvFilter",
] as const;

export type PermanentFilterKey = (typeof PERMANENT_FILTER_KEYS)[number];

/** The registry. Loosely typed (`FilterDescriptor<unknown>`) in T1 by design
 *  — see the module doc comment and issue #1408. Each descriptor above is
 *  authored with its own precise `V` via `defineFilter`; only the aggregate
 *  map relaxes to `unknown` so a heterogeneous-by-key map can exist before
 *  the T4 `satisfies Record<FilterKey, …>` keystone. */
export const REGISTRY: Record<PermanentFilterKey, FilterDescriptor<unknown>> = {
    controller: controllerFilter as FilterDescriptor<unknown>,
    subtypeFilter: subtypeFilterDescriptor as FilterDescriptor<unknown>,
    supertypeFilter: supertypeFilterDescriptor as FilterDescriptor<unknown>,
    excludeSubtypes: excludeSubtypesDescriptor as FilterDescriptor<unknown>,
    excludeSupertypes: excludeSupertypesDescriptor as FilterDescriptor<unknown>,
    excludeTypes: excludeTypesDescriptor as FilterDescriptor<unknown>,
    excludeColors: excludeColorsDescriptor as FilterDescriptor<unknown>,
    colorFilter: colorFilterDescriptor as FilterDescriptor<unknown>,
    colorFilterAny: colorFilterAnyDescriptor as FilterDescriptor<unknown>,
    tappedFilter: tappedFilterDescriptor as FilterDescriptor<unknown>,
    combatRoleFilter: combatRoleFilterDescriptor as FilterDescriptor<unknown>,
    requireAbility: requireAbilityDescriptor as FilterDescriptor<unknown>,
    excludeAbility: excludeAbilityDescriptor as FilterDescriptor<unknown>,
    excludeInstanceIds:
        excludeInstanceIdsDescriptor as FilterDescriptor<unknown>,
    powerFilter: powerFilterDescriptor as FilterDescriptor<unknown>,
    toughnessFilter: toughnessFilterDescriptor as FilterDescriptor<unknown>,
    mvFilter: mvFilterDescriptor as FilterDescriptor<unknown>,
};

/** The requirement-derived filter VALUES for the permanent kind — the
 *  `lower()` output shape, and exactly what both `getLegalTargets` and
 *  `selectTarget` pass into `checkPermanentTargetFilters`. Structurally the
 *  same fields `intrinsicPermanentTargetViolation` used to take, plus
 *  `controller` (folded in by this slice). */
export type PermanentFilterValues = Partial<{
    controller: TargetRequirement["controller"];
    subtypeFilter: string[];
    supertypeFilter: string[];
    excludeSubtypes: string[];
    excludeSupertypes: string[];
    excludeTypes: CardType[];
    excludeColors: Color[];
    colorFilter: Color;
    colorFilterAny: ReadonlyArray<Color>;
    tappedFilter: "tapped" | "untapped";
    combatRoleFilter: "attacking" | "blocking" | ("attacking" | "blocking")[];
    requireAbility: string;
    excludeAbility: string;
    excludeInstanceIds: ReadonlyArray<string>;
    powerFilter: { min?: number; max?: number };
    toughnessFilter: { min?: number; max?: number };
    mvFilter: { min?: number; max?: number; equals?: number };
}>;

/** Runs every SET filter in `values` against `candidate` through the
 *  registry's `permanent` check, in `PERMANENT_FILTER_KEYS` order. Returns
 *  the first violation message, or `null` when the candidate is legal. THE
 *  single authority both `getLegalTargets` (offered set) and `selectTarget`
 *  (accepted set, anti-spoof) call — the two can never diverge, since there
 *  is only one implementation to run. */
export function checkPermanentTargetFilters(
    ctx: TargetFilterCtx,
    candidate: CardInstanceState,
    values: PermanentFilterValues
): string | null {
    for (const key of PERMANENT_FILTER_KEYS) {
        const value = values[key];
        if (value === undefined) continue;
        const check = REGISTRY[key].checks.permanent;
        if (!check) {
            // Loop semantics (ADR 0068): a filter set but whose kind has no
            // check excludes the candidate. Unreachable in T1 — every
            // permanent-filter key above declares a `permanent` check — kept
            // for symmetry with the general registry contract.
            return "Target does not match the required filter";
        }
        const violation = check(candidate, value, ctx);
        if (violation) return violation;
    }
    return null;
}

/** Runs every permanent filter's `lower()` against `req`/`chosenX` and
 *  returns the subset with a defined value — the carry step
 *  (`pendingTargetFiltersFromRequirement`'s permanent-filter half). Each
 *  key's output IS the corresponding `PendingTarget` field, by construction. */
export function lowerPermanentFilters(
    req: TargetRequirement,
    chosenX: number | undefined
): PermanentFilterValues {
    const out: Record<string, unknown> = {};
    for (const key of PERMANENT_FILTER_KEYS) {
        const value = REGISTRY[key].lower(req, chosenX);
        if (value !== undefined) out[key] = value;
    }
    return out as PermanentFilterValues;
}
