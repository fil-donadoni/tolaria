// Filter type system shared by trigger factories (ADR 0002).
//
// Per-event filter vocabularies. Each filter type is paired with a pure
// matcher; matchers take an entity (permanent / spell event / damage source
// description / player) plus the filter and an optional FilterMatchContext.
// No engine state mutation — matchers are referentially transparent in their
// inputs so they can be reused across the engine, the UI, and tests.
//
// PermanentFilter is the canonical name (a permanent is on-battlefield by
// definition, CR 110.1 — `BattlefieldFilter` would be redundant).

import type { CardType, Color } from "./types";

// --- Shared match context ---

/** Optional context passed to matchers to resolve scope predicates
 *  (`controllerRelation`, `relation`). Fields are set by the caller (typically
 *  a trigger factory at fire time) from the source permanent / event payload. */
export interface FilterMatchContext {
    /** Instance id of the trigger's source permanent (CR 603 — "this"). Used
     *  by `controllerRelation: "self"` to identify the source itself. */
    selfInstanceId?: string;
    /** Controller of the trigger's source at trigger time (CR 109.4). Used by
     *  `"you"` / `"opponents"` relation checks. */
    selfControllerId?: string;
    /** Active player at trigger time (CR 500.1). Used by PlayerFilter's
     *  `"active"` / `"non-active"` relation. */
    activePlayerId?: string;
}

// --- PermanentFilter (CR 110.1) ---

/** Declarative selector over permanents on the battlefield. Used by mass
 *  primitives (`destroyAll`, `dealDamageToEach`), trigger factories
 *  (`enteredTrigger.filter`, etc.), and mid-resolution choice pickers. All
 *  fields are combined with AND; omitted fields don't constrain. */
export interface PermanentFilter {
    types?: CardType | CardType[];
    /** Exclude permanents whose `types` include any of these (CR 205). The
     *  negative of `types`; used for "nonartifact creature" (The Abyss),
     *  "noncreature permanent", etc. Single value is shorthand for one type.
     *  AND with every other field. */
    excludeTypes?: CardType | CardType[];
    subtypes?: string | string[];
    /** Only match permanents whose `staticAbilities` contains this keyword. */
    requireAbility?: string;
    /** Skip permanents whose `staticAbilities` contains this keyword. */
    excludeAbility?: string;
    /** Filter by token-ness (CR 111.5 / 701.16 — "sacrifice a nontoken
     *  permanent"). `false` excludes token instances; `true` keeps only
     *  tokens. Omitted = no constraint. */
    isToken?: boolean;
    /** Exclude these instance ids from the match set. Used to skip a
     *  permanent's own id when an effect specifies "another permanent"
     *  (CR 109.2) or "permanents other than ~". */
    excludeInstanceIds?: ReadonlyArray<string>;
    /** Restrict the match set to exactly these instance ids (AND with every
     *  other field). Used to scope a choice to a single named permanent —
     *  e.g. the per-permanent optional-untap prompt (ATQ cluster E "you may
     *  choose not to untap this"). Omitted = no id constraint. */
    instanceIds?: ReadonlyArray<string>;
    /** Filter by derived colors (CR 202.2). Single color or set; match
     *  requires the permanent has AT LEAST ONE of the listed colors (OR
     *  semantics within the field, AND with other fields). Used by triggers
     *  like Mana Vortex's "whenever a Land matching {color}" cycle and by
     *  protection-style filters. */
    colors?: Color | Color[];
    /** Inclusive lower bound on effective power (CR 613 layer 7c). Matches
     *  only if `card.power !== undefined` and `card.power >= powerAtLeast`. */
    powerAtLeast?: number;
    /** Inclusive lower bound on effective toughness. Matches only if
     *  `card.toughness !== undefined` and `card.toughness >= toughnessAtLeast`. */
    toughnessAtLeast?: number;
    /** Controller relation between the permanent and the trigger's source
     *  (resolved via `FilterMatchContext`). "self" — the permanent IS the
     *  source; "you" — same controller as the source; "opponents" — different
     *  controller; "any" / undefined — no constraint. */
    controllerRelation?: "self" | "you" | "opponents" | "any";
    /** Only match permanents that are currently attacking (CR 508). Used by
     *  combat-scoped choice pickers (Raging River's per-attacker labelling).
     *  Omitted = no constraint. */
    isAttacking?: boolean;
    /** Only match permanents that are currently blocking (CR 509). Mirror of
     *  `isAttacking`; used by combat pump effects scoped to blockers (Piety).
     *  Omitted = no constraint. */
    isBlocking?: boolean;
    /** Filter by tapped state (CR 110.5). `true` keeps only tapped permanents,
     *  `false` only untapped. Used by mid-resolution choice pickers scoped to
     *  tapped permanents (Magnetic Mountain — "tapped blue creatures").
     *  Omitted = no constraint. */
    tapped?: boolean;
    /** Token-provenance match (CR 111, 707.1). Keeps only tokens whose
     *  `createdBy` equals this instance id — "tokens created with this
     *  creature" (Tetravus). Omitted = no constraint. */
    createdBy?: string;
}

// --- SpellFilter (applied to SpellCastEvent) ---

/** Selector over a spell on the stack at cast time (CR 601.2i). Intentionally
 *  narrower than `PermanentFilter` — spells have no `isToken` and no granted
 *  static abilities to gate on. Used by `spellCastTrigger.filter`. */
export interface SpellFilter {
    types?: CardType | CardType[];
    subtypes?: string | string[];
    colors?: Color | Color[];
}

// --- DamageSourceFilter (applied to a damage source description) ---

/** Selector over a damage source at the moment damage is dealt (CR 120.3 /
 *  119.4). Designed against the projection produced by
 *  `describeDamageSource` in `convex/gre/replacements.ts` so the same shape
 *  works for permanent and stack-item sources. Used by triggers like
 *  "whenever a Red source deals damage to ~". */
export interface DamageSourceFilter {
    types?: CardType | CardType[];
    subtypes?: string | string[];
    colors?: Color | Color[];
    requireAbility?: string;
    controllerRelation?: "self" | "you" | "opponents" | "any";
}

// --- PlayerFilter ---

/** Selector over a player. Used by triggers that gate by who matches a
 *  scope predicate ("at the beginning of an opponent's upkeep, ...") or by
 *  life thresholds ("if a player has 10 or less life, ..."). */
export interface PlayerFilter {
    /** Relation to the source's controller / active player. "you" — same as
     *  source's controller; "opponent" — different from source's controller;
     *  "any" / undefined — no constraint; "active" — current active player;
     *  "non-active" — not the active player; "controller" — alias for "you"
     *  used by oracle phrasings that say "the controller of ~". */
    relation?:
        | "you"
        | "opponent"
        | "any"
        | "active"
        | "non-active"
        | "controller";
    /** Inclusive upper bound on life total. Matches only if
     *  `player.life <= lifeAtMost`. */
    lifeAtMost?: number;
    /** Inclusive lower bound on life total. Matches only if
     *  `player.life >= lifeAtLeast`. */
    lifeAtLeast?: number;
}

// --- Matchable entity shapes ---

/** Structurally-typed permanent view used by `matchesPermanentFilter`.
 *  `CardInstanceState` (engine), `PermanentView` (static effects), and
 *  hand-rolled test fixtures all satisfy this shape — keep the surface narrow
 *  so call sites don't need to hydrate fields the filter doesn't read.
 *  `colors` is optional: callers that use `PermanentFilter.colors` must
 *  populate it (derive via `getColorsFromCost` against the card def). */
export interface MatchablePermanent {
    id: string;
    types: ReadonlyArray<CardType | string>;
    subtypes: ReadonlyArray<string>;
    staticAbilities: ReadonlyArray<string>;
    controllerId?: string;
    isToken?: boolean;
    colors?: ReadonlyArray<Color>;
    power?: number;
    toughness?: number;
    isAttacking?: boolean;
    isBlocking?: boolean;
    isTapped?: boolean;
    /** Instance id of the permanent that created this token (CR 111). Read by
     *  `PermanentFilter.createdBy`. Undefined for non-tokens and tokens with no
     *  provenance link. */
    createdBy?: string;
}

/** Structurally-typed view of a `SpellCastEvent` for `matchesSpellFilter`. */
export interface MatchableSpell {
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
    colors: ReadonlyArray<Color>;
}

/** Structurally-typed description of a damage source for
 *  `matchesDamageSourceFilter`. Mirrors the `describeDamageSource` return
 *  shape plus the source's controller and subtypes. */
export interface MatchableDamageSource {
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
    colors: ReadonlyArray<Color>;
    staticAbilities: ReadonlyArray<string>;
    /** Controller of the damage source at the event time (CR 109.5). Used by
     *  `controllerRelation` checks. */
    controllerId?: string;
    /** Instance id of the source (battlefield permanent or stack item). Used
     *  by `controllerRelation: "self"` checks. */
    instanceId?: string;
}

/** Structurally-typed view of a player for `matchesPlayerFilter`. */
export interface MatchablePlayer {
    id: string;
    life: number;
}

// --- Matchers ---

function asArray<T>(value: T | ReadonlyArray<T> | undefined): readonly T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value as T];
}

/** Returns true if every constraint in `filter` is satisfied by `card`.
 *  Omitted fields don't constrain (AND semantics across fields, OR semantics
 *  within multi-value fields like `types` / `subtypes` / `colors`). Pure:
 *  reads only the supplied entity and context. */
export function matchesPermanentFilter(
    card: MatchablePermanent,
    filter: PermanentFilter,
    ctx?: FilterMatchContext
): boolean {
    if (filter.types !== undefined) {
        const types = asArray(filter.types);
        if (!types.some((t) => card.types.includes(t))) return false;
    }
    if (filter.excludeTypes !== undefined) {
        const excluded = asArray(filter.excludeTypes);
        if (excluded.some((t) => card.types.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subtypes = asArray(filter.subtypes);
        if (!subtypes.some((s) => card.subtypes.includes(s))) return false;
    }
    if (
        filter.requireAbility !== undefined &&
        !card.staticAbilities.includes(filter.requireAbility)
    ) {
        return false;
    }
    if (
        filter.excludeAbility !== undefined &&
        card.staticAbilities.includes(filter.excludeAbility)
    ) {
        return false;
    }
    if (filter.isToken !== undefined) {
        const cardIsToken = card.isToken === true;
        if (filter.isToken !== cardIsToken) return false;
    }
    if (filter.isAttacking !== undefined) {
        const cardIsAttacking = card.isAttacking === true;
        if (filter.isAttacking !== cardIsAttacking) return false;
    }
    if (filter.isBlocking !== undefined) {
        const cardIsBlocking = card.isBlocking === true;
        if (filter.isBlocking !== cardIsBlocking) return false;
    }
    if (filter.tapped !== undefined) {
        const cardIsTapped = card.isTapped === true;
        if (filter.tapped !== cardIsTapped) return false;
    }
    if (filter.createdBy !== undefined && card.createdBy !== filter.createdBy) {
        return false;
    }
    if (
        filter.excludeInstanceIds !== undefined &&
        filter.excludeInstanceIds.includes(card.id)
    ) {
        return false;
    }
    if (
        filter.instanceIds !== undefined &&
        !filter.instanceIds.includes(card.id)
    ) {
        return false;
    }
    if (filter.colors !== undefined) {
        const wanted = asArray(filter.colors);
        const have = card.colors ?? [];
        if (!wanted.some((c) => have.includes(c))) return false;
    }
    if (filter.powerAtLeast !== undefined) {
        if (card.power === undefined) return false;
        if (card.power < filter.powerAtLeast) return false;
    }
    if (filter.toughnessAtLeast !== undefined) {
        if (card.toughness === undefined) return false;
        if (card.toughness < filter.toughnessAtLeast) return false;
    }
    if (
        filter.controllerRelation !== undefined &&
        filter.controllerRelation !== "any"
    ) {
        if (!matchesControllerRelation(filter.controllerRelation, card, ctx)) {
            return false;
        }
    }
    return true;
}

function matchesControllerRelation(
    relation: "self" | "you" | "opponents",
    entity: { id?: string; instanceId?: string; controllerId?: string },
    ctx: FilterMatchContext | undefined
): boolean {
    if (relation === "self") {
        const target = ctx?.selfInstanceId;
        if (target === undefined) return false;
        const candidate = entity.id ?? entity.instanceId;
        return candidate === target;
    }
    const self = ctx?.selfControllerId;
    if (self === undefined || entity.controllerId === undefined) return false;
    if (relation === "you") return entity.controllerId === self;
    return entity.controllerId !== self;
}

/** Returns true if every constraint in `filter` matches `spell`. Pure. */
export function matchesSpellFilter(
    spell: MatchableSpell,
    filter: SpellFilter
): boolean {
    if (filter.types !== undefined) {
        const types = asArray(filter.types);
        if (!types.some((t) => spell.types.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subtypes = asArray(filter.subtypes);
        if (!subtypes.some((s) => spell.subtypes.includes(s))) return false;
    }
    if (filter.colors !== undefined) {
        const wanted = asArray(filter.colors);
        if (!wanted.some((c) => spell.colors.includes(c))) return false;
    }
    return true;
}

/** Returns true if every constraint in `filter` matches `source`. Pure. */
export function matchesDamageSourceFilter(
    source: MatchableDamageSource,
    filter: DamageSourceFilter,
    ctx?: FilterMatchContext
): boolean {
    if (filter.types !== undefined) {
        const types = asArray(filter.types);
        if (!types.some((t) => source.types.includes(t))) return false;
    }
    if (filter.subtypes !== undefined) {
        const subtypes = asArray(filter.subtypes);
        if (!subtypes.some((s) => source.subtypes.includes(s))) return false;
    }
    if (filter.colors !== undefined) {
        const wanted = asArray(filter.colors);
        if (!wanted.some((c) => source.colors.includes(c))) return false;
    }
    if (
        filter.requireAbility !== undefined &&
        !source.staticAbilities.includes(filter.requireAbility)
    ) {
        return false;
    }
    if (
        filter.controllerRelation !== undefined &&
        filter.controllerRelation !== "any"
    ) {
        if (
            !matchesControllerRelation(filter.controllerRelation, source, ctx)
        ) {
            return false;
        }
    }
    return true;
}

/** Returns true if every constraint in `filter` matches `player`. Pure. */
export function matchesPlayerFilter(
    player: MatchablePlayer,
    filter: PlayerFilter,
    ctx?: FilterMatchContext
): boolean {
    if (filter.relation !== undefined && filter.relation !== "any") {
        if (!matchesPlayerRelation(filter.relation, player, ctx)) return false;
    }
    if (filter.lifeAtMost !== undefined && player.life > filter.lifeAtMost) {
        return false;
    }
    if (filter.lifeAtLeast !== undefined && player.life < filter.lifeAtLeast) {
        return false;
    }
    return true;
}

function matchesPlayerRelation(
    relation: "you" | "opponent" | "active" | "non-active" | "controller",
    player: MatchablePlayer,
    ctx: FilterMatchContext | undefined
): boolean {
    if (relation === "you" || relation === "controller") {
        const self = ctx?.selfControllerId;
        if (self === undefined) return false;
        return player.id === self;
    }
    if (relation === "opponent") {
        const self = ctx?.selfControllerId;
        if (self === undefined) return false;
        return player.id !== self;
    }
    const active = ctx?.activePlayerId;
    if (active === undefined) return false;
    if (relation === "active") return player.id === active;
    return player.id !== active;
}
