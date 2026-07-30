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
    /** Resolves a permanent's LIVE supertypes (CR 205.4a) for `supertypes`
     *  filters. Injected by engine call sites (`snowFilterCtx`) so the matcher
     *  stays a leaf module with no registry/snow import. When a `supertypes`
     *  filter is present and the card carries no `supertypes` field, the
     *  matcher calls this; absent both, a `supertypes` filter matches nothing
     *  (fail-closed). */
    supertypesOf?: (card: MatchablePermanent) => ReadonlyArray<string>;
}

// --- PermanentFilter (CR 110.1) ---

/** Declarative selector over permanents on the battlefield. Used by mass
 *  primitives (`destroyAll`, `dealDamageToEach`), trigger factories
 *  (`enteredTrigger.filter`, etc.), and mid-resolution choice pickers. All
 *  fields are combined with AND; omitted fields don't constrain. */
export interface PermanentFilter {
    /** Match permanents by exact printed name (CR 201.2 — "cards named ~").
     *  Read against the live `MatchablePermanent.name`; a caller that doesn't
     *  populate `name` never matches a name filter (fail-closed). AND with
     *  every other field. */
    name?: string;
    types?: CardType | CardType[];
    /** Exclude permanents whose `types` include any of these (CR 205). The
     *  negative of `types`; used for "nonartifact creature" (The Abyss),
     *  "noncreature permanent", etc. Single value is shorthand for one type.
     *  AND with every other field. */
    excludeTypes?: CardType | CardType[];
    subtypes?: string | string[];
    /** Exclude permanents whose `subtypes` include any of these (CR 205.3/
     *  205.3i). The negative of `subtypes`; used for "non-Lair land" (the
     *  Planeshift Lair cycle's return-leg cost filter, CR 701.24 — a Lair
     *  cannot pay for its own or a sibling Lair's survival). Single value is
     *  shorthand for one subtype. AND with every other field. */
    excludeSubtypes?: string | string[];
    /** Match permanents that have ALL of these supertypes (CR 205.4a — e.g.
     *  "a snow land", "a snow Mountain"). Read against the LIVE supertype set
     *  on `MatchablePermanent.supertypes`, which engine call sites populate
     *  with `hasSnowSupertype` so `supertype-set` statics (Melting) and
     *  indefinite mutations (Arcum's Weathervane) are honored. AND with every
     *  other field. Single value is shorthand for one supertype. */
    supertypes?: string | string[];
    /** Exclude permanents that have ANY of these supertypes (CR 205.4a — the
     *  negative of `supertypes`). Used for "nonbasic land" (Wasteland,
     *  Price of Progress) — `excludeSupertypes: "Basic"`. Read against the same
     *  LIVE supertype set as `supertypes` (card's own supertypes, else the
     *  injected snow-aware `supertypesOf`). Single value is shorthand for one
     *  supertype. AND with every other field. */
    excludeSupertypes?: string | string[];
    /** Only match permanents whose `staticAbilities` contains this keyword. */
    requireAbility?: string;
    /** Skip permanents whose `staticAbilities` contains this keyword. */
    excludeAbility?: string;
    /** Filter by token-ness (CR 111.5 / 701.16 — "sacrifice a nontoken
     *  permanent"). `false` excludes token instances; `true` keeps only
     *  tokens. Omitted = no constraint. */
    isToken?: boolean;
    /** "Entered the battlefield this turn" (CR 400.7, issue #1458). `true`
     *  keeps only permanents that ENTERED the battlefield during the current
     *  turn (read off `MatchablePermanent.enteredThisTurn`, populated by
     *  engine call sites from the `enteredOnTurn` stamp `markEnteredThisTurn`
     *  writes, compared against `GameState.turn`); `false` keeps only
     *  permanents that were already on the battlefield when the turn began.
     *  Omitted = no constraint. AND with every other field, including
     *  `isToken` (Ocelot Pride's "a creature entered the battlefield under
     *  your control this turn"). Populated by `toPermanentFilter`
     *  (`convex/gre/effects/interpreter.ts`) for the `count`/`forEach`
     *  battlefield sites.
     *
     *  NOT summoning sickness: `isSummoningSick` stays true across the
     *  opponent's entire following turn (it clears only at its controller's
     *  untap step) and is re-set by a control change on a permanent that never
     *  changed zones — both would be false positives here. */
    enteredThisTurn?: boolean;
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
    /** OR ACROSS filter dimensions (issue #897) — a disjunctive clause list,
     *  mirroring `EffectCardFilter.any` (`convex/gre/effects/interpreter.ts`)
     *  for the on-battlefield filter shape (Magda, Brazen Outlaw's "an
     *  artifact or Dragon card": `types: "Artifact"` OR `subtypes: "Dragon"`,
     *  two DIFFERENT fields — distinct from the OR-WITHIN-a-field arrays
     *  `types`/`subtypes`/`colors` already support). Every other field on
     *  this interface is ANDed together; `any` is a non-empty array of full
     *  `PermanentFilter` clauses (each itself the existing AND-of-fields
     *  shape) — the permanent matches if it matches AT LEAST ONE clause in
     *  `any`, ANDed with every other top-level field present alongside `any`.
     *  Populated by `toPermanentFilter` (`convex/gre/effects/interpreter.ts`)
     *  when mapping an `EffectCardFilter` carrying `any` onto this shape, so
     *  battlefield `choice`/`count`/`forEach` sites (and the on-board pick
     *  validator in `pendingChoiceSubmit.ts`) honor the disjunction instead
     *  of silently dropping it. */
    any?: PermanentFilter[];
}

// --- SpellFilter (applied to SpellCastEvent) ---

/** Selector over a spell on the stack at cast time (CR 601.2i). Intentionally
 *  narrower than `PermanentFilter` — spells have no `isToken` and no granted
 *  static abilities to gate on. Used by `spellCastTrigger.filter`. */
export interface SpellFilter {
    types?: CardType | CardType[];
    /** Exclude spells whose `types` include any of these (CR 205). The
     *  negative of `types`; used for "noncreature spell" (Mystic Remora),
     *  "noncreature, nonartifact spell", etc. Single value is shorthand for
     *  one type. Mirrors `PermanentFilter.excludeTypes`. */
    excludeTypes?: CardType | CardType[];
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
    /** Live printed name (CR 201.2). Optional: callers that use
     *  `PermanentFilter.name` must populate it; absent → a name filter fails
     *  closed (matches nothing). */
    name?: string;
    types: ReadonlyArray<CardType | string>;
    subtypes: ReadonlyArray<string>;
    /** Live supertypes (CR 205.4a). Optional: callers that use
     *  `PermanentFilter.supertypes` must populate it from the live snow status
     *  (`hasSnowSupertype`) since the printed value alone misses Melting /
     *  Arcum's Weathervane mutations. */
    supertypes?: ReadonlyArray<string>;
    staticAbilities: ReadonlyArray<string>;
    controllerId?: string;
    isToken?: boolean;
    /** Entered-the-battlefield-this-turn flag (CR 400.7, issue #1458) — true
     *  iff the permanent entered the battlefield during the CURRENT turn
     *  (the engine's `enteredOnTurn` on `CardInstanceState`, stamped by
     *  `markEnteredThisTurn`, compared against `GameState.turn` — not
     *  `isSummoningSick`, which outlives the turn and survives a control
     *  change). Read by `PermanentFilter.enteredThisTurn`. Callers that use that
     *  filter must populate this field; a caller that doesn't leaves it
     *  undefined (fails closed, mirroring every other optional field here,
     *  e.g. `isToken`). */
    enteredThisTurn?: boolean;
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
    if (filter.name !== undefined && card.name !== filter.name) {
        return false;
    }
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
    if (filter.excludeSubtypes !== undefined) {
        const excluded = asArray(filter.excludeSubtypes);
        if (excluded.some((s) => card.subtypes.includes(s))) return false;
    }
    if (filter.supertypes !== undefined) {
        const supertypes = asArray(filter.supertypes);
        // CR 205.4a — "a snow land" requires ALL listed supertypes. Prefer the
        // card's own live supertypes; else resolve via the injected
        // `supertypesOf` (snow-aware). Absent both → fail closed.
        const have = card.supertypes ?? ctx?.supertypesOf?.(card) ?? [];
        if (!supertypes.every((s) => have.includes(s))) return false;
    }
    if (filter.excludeSupertypes !== undefined) {
        const excluded = asArray(filter.excludeSupertypes);
        // CR 205.4a — "nonbasic land" fails if the card has ANY listed
        // supertype. Same live-supertype resolution as `supertypes`.
        const have = card.supertypes ?? ctx?.supertypesOf?.(card) ?? [];
        if (excluded.some((s) => have.includes(s))) return false;
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
    // CR 400.7 (issue #1458) — "entered the battlefield this turn", read off
    // the real per-permanent entry stamp. Mirrors `isToken`'s exact
    // boolean-equality shape.
    if (filter.enteredThisTurn !== undefined) {
        const cardEnteredThisTurn = card.enteredThisTurn === true;
        if (filter.enteredThisTurn !== cardEnteredThisTurn) return false;
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
    // issue #897 — OR ACROSS filter dimensions. Every other field above is
    // ANDed; `any` is the one disjunctive clause list this filter supports.
    // Recurses through this same matcher (each clause is a full AND-of-fields
    // `PermanentFilter`), threading the same `ctx` so a clause's own
    // `controllerRelation` still resolves. A filter carrying ONLY `any` must
    // NOT fail open (match everything) — this check is what enforces that.
    if (
        filter.any !== undefined &&
        !filter.any.some((clause) => matchesPermanentFilter(card, clause, ctx))
    ) {
        return false;
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
    if (filter.excludeTypes !== undefined) {
        const excluded = asArray(filter.excludeTypes);
        if (excluded.some((t) => spell.types.includes(t))) return false;
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
