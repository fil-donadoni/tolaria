import type {
    Phase,
    ZonePickKind,
    ManaRestriction,
    PhaseReturnCondition,
    PhaseInRider,
} from "../gre/types";

type CardId = string;

/** Zones addressable by `SpellContext.moveZone`. Excludes `battlefield`
 *  (entering/leaving the battlefield needs ETB/LTB handling via destroy/exile)
 *  and `stack` (stack items are managed by the resolution engine). */
export type MovableZone = "library" | "hand" | "graveyard" | "exile";

export type Color = "W" | "U" | "B" | "R" | "G" | "C";

export const colors: Color[] = ["W", "U", "B", "R", "G", "C"];

/** A single text-changing substitution (CR 612, layer 3). Replaces every
 *  instance of the word `from` with `to` inside an object's structured text.
 *  `kind` classifies the word family so the right read-time parser surface is
 *  rewritten:
 *  - `"land-type"` — a basic land subtype (Magical Hack): rewrites land
 *    subtype → intrinsic mana and the landwalk keyword that references it.
 *  - `"color-word"` — a color word (Sleight of Mind): rewrites color words in
 *    ability text (protection from, color-targeted requirements, …).
 *  Carried on `CardInstanceState.textChanges`; applied by
 *  `gre/textChanges.ts::applySubstitution`. */
export type TextChange = {
    kind: "land-type" | "color-word";
    from: string;
    to: string;
};

export type ManaCost = {
    X?: number | string;
    W?: number;
    U?: number;
    B?: number;
    R?: number;
    G?: number;
    C?: number;
};

export type CardType =
    | "Creature"
    | "Planeswalker"
    | "Instant"
    | "Sorcery"
    | "Artifact"
    | "Enchantment"
    | "Land"
    | "Battle"
    | "Kindred";

/** Permanent types that can be dealt damage (CR 120.3) and the set of
 *  permanent types matched by a `"any target"` spell (CR 115.4). Lives here in
 *  the leaf `types` module (no runtime imports) so card sets can reference it
 *  without forming a registry import cycle (`cards/index → set → constants →
 *  cards/index`). Re-exported from `gre/constants` for back-compat. */
export const DAMAGEABLE_PERMANENT_TYPES = [
    "Creature",
    "Planeswalker",
    "Battle",
] as const satisfies readonly CardType[];

export type CardSupertype =
    | "Basic"
    | "Legendary"
    | "Ongoing"
    | "Snow"
    | "World";

// --- Targeting ---

export interface TargetRequirement {
    /** Card type(s) to target, "player", "any", "spell" (stack target),
     *  "spell-or-permanent" (any spell on stack OR any permanent on battlefield,
     *  CR 114 — used by lace instants), or "card" (any card type — only
     *  meaningful when `zone` selects a non-battlefield zone such as
     *  "graveyard"). */
    type:
        | CardType
        | "player"
        | "any"
        | "spell"
        | "spell-or-permanent"
        | "card"
        | (
              | CardType
              | "player"
              | "any"
              | "spell"
              | "spell-or-permanent"
              | "card"
          )[];
    /** Fixed N, or a range for spells that take a variable number of targets
     *  (CR 601.2c). `max` is open-ended when undefined — capped by legal
     *  target availability. Example: Fireball → { min: 1 }.
     *
     *  Special string `"X"` means "exactly the chosen value of X" (CR 107.3 /
     *  601.2c, e.g. Volcanic Eruption "Destroy X target Mountains"). The count
     *  is resolved against `chosenX` at cast announcement — pendingTarget
     *  stores the resulting fixed N. When chosenX is 0, the spell skips
     *  target selection entirely. */
    count: number | "X" | { min: number; max?: number };
    /** If set, restricts legal targets to permanents and stack spells of the
     *  given color (CR 202.2). Used by Circle of Protection's "source of your
     *  choice of color W/U/B/R/G" choice. */
    colorFilter?: Color;
    /** Restricts legal permanent targets to those whose `subtypes` include at
     *  least one of these (CR 205.3). Single string is a shorthand for one
     *  subtype. Used by spells like Volcanic Eruption ("X target Mountains")
     *  or Stone Rain ("target land" with no extra subtype constraint — that
     *  case omits this field). Ignored for player / spell / graveyard targets. */
    subtypeFilter?: string | string[];
    /** Restricts legal permanent targets by tap state (CR 701.20). Used by
     *  "target tapped creature" (Royal Assassin) and "target untapped
     *  creature" style filters. Ignored for player / spell targets. */
    tappedFilter?: "tapped" | "untapped";
    /** Restricts legal permanent targets by effective power (CR 613 layer 7c).
     *  Both bounds are inclusive. Used by "target creature with power 2 or
     *  less" (Dwarven Warriors) and the modern "target creature with power 4
     *  or greater" pattern. Ignored for player / spell targets. */
    powerFilter?: { min?: number; max?: number };
    /** Restricts legal targets by mana value (CR 202.3). Inclusive bounds;
     *  string `"X"` resolves to the chosen value of X at announcement
     *  (CR 107.3) — used by Spell Blast ("counter target spell with mana
     *  value X"). Honored for permanent and spell targets. */
    mvFilter?: {
        min?: number | "X";
        max?: number | "X";
        equals?: number | "X";
    };
    /** Zone the target lives in (CR 109.2 — objects can exist in zones other
     *  than the battlefield). Default "battlefield". When set to "graveyard",
     *  legal targets are cards in graveyards filtered by `controller` and
     *  `type` (CardType filter, or "card" for any). Used by reanimation /
     *  graveyard-recursion spells (CR 400.7) like Regrowth. */
    zone?: "battlefield" | "graveyard";
    /** Restricts legal targets by relationship to the chooser ("you" =
     *  caster controls; "opponent" = opponent controls; "any" = either).
     *  Default "any". Honored for graveyard targets (Regrowth) and for
     *  battlefield-permanent targets (Simulacrum: "target creature you
     *  control"). Ignored for player / spell targets. */
    controller?: "you" | "opponent" | "any";
    /** Restricts legal permanent targets by live combat role (CR 508.1,
     *  509.1). "attacking" requires `isAttacking === true`; "blocking"
     *  requires `isBlocking === true`. Used by Righteousness ("target
     *  blocking creature"). Ignored for player / spell / graveyard targets. */
    combatRoleFilter?: "attacking" | "blocking";
    /** Excludes permanents whose `types` include any of these (CR 205).
     *  Used by Terror ("target nonartifact, nonblack creature"). Single
     *  string is shorthand for one type. */
    excludeTypes?: CardType | CardType[];
    /** Excludes permanents whose mana-cost-derived colors include any of
     *  these (CR 202.2). Used by Terror ("target nonblack creature"). Single
     *  value is shorthand for one color. */
    excludeColors?: Color | Color[];
    /** Excludes permanents whose subtypes include any of these (CR 205.3).
     *  Used by Nettling Imp ("target non-Wall creature"). Single string is
     *  shorthand for one subtype. */
    excludeSubtypes?: string | string[];
    /** Restricts legal permanent targets to those whose `staticAbilities`
     *  include this keyword (CR 702). Used by Island of Wak-Wak ("target
     *  creature with flying"). Ignored for player / spell targets. */
    requireAbility?: string;
    /** Excludes specific permanent instance ids. Used for "target creature
     *  other than ~" via a dynamic `getTargetRequirement` that injects the
     *  source's own id (Sorceress Queen). */
    excludeInstanceIds?: ReadonlyArray<string>;
    /** Restricts legal permanent targets by effective toughness (CR 613
     *  layer 7c). Both bounds inclusive. Used by Stone Giant ("target
     *  creature you control with toughness less than Stone Giant's power").
     *  Ignored for player / spell targets. */
    toughnessFilter?: { min?: number; max?: number };
    /** Restricts legal SPELL targets (`type: "spell"`) by the spell's card
     *  type (CR 114.1). Only stack items that are actual spells (not
     *  activated/triggered abilities) and whose `types` include at least one
     *  of these are legal. Used by Fork ("target instant or sorcery spell")
     *  and other type-restricted spell-targeting effects. Single string is
     *  shorthand for one type. Ignored for non-spell target types. */
    spellTypeFilter?: CardType | CardType[];
}

/** "For as long as" condition on a conditional control change (CR 611.2b).
 *  Re-evaluated by the conditional-control SBA; when it stops holding the
 *  control change is reverted. The source of the change is the resolving
 *  ability's permanent (the `controlChanges` entry's source id). Serializable
 *  (no closures) so replays reproduce deterministically.
 *
 *  - `controller-controls-source`: holds while `controllerId` still controls
 *    the source permanent (Aladdin — "for as long as you control this").
 *  - `source-tapped-and-power-ge`: holds while the source is tapped and its
 *    effective power is >= the controlled permanent's effective power
 *    (Old Man of the Sea). */
export type ControlChangeCondition =
    | { kind: "controller-controls-source"; controllerId: string }
    | { kind: "source-tapped-and-power-ge" };

export interface TargetSelection {
    /** "permanent" = battlefield card, "player" = player, "spell" = stack
     *  item, "graveyard-card" = card in a player's graveyard (CR 400.7). */
    type: "permanent" | "player" | "spell" | "graveyard-card";
    id: string; // cardInstanceId, playerId, or stackItem.id
    /** Owner of the zone the target lives in. Required for non-battlefield
     *  zone targets ("graveyard-card") since the same instance id is unique
     *  per zone but the zone owner is what disambiguates which graveyard the
     *  card sits in. Unused for permanent / player / spell targets. */
    playerId?: string;
}

export interface ActivatedAbilityContext {
    addMana: (cost: ManaCost) => void;
}

/** One mode of a modal spell (CR 700.2 — "Choose one — • ..."). The caster
 *  picks exactly one mode at announcement; the chosen mode supplies the
 *  spell's target requirement (if any) and the resolution body. Mode
 *  selection is locked at announce (CR 700.2c) and propagated through
 *  pendingCast / pendingTarget / stack item via `chosenModeId`. */
export interface SpellMode {
    /** Stable id within the card definition (e.g. "gain-life", "prevent").
     *  Used by the UI to identify the chosen option and by the engine to
     *  dispatch resolution. Must be unique within `modes`. */
    id: string;
    /** Short label shown in the mode picker UI (e.g. "Gain 3 life"). */
    label: string;
    /** Full oracle text for this mode (the bullet line — used by the stack
     *  item display and rule-trace logs). */
    oracleText: string;
    /** Per-mode target requirement (CR 601.2c, only the chosen mode's
     *  targets need legal candidates per CR 700.2d). Undefined for modes
     *  with no targets. */
    targetRequirement?: TargetRequirement;
    /** Resolution body. Receives the full SpellContext; targets come from
     *  the announcement-time selection driven by `targetRequirement`. Omit
     *  for modes whose only effect is continuous (via `staticEffects`). */
    resolve?: (ctx: SpellContext) => void;
    /** Static effects that apply when this mode is chosen. For modal auras
     *  (e.g. Phantasmal Terrain — "choose a basic land type"), the engine
     *  reads the chosen mode's static effects instead of the card-level ones.
     *  Supports subtype-set, keyword-grant, etc. */
    staticEffects?: StaticEffect[];
}

export interface ActivatedAbility {
    id: string;
    cost: {
        tap?: boolean;
        mana?: ManaCost;
        sacrifice?: boolean;
        /** "Sacrifice a permanent matching <filter>" as an activation cost
         *  (CR 602.1, 118.5). The activating player chooses which matching
         *  permanent to sacrifice while paying the cost; the activation is
         *  illegal if no permanent on their battlefield matches the filter.
         *  Distinct from `sacrifice` (which sacrifices THIS source). The
         *  chosen permanent's pre-sacrifice mana value is snapshotted onto the
         *  stack item so `SpellContext.getAdditionalSacrificeMv()` can read it
         *  at resolve (Priest of Yawgmoth — "add {B} equal to the sacrificed
         *  artifact's mana value"). Used by the Antiquities sacrifice-for-value
         *  engines (Atog, Ashnod's Altar, Orcish Mechanics, Sage of Lat-Nam,
         *  Priest of Yawgmoth, Dwarven Weaponsmith, Gate to Phyrexia). */
        sacrificeFilter?: PermanentFilter;
        /** Life payment (CR 118.4). Legal while `player.life >= life`; SBA
         *  handles the loss if payment takes life to 0 or below. */
        life?: number;
        /** Counter-removal payment (CR 122.6). The ability is only legal to
         *  activate while the source has at least `count` counters of `type`;
         *  the counters are removed at activation commit. Used by Scavenging
         *  Ghoul ("Remove a corpse counter from this creature: Regenerate ~"). */
        removeCounter?: { type: string; count: number };
        /** "Discard the last card you drew this turn" cost (CR 118.3 — an
         *  additional cost paid from a fixed card, not a chosen one). The
         *  ability is only legal to activate while the activating player has a
         *  card recorded in `lastDrawnCardId` that is still in their hand; that
         *  exact card is discarded at activation commit. Used by Jandor's
         *  Ring. */
        discardLastDrawn?: boolean;
        /** "Discard N cards at random" cost (CR 118.3 / 701.8 — an additional
         *  cost paid by discarding randomly-chosen cards). The ability is only
         *  legal to activate while the activating player has at least one card
         *  in hand; `count` cards (clamped to hand size) are discarded at
         *  random, using the game's seeded PRNG, at activation commit. Used by
         *  Coral Helm ("Discard a card at random: target creature gets +2/+2"). */
        discardAtRandom?: number;
    };
    /** Oracle text for this ability (displayed in context menus and on the stack). */
    oracleText: string;
    /** Target requirements declared at activation time (CR 602.2b). Chosen
     *  when the ability is activated, validated again on resolution. */
    targetRequirement?: TargetRequirement;
    /** Effect for mana abilities (useStack: false). */
    effect?: (ctx: ActivatedAbilityContext) => void;
    /** Mana abilities don't use the stack — they resolve immediately (CR 605.3a). */
    useStack: boolean;
    /** Effect for stack abilities (useStack: true) — called with full SpellContext on resolution. */
    resolve?: (ctx: SpellContext) => void;
    /** Fixed mana output — used by the engine to track pool changes without executing the effect. */
    manaProduced?: ManaCost;
    /** Board-conditional mana output (CR 106.1, 605.1a). When present, the
     *  engine computes the actual mana this single-color fixed ability produces
     *  from the controller's battlefield at activation time, instead of reading
     *  the static `manaProduced`. `manaProduced` remains the representative /
     *  fallback output (used by Mana Flare and by best-effort callers without a
     *  battlefield snapshot). Receives the source permanent and the controller's
     *  battlefield view. Used by the Urza land trio (Mine / Power Plant / Tower),
     *  whose colorless output grows when the controller also controls the other
     *  two named lands. Must produce the same single color as `manaProduced`. */
    manaAmount?: (
        source: PermanentView,
        controllerBattlefield: ReadonlyArray<PermanentView>
    ) => ManaCost;
    /** Spend restriction carried by the mana this ability produces (CR 106.6).
     *  When set, the produced mana lands in the controller's `restrictedMana`
     *  pool instead of the fungible pool and may pay only for spells the
     *  restriction permits (Mishra's Workshop — "Spend this mana only to cast
     *  artifact spells"). Only meaningful on fixed `manaProduced` abilities. */
    manaRestriction?: ManaRestriction;
    /** Multiple mana options the player can choose from (e.g. Talisman: "{T}: Add {U} or {B}"). */
    manaChoices?: ManaCost[];
    /** Restricts activation timing to a specific subset of phases (CR 602.5).
     *  When set, the ability is activatable only while `state.phase` is in
     *  this list. Used by Jade Statue ("activate only during combat"). */
    activationPhaseRestriction?: Phase[];
    /** Custom precondition checked at activation time, after the standard
     *  cost validation (CR 602.5b — activation restrictions). Reads the
     *  current source state and any other game state needed; returning
     *  false rejects the activation with a generic error. Used by
     *  Clockwork Beast ("Activate only if it has fewer than seven +1/+0
     *  counters on it"). The signature accepts a structurally-typed state
     *  view to keep card defs decoupled from the engine state shape. */
    canActivate?: (source: PermanentView, state: TriggerStateView) => boolean;
    /** Restrict activation to the controller's own turn (CR 602.5b — "activate
     *  only during your turn"). Distinct from `activationPhaseRestriction`
     *  which is phase-keyed and turn-independent. Used by Instill Energy's
     *  "{0}: Untap enchanted creature. Activate only during your turn." */
    controllerTurnOnly?: boolean;
    /** Dynamic target requirement computed at activation time from the source
     *  permanent's state. If set, overrides `targetRequirement`. Used by
     *  abilities whose target legality depends on the source (Stone Giant:
     *  "target creature you control with toughness less than Stone Giant's
     *  power"). */
    getTargetRequirement?: (
        source: PermanentView,
        state: TriggerStateView
    ) => TargetRequirement;
    /** Cap activations per turn per source instance (CR 602.5 — "activate
     *  this ability only once each turn"). Engine tracks counts in
     *  `CardInstanceState.activationsThisTurn[abilityId]` and resets at
     *  turn start. Used by Instill Energy. */
    oncePerTurn?: boolean;
    /** "Any player may activate this ability" (CR 113.3c / 602.1). By default
     *  only the source's controller may activate an activated ability; when
     *  this is set, any player with priority may activate it — they pay the
     *  costs from their own resources (mana pool / life), but the source's
     *  controller is unchanged and the ability still resolves as a normal
     *  activated ability on the stack. Used by Ifh-Bíff Efreet. */
    activatableByAnyPlayer?: boolean;
}

// --- Temporary-effect durations (CR 611.2, 514.2, 511.3) ---

/** Card-facing lifetime specification for a temporary effect. Encodes the
 *  phase boundary at which the effect expires plus optional qualifiers for
 *  "until end of your next turn"-style phrasings. The SpellContext primitive
 *  resolves the symbolic `player` field to a concrete playerId before the
 *  effect is stored — see `Duration` in gre/state.ts for the stored shape.
 *
 *  Examples:
 *    { phase: "end-of-turn" }                          // "until end of turn"
 *    { phase: "end-of-combat" }                        // "until end of combat"
 *    { phase: "end-of-turn", skip: 1, player: "controller" }  // "until end of your next turn"
 */
export interface DurationSpec {
    /** Which phase boundary triggers expiry. end-of-turn = CLEANUP (CR 514.2);
     *  end-of-combat = END_OF_COMBAT step (CR 511.3); upkeep = the UPKEEP step
     *  (CR 500.2 — "until your next upkeep" effects end as the upkeep begins,
     *  combined with `player: "controller"` to scope to the controller's
     *  upkeep, e.g. Xenic Poltergeist). */
    phase: "end-of-turn" | "end-of-combat" | "upkeep";
    /** Number of matching boundaries to skip before the effect expires. 0 =
     *  next occurrence (default, "this turn/combat"). 1 = one after. */
    skip?: number;
    /** Filter the boundary to the effect's controller ("controller") or
     *  their opponent ("opponent"). Undefined = any active player's boundary
     *  (default). Resolved to a concrete playerId at creation time. */
    player?: "controller" | "opponent";
}

/** Specification passed to `SpellContext.animateAsCreature` — the target
 *  becomes a creature with the given base P/T and optional subtype, for the
 *  duration provided (CR 208.2, 611.1). The engine restores the permanent's
 *  original P/T, types, and subtypes on expiry. */
export interface AnimateSpec {
    power: number;
    toughness: number;
    /** Optional creature subtype to add while animated (e.g. "Golem"). */
    subtype?: string;
    duration: DurationSpec;
}

// --- Permanent filter (shared by sweeper primitives) ---
//
// Defined in `./filters.ts` (single source of truth, ADR 0002). Re-exported
// here for back-compat with existing imports from `convex/cards/types`.

import type { PermanentFilter } from "./filters";
export type { PermanentFilter } from "./filters";

// --- Token specification (CR 111, 707.1) ---

/** Structural definition of a token permanent created at resolution time
 *  (CR 707.1 — a token is created in the form described by the effect that
 *  creates it). All fields are static for the token's lifetime; tokens
 *  themselves carry no card-registry id, so this spec is the authoritative
 *  source for name / types / P/T / abilities / colors. */
export interface TokenSpec {
    /** Display name (CR 707.2). */
    name: string;
    /** Card types the token is created as (CR 707.2). */
    types: CardType[];
    /** Optional creature subtypes (CR 205.3). */
    subtypes?: string[];
    /** Optional supertypes (Legendary, Snow). */
    supertypes?: CardSupertype[];
    /** Power for creature tokens (CR 208.2). */
    power?: number;
    /** Toughness for creature tokens. */
    toughness?: number;
    /** Colors of the token (CR 110.5 — colorless if omitted, else the listed
     *  set). Encoded as a synthetic mana cost so `hasColor` and projection
     *  read tokens identically to printed permanents. */
    colors?: Color[];
    /** Static abilities the token enters with (e.g. `["flying"]`). */
    staticAbilities?: string[];
    /** Continuous static effects the token enters with (CR 611). Registered
     *  onto the synthesized token CardDefinition so battlefield-wide readers
     *  that key off the card def — e.g. `isGuardedAgainst` for a
     *  `permanent-guard` — observe them. Used by Tetravite tokens ("This token
     *  can't be enchanted", a self-targeting `cantBeEnchanted` guard). Folded
     *  into the token's content-derived definition id so a token WITH a static
     *  effect gets a distinct def from one without. */
    staticEffects?: StaticEffect[];
    /** Optional Scryfall id of a printed token card. Used by the image layer
     *  to fetch real token art (e.g. The Hive's Wasp print from 10E:
     *  `09921372-126f-4c81-b6d8-ea50b1d0eb44`). When omitted, the renderer
     *  falls back to an in-app placeholder showing the name / abilities / P/T. */
    imagePrintId?: string;
}

// --- Copy effects (CR 706, 707) ---

/** Options for a copy effect applied via `SpellContext.becomeCopyOf`. */
export interface CopyEffectOptions {
    /** When false, the copy keeps its own color rather than the copied
     *  object's (Vesuvan Doppelganger, CR 707.9d). Defaults to true. */
    copyColor?: boolean;
    /** Colors to retain when `copyColor` is false (the recipient's own). */
    ownColors?: Color[];
    /** Types added on top of the copied object's types (Copy Artifact —
     *  "except it's an enchantment in addition to its other types"). */
    additionalTypes?: CardType[];
}

// --- Spell resolution context ---

export interface SpellContext {
    /** The player who cast the spell / activated the ability. */
    caster: string;
    /** The controller of the spell/ability on the stack. */
    controller: string;
    /** The instance id of the stack item resolving. For activated abilities,
     *  this equals the id of the source permanent on the battlefield — use
     *  it to target self (e.g. Jade Statue's animate-self ability). */
    sourceInstanceId: string;
    /** Chosen targets (validated at cast time). */
    targets: TargetSelection[];
    /** Ids of all players in the game. Used by "each player ~" spells like
     *  Timetwister and Wheel of Fortune. Order currently follows
     *  `state.players`; APNAP ordering (CR 101.4) for simultaneous triggers
     *  is out of initial scope. */
    allPlayerIds: readonly string[];
    /** Iterates `fn` over every player id in `allPlayerIds` order. Sugar for
     *  the canonical `for (const pid of ctx.allPlayerIds)` pattern. Use this
     *  for "each player ~" spells (Timetwister, Wheel of Fortune). */
    forEachPlayer: (fn: (playerId: string) => void) => void;
    /** Returns the `attachedTo` id of the trigger's source permanent (aura).
     *  Undefined if the source is not on the battlefield or has no host. */
    getAttachedToId: () => string | undefined;
    /** Records a player chosen as this permanent enters and stores it on the
     *  source instance for the rest of the game (CR 603.6b / 614.12 — "as ~
     *  enters the battlefield, choose an opponent"). Read back with
     *  `getChosenPlayer`. The source is the resolving permanent (an ETB
     *  trigger's source). No-op if the source has left the battlefield. Used
     *  by Cursed Rack (chosen opponent's max hand size is four) and The Rack
     *  (damage at the chosen player's upkeep). */
    setChosenPlayer: (playerId: string) => void;
    /** Reads the player chosen as the source permanent entered (set by
     *  `setChosenPlayer`). Undefined if no choice was stored or the source has
     *  left the battlefield. */
    getChosenPlayer: () => string | undefined;
    /** True if the given permanent currently has a keyword removal record
     *  for `keyword` (set by a keyword-remove static effect). */
    hasRemovedKeyword: (permanentId: string, keyword: string) => boolean;
    /** Applies a copy effect (CR 707.2) to the permanent currently resolving
     *  — the spell entering the battlefield (Clone ETB choice) or the trigger
     *  source (Vesuvan upkeep re-copy). The recipient becomes a copy of the
     *  permanent identified by `sourceCreatureId`. No-op if the copy target
     *  has left the battlefield. */
    becomeCopyOf: (sourceCreatureId: string, opts?: CopyEffectOptions) => void;
    // --- Primitives ---
    dealDamage: (target: TargetSelection, amount: number) => void;
    gainLife: (playerId: string, amount: number) => void;
    loseLife: (playerId: string, amount: number) => void;
    getLife: (playerId: string) => number;
    getPower: (target: TargetSelection) => number;
    getToughness: (target: TargetSelection) => number;
    modifyPower: (target: TargetSelection, amount: number) => void;
    modifyToughness: (target: TargetSelection, amount: number) => void;
    /** Adds a temporary P/T modification to `target` that expires at the
     *  end of `duration` (CR 611.1, 611.2). The modification stacks with any
     *  static `pt-buff` / `pt-cda` and other temporary mods on the same
     *  permanent — all are summed at read time. The phase-boundary cleanup
     *  (END_OF_COMBAT for "until end of combat", CLEANUP for "until end of
     *  turn", CR 514.2 / 511.3) splices expired entries off the permanent.
     *  No-op if the target has left the battlefield. Used by pump activations
     *  ("{R}: ~ gets +1/+0 until end of turn") and one-shot pump spells
     *  ("Howl from Beyond"). */
    addTemporaryPTBuff: (
        target: TargetSelection,
        power: number,
        toughness: number,
        duration: DurationSpec
    ) => void;
    /** Adds a conditional P/T modification to `target` held "for as long as
     *  [the source] remains tapped" (CR 611.2 — a duration tied to a
     *  continuously re-evaluated game state, not a phase boundary). The source
     *  is the resolving ability's permanent (`sourceInstanceId`); the buff
     *  contributes additively at layer 7d while the source is on the
     *  battlefield AND tapped, and the `checkSourceTappedEffects` SBA splices
     *  it out the instant the source untaps or leaves. Stacks with static and
     *  one-shot temporary mods. No-op if the target has left the battlefield.
     *  Used by Ashnod's Battle Gear (+2/-2) and Tawnos's Weaponry (+1/+1). */
    addSourceTappedPTBuff: (
        target: TargetSelection,
        power: number,
        toughness: number
    ) => void;
    /** Locks `target` so it doesn't untap during its controller's untap step
     *  "for as long as [the source] remains tapped" (CR 611.2 untap-prevention
     *  with a state-tied duration). The source is the resolving ability's
     *  permanent (`sourceInstanceId`); the lock is read by the untap step and
     *  cleared by `checkSourceTappedEffects` once the source untaps or leaves.
     *  No-op if the target has left the battlefield. Used by Phyrexian Gremlins
     *  ("Tap target artifact. It doesn't untap ... for as long as this remains
     *  tapped"). */
    lockUntapWhileSourceTapped: (target: TargetSelection) => void;
    /** Sets the target's base power and/or toughness to a fixed value until
     *  `duration` expires (CR 613.4b layer 7b, ADR 0017). Pass `undefined` for
     *  a characteristic to leave it untouched ("base power 0" sets power only).
     *  Counters (7c) and +N/+N modifiers (7d) still apply on top of the set
     *  value. The latest set per characteristic wins. No-op if the target has
     *  left the battlefield. Used by Singing Tree, Island of Wak-Wak, and
     *  Sorceress Queen. */
    setBasePT: (
        target: TargetSelection,
        power: number | undefined,
        toughness: number | undefined,
        duration: DurationSpec
    ) => void;
    /** Puts `count` counters of type `type` on `target` (CR 122.1). No-op if
     *  the target has left the battlefield. Counter type is a free-form string
     *  ("+1/+1", "+1/+0", "corpse", "charge", ...). P/T-modifying types are
     *  recognized at stat-read time by layer 7d. */
    addCounter: (target: TargetSelection, type: string, count: number) => void;
    /** Removes up to `count` counters of `type` from `target`. Returns the
     *  number actually removed (clamped to the current count). No-op if the
     *  target has left the battlefield or has no counters of that type. */
    removeCounter: (
        target: TargetSelection,
        type: string,
        count: number
    ) => number;
    /** Reads the count of a given counter type on `target` (CR 122.6). Returns
     *  0 if the target has no counters of that type or has left play. */
    getCounterCount: (target: TargetSelection, type: string) => number;
    /** Number of creatures that have died this turn (CR 603 — running tally
     *  scoped per turn, reset at turn start). Read by triggers like
     *  Scavenging Ghoul's end-step "for each creature that died this turn". */
    getDeathsThisTurn: () => number;
    getController: (target: TargetSelection) => string;
    /** Whether the target permanent is tapped (CR 701.20a). Returns false for
     *  players and for permanents no longer on the battlefield. Used by
     *  intervening-if checks like Howling Mine's "if ~ is untapped". */
    getIsTapped: (target: TargetSelection) => boolean;
    /** Destroys a permanent (CR 701.7). Routes through the regeneration /
     *  indestructible replacement layer. Returns true if the permanent was
     *  actually moved to the graveyard, false if a regen shield or
     *  indestructible saved it or if the target had already left the
     *  battlefield. Used by spells like Volcanic Eruption that must count
     *  "permanents put into a graveyard this way" (CR 614.5, 701.15a).
     *
     *  Pass `cantBeRegenerated: true` (Terror, Disintegrate) to suppress the
     *  regen shield replacement (CR 701.15c) — indestructible still
     *  protects. */
    destroy: (
        target: TargetSelection,
        opts?: { cantBeRegenerated?: boolean }
    ) => boolean;
    exile: (target: TargetSelection) => void;
    /** Replaces a target permanent's subtypes (CR 305.7). One-shot mutation,
     *  not a continuous effect — used by Cyclopean Tomb's LTB trigger. */
    setSubtypes: (target: TargetSelection, subtypes: string[]) => void;
    /** Returns a target permanent to its owner's hand (CR 701.10). The card
     *  becomes a new object on the zone change (CR 400.7) — battlefield-only
     *  transient state (tapped, marked damage, regen shields, summoning
     *  sickness, attached/granted-by-aura state) is cleared. No-op if the
     *  target has left the battlefield (CR 608.2b). */
    returnToHand: (target: TargetSelection) => void;
    /** Reanimation primitive: moves a card from `playerId`'s graveyard or
     *  exile onto `playerId`'s battlefield (CR 400.7 zone change). Used by
     *  Resurrection ("return target creature card from your graveyard to the
     *  battlefield") and Animate Dead. Returns true if the card was located
     *  and moved, false if the id was not in `fromZone` (silent fizzle per
     *  CR 608.2b). The card becomes a new object on the zone change — battle-
     *  field transient state (tap, damage, granted abilities) is cleared,
     *  summoning sickness is set for creatures (CR 302.1), and existing
     *  battlefield lord-grants reach the new permanent via
     *  `applyExistingGrantsTo`. The card's own `staticEffects` are pushed out
     *  to matching battlefield permanents via `applySourceStaticEffects`. */
    returnToBattlefield: (
        playerId: string,
        cardInstanceId: string,
        fromZone: "graveyard" | "exile"
    ) => boolean;
    /** Taps a permanent on the battlefield (CR 701.20a). No-op if already
     *  tapped or if the target is no longer on the battlefield (CR 608.2b).
     *  Used by Icy Manipulator and similar "tap target permanent" effects. */
    tap: (target: TargetSelection) => void;
    /** Untaps a permanent on the battlefield (CR 701.20b). No-op if already
     *  untapped or if the target is no longer on the battlefield (CR 608.2b).
     *  Used by Twiddle's untap mode and similar "untap target permanent"
     *  effects. */
    untap: (target: TargetSelection) => void;
    /** Changes control of a target permanent to `newControllerId` (CR 613.1b,
     *  layer 2). Routes through the shared control-change machinery: the host
     *  moves into the new controller's battlefield array, summoning sickness is
     *  set (CR 702.10c), and a `controlChanges` entry keyed by the resolving
     *  source (`ctx.sourceInstanceId`) records the prior controller for revert.
     *  Pass `condition` for a "for as long as" control change (Aladdin, Old Man
     *  of the Sea) that the conditional-control SBA reverts when it lapses;
     *  omit it for an indefinite reassignment (Ghazbán Ogre). No-op if the
     *  target has left the battlefield or is already under `newControllerId`. */
    gainControl: (
        target: TargetSelection,
        newControllerId: string,
        condition?: ControlChangeCondition
    ) => void;
    /** Destroys every permanent on the battlefield matching the filter
     *  (CR 701.7). Shorthand `CardType | CardType[]` is equivalent to
     *  `{ types }`. The object form supports compounding types, subtypes, and
     *  keyword requirements — e.g. `{ types: "Creature", excludeAbility: "flying" }`
     *  for "destroy all non-flying creatures". Undefined filter destroys every
     *  permanent.
     *
     *  Pass `opts.cantBeRegenerated: true` (Wrath of God, Damnation) to
     *  suppress the regen shield replacement (CR 701.15c) — indestructible
     *  still protects. */
    destroyAll: (
        filter?: CardType | CardType[] | PermanentFilter,
        opts?: { cantBeRegenerated?: boolean }
    ) => void;
    /** Player draws N cards one at a time (CR 121.1). Stops if library empties; sets hasDrawnFromEmpty (CR 704.5b). */
    drawCards: (playerId: string, amount: number) => void;
    /** CR 614 — arms a one-shot replacement for the NEXT card `playerId` would
     *  draw this turn (Aladdin's Lamp): look at the top X, keep one to draw,
     *  bottom the rest in a random order. The draw step consumes it and
     *  suspends on a `draw-look-keep` choice. No-op for `x ≤ 0` ("X can't be
     *  0"). Turn-scoped — cleared at the start of the next turn. */
    armNextDraw: (playerId: string, x: number) => void;
    /** Moves every card a player owns in `from` to `to` (CR 400.7). Cards are
     *  appended to the destination in source order. Library order after a
     *  move is not meaningful — pair with `shuffleLibrary` when the effect
     *  requires randomization (e.g. Timetwister, Diminishing Returns). */
    moveZone: (playerId: string, from: MovableZone, to: MovableZone) => void;
    /** Moves a single card a player owns from `from` to `to` by instance id
     *  (CR 400.7). No-op if the card isn't in `from`. Paired with
     *  `requestChoice({ zone: "library" })` for tutor-style effects
     *  (Demonic Tutor) so the player's pick can be routed to hand. */
    moveCardById: (
        playerId: string,
        cardInstanceId: string,
        from: MovableZone,
        to: MovableZone
    ) => void;
    /** CR 702.26 — phase `permanentId` out of existence along with every Aura
     *  and Equipment attached to it. Silent: no enters/leaves events, no
     *  triggers, no zone change. Counters and attachment links are preserved.
     *  `returnOn` records when the bundle phases back in (Oubliette:
     *  `source-leaves`). `onPhaseIn.tap` taps the host when it returns.
     *  Returns the bundle id, or null if the permanent isn't on the
     *  battlefield. */
    phaseOut: (
        permanentId: string,
        opts: { returnOn: PhaseReturnCondition; onPhaseIn?: PhaseInRider }
    ) => string | null;
    /** CR 702.26 — phase a bundle (from `phaseOut`) back in. Silent. Returns
     *  false if the bundle id is unknown. */
    phaseIn: (bundleId: string) => boolean;
    /** Randomizes the order of a player's library using the seeded PRNG
     *  (CR 701.20). Deterministic under replay. */
    shuffleLibrary: (playerId: string) => void;
    /** Counters a spell or ability on the stack (CR 701.5a). Target must be TargetSelection with type "spell". No-op if target no longer on stack (CR 608.2b). */
    counter: (target: TargetSelection) => void;
    /** Player discards `amount` cards chosen uniformly at random (CR 701.8a).
     *  Capped at current hand size — no-op on an empty hand. Randomness is
     *  drawn from the game's seeded PRNG so replays reproduce the same picks. */
    discardAtRandom: (playerId: string, amount: number) => void;
    /** Adds mana to the caster's mana pool (CR 106.1, 605.4). Mirrors the
     *  mana-ability primitive; used by "add ~" spells like Dark Ritual. */
    addMana: (cost: ManaCost) => void;
    /** Adds mana to a specific player's mana pool (CR 106.1, 605.4). Used by
     *  triggers like Mana Flare ("that player adds one mana...") and Wild
     *  Growth ("its controller adds an additional {G}") that target a player
     *  other than the trigger's controller. */
    addManaTo: (playerId: string, cost: ManaCost) => void;
    /** Adds restricted mana to `playerId`'s pool (CR 106.6) — mana that can
     *  only pay for costs the `restriction` permits (e.g. Metamorphosis:
     *  "Spend this mana only to cast creature spells"). Empties at end of
     *  step/phase like normal mana (CR 500.4). */
    addRestrictedMana: (
        playerId: string,
        cost: ManaCost,
        restriction: ManaRestriction
    ) => void;
    /** Value chosen for X at cast-time (CR 107.3, 601.2b). 0 if the spell
     *  has no X in its cost. Read by spells like Fireball on resolution. */
    getX: () => number;
    /** Mana value of a target (CR 202.3 / 202.3b). For a permanent target,
     *  returns the printed cost's mana value — X in the cost counts as 0
     *  because the chosen X is not currently preserved on the resulting
     *  permanent. For a spell target on the stack, X folds in the chosen
     *  value from the stack item. Returns 0 for player / graveyard-card /
     *  unknown targets. Used by Spell Blast ("counter target spell with
     *  mana value X"). */
    getManaValue: (target: TargetSelection) => number;
    /** Mana value snapshotted on the stack item when this spell's
     *  additional sacrifice cost (CR 117.9) was paid at cast time. Returns
     *  `undefined` for spells without an `additionalCosts.sacrificeFilter`.
     *  Used by Sacrifice ("Add an amount of {B} equal to the sacrificed
     *  creature's mana value") to read the captured value at resolve. */
    getAdditionalSacrificeMv: () => number | undefined;
    /** Deals `totalAmount` damage divided evenly, rounded down, among the
     *  given targets (CR 120.1, 603.3). Remainder (if any) is discarded.
     *  Used by Fireball and other "divided among any number of targets"
     *  spells. No-op if targets is empty. */
    dealDividedDamage: (
        targets: TargetSelection[],
        totalAmount: number
    ) => void;
    /** Deals `amount` damage to every permanent / player matching the filter
     *  (CR 120.3). Creatures matching the filter are resolved at call time —
     *  creatures entering mid-resolution are not affected. Lethal damage uses
     *  effective toughness (layer 7c). `filter.creatures`: `true` for all
     *  creatures, or a `PermanentFilter` (types are forced to Creature) to
     *  restrict by subtype/keyword (e.g. `{ excludeAbility: "flying" }`).
     *  `filter.players`: include both players. No-op when amount <= 0 or
     *  nothing matches. Used by Earthquake / Hurricane / Pyroclasm-like sweepers. */
    dealDamageToEach: (
        amount: number,
        filter: {
            creatures?: boolean | Omit<PermanentFilter, "types">;
            players?: boolean;
        }
    ) => void;
    /** Grants a player a reference to an activated ability template defined
     *  on another card (CR 113). The template is looked up at activation
     *  time via the card registry — the grant stores only ids, not the
     *  ability itself. Purged by the phase-boundary cleanup when `duration`
     *  expires. Used by Channel and similar "until end of turn, you may ~"
     *  effects. */
    grantAbility: (
        playerId: string,
        sourceCardId: string,
        abilityId: string,
        duration: DurationSpec
    ) => void;
    /** Schedules an extra turn for `playerId` to be taken after the current
     *  one (CR 500.7). Multiple extra turns stack LIFO — the last one
     *  scheduled is the next one taken. Consumed by advanceTurn(). Used by
     *  Time Walk and similar effects. */
    takeExtraTurn: (playerId: string) => void;
    /** Marks `playerId` as having lost the game (CR 104). Sets
     *  `state.gameOver` directly, bypassing the CR 614 lose-game replacement
     *  loop — used by Lich's LTB-trigger which fires as a triggered ability
     *  (CR 603) and so is not itself a replaceable lose-game event. */
    loseGame: (playerId: string) => void;
    /** Cumulative non-combat / combat damage dealt to `playerId` this turn
     *  (CR 120.3 tally). Read by Simulacrum ("equal to the damage dealt to
     *  you this turn"). Resets at turn start. */
    getDamageDealtThisTurn: (playerId: string) => number;
    /** Cumulative damage dealt to `playerId` this turn BY ARTIFACT SOURCES
     *  (CR 120.3 tally, narrowed to artifacts). Read by Reverse Polarity
     *  ("twice the damage dealt to you so far this turn by artifacts").
     *  Resets at turn start. */
    getArtifactDamageDealtThisTurn: (playerId: string) => number;
    /** Creates `count` token permanents (CR 111, 707.1) on `controllerId`'s
     *  battlefield from a structural spec. Tokens enter the battlefield
     *  tapped/sick rules normally — they're brand-new permanents (CR 111.5
     *  summoning sickness applies), get any matching lord-style buffs from
     *  existing battlefield sources (CR 611), and emit no ETB events here
     *  (resolution code can append events as needed). Tokens carry
     *  `isToken: true` and are wiped from any non-battlefield zone by the
     *  CR 704.5d state-based action. Returns the ids of the created tokens
     *  so the caller can target / track them within the same resolve.
     *
     *  `createdBy` stamps the token-provenance link (CR 111): each created
     *  token records this instance id in `CardInstanceState.createdBy`, so a
     *  source can later filter "tokens created with this creature" (Tetravus
     *  exiles its own Tetravites to put +1/+1 counters back on itself). Pass
     *  `ctx.sourceInstanceId`. Omit for tokens with no provenance link. */
    createToken: (
        spec: TokenSpec,
        controllerId: string,
        count?: number,
        createdBy?: string
    ) => string[];
    /** Records a one-shot prevention effect: the next time the given source
     *  would deal damage to `playerId`, that damage is prevented (CR 615.1,
     *  615.6). Consumed by the first matching damage event; any unused
     *  remainder is purged when `duration` expires. Used by Circle of
     *  Protection's "this turn"-scoped prevent. */
    preventNextDamageFromSource: (
        sourceInstanceId: string,
        playerId: string,
        duration: DurationSpec
    ) => void;
    /** Records a damage-prevention shield on `target` that absorbs up to
     *  `amount` total damage from any source (CR 615.1, 615.6). Each damage
     *  event reduces the shield by the absorbed amount; an event whose damage
     *  is fully absorbed is replaced with nothing. Multiple shields on the
     *  same target are consumed in declaration order. The unconsumed
     *  remainder is purged at `duration` expiry. Used by Samite Healer
     *  ("prevent the next 1 damage to any target this turn"), Conservator
     *  ("prevent the next 2 damage to you this turn"), and similar
     *  prevent-N-to-target effects. No-op if target has left play / amount
     *  ≤ 0. */
    preventNextNDamageToTarget: (
        target: TargetSelection,
        amount: number,
        duration: DurationSpec
    ) => void;
    /** Pushes a transient damage replacement (CR 614) onto
     *  `state.damageRedirections`. Three kinds cover the LEA cards that
     *  produce one-shot redirections via spells / activated abilities:
     *
     *  - `prevent-from-source-gain-life`: Reverse Damage's "prevent and gain
     *    life equal to amount prevented".
     *  - `to-self-redirect-to-owner`: Personal Incarnation's `{0}: next 1
     *    damage to ~ is dealt to its owner instead`.
     *  - `from-source-to-permanent-redirect-to-player`: Jade Monolith's
     *    `{1}: the next time source X would deal damage to creature C,
     *    that damage is dealt to you instead`.
     *
     *  Unconsumed entries are purged when `duration` expires (typically
     *  end-of-turn). */
    addDamageRedirectionShield: (
        shield:
            | {
                  kind: "prevent-from-source-gain-life";
                  sourceInstanceId: string;
                  playerId: string;
                  duration: DurationSpec;
              }
            | {
                  kind: "to-self-redirect-to-owner";
                  targetInstanceId: string;
                  remaining: number;
                  duration: DurationSpec;
              }
            | {
                  kind: "from-source-to-permanent-redirect-to-player";
                  /** undefined = any source (Jade Monolith). */
                  sourceInstanceId?: string;
                  targetInstanceId: string;
                  redirectToPlayerId: string;
                  remaining: number;
                  duration: DurationSpec;
              }
            | {
                  /** Eye for an Eye (CR 614): the next time the chosen source
                   *  would deal damage to `playerId`, the damage to the player
                   *  is NOT reduced — additionally, an equal amount is dealt to
                   *  that source's controller. One-shot per charge. */
                  kind: "reflect-to-source-controller";
                  sourceInstanceId: string;
                  playerId: string;
                  remaining: number;
                  duration: DurationSpec;
              }
    ) => void;
    /** Records a transient destroy-replacement shield on a permanent (CR 614,
     *  Pyramids): the next time `target` would be destroyed before `duration`
     *  expires, the destruction is replaced — the permanent stays on the
     *  battlefield and its marked damage is removed (oracle "remove all damage
     *  marked on it instead"). One-shot. See ADR 0020. No-op if the target has
     *  left the battlefield. */
    addDestroyReplacementShield: (
        target: TargetSelection,
        duration: DurationSpec
    ) => void;
    /** Prevents all combat damage that would be dealt to and dealt by `target`
     *  for `duration` (CR 615, Ebony Horse). A transient per-instance shield
     *  consumed in the combat damage step. No-op if the target has left the
     *  battlefield. */
    preventAllCombatDamageToAndBy: (
        target: TargetSelection,
        duration: DurationSpec
    ) => void;
    /** Grants a keyword static ability to a permanent for a limited duration
     *  (CR 113.1, 611.1b). Appends to the target's `staticAbilities` so combat
     *  and rules checks see it at read time; the phase-boundary purge splices
     *  it back out when `duration` expires. No-op if target has left the
     *  battlefield. Used by Berserk's "target creature gains trample until
     *  end of turn". */
    grantStaticAbility: (
        target: TargetSelection,
        ability: string,
        duration: DurationSpec
    ) => void;
    /** Turns the target permanent into a creature with the specified base
     *  P/T and optional subtype until `spec.duration` expires (CR 208.2,
     *  611.1). If the permanent is not already a Creature, "Creature" is
     *  added to its types for the duration; the engine restores the original
     *  types, subtypes, and P/T on expiry. Used by Jade Statue and similar
     *  "becomes a creature" animate effects. No-op if the target has left
     *  the battlefield. */
    animateAsCreature: (target: TargetSelection, spec: AnimateSpec) => void;
    /** Queues a delayed triggered ability that fires at a later phase
     *  (CR 603.7a). The template is looked up at fire time via
     *  `getCardById(sourceCardId).delayedTriggers[triggerId]`. `payload` holds
     *  serializable state (instance / player ids) read by the resolver —
     *  closures are not permitted so replays reproduce correctly. Used by
     *  Berserk's "at the beginning of the next end step, destroy ~".
     *
     *  `timing: "next-draw-step"` fires at the beginning of a specific player's
     *  next draw step (CR 504) — pass that player's id as `targetPlayerId` so
     *  the trigger fires only on their draw step (Nafs Asp). The other timings
     *  ignore `targetPlayerId` and fire at the next global boundary. */
    scheduleDelayedTrigger: (
        sourceCardId: string,
        triggerId: string,
        timing: "next-end-step" | "next-end-of-combat" | "next-draw-step",
        payload: Record<string, string>,
        targetPlayerId?: string
    ) => void;
    /** Returns true if the target permanent was declared as an attacker this
     *  turn (CR 506.2). Used by "destroy it if it attacked this turn"-style
     *  delayed triggers. Returns false for players and for permanents no
     *  longer on the battlefield. */
    hasAttackedThisTurn: (target: TargetSelection) => boolean;
    /** Prevents all combat damage for the remainder of this turn (CR 615,
     *  Fog). Cleared at CLEANUP. Non-combat damage is unaffected. */
    preventAllCombatDamage: () => void;
    /** Sets Island Sanctuary protection: the given player can only be attacked
     *  by creatures with flying or islandwalk until their next turn. */
    setIslandSanctuaryProtection: (playerId: string) => void;
    /** Adds a one-shot damage cap shield (Forcefield, CR 615). The next time
     *  an unblocked creature deals combat damage to `playerId`, reduce to
     *  `maxDamage`. Consumed on first use; cleared at CLEANUP. */
    addDamageCapShield: (playerId: string, maxDamage: number) => void;
    /** Marks a creature so that if it would die this turn, it is exiled
     *  instead (CR 614.1a — Disintegrate). Also suppresses regeneration.
     *  Cleared at CLEANUP. No-op if target is not a creature on the
     *  battlefield. */
    setExileOnDeath: (target: TargetSelection) => void;
    /** Returns the number of times the given ability has been activated this
     *  turn on the source permanent (CR 602.5). Used by Dragon Whelp to
     *  check if the pump has been activated 4+ times. */
    getActivationCount: (abilityId: string) => number;
    /** Marks a creature so it must attack this combat if able (CR 508.1d).
     *  Cleared at CLEANUP. No-op if target is not a creature on the
     *  battlefield. Used by Nettling Imp. */
    setMustAttackThisTurn: (target: TargetSelection) => void;
    /** Forces ALL creatures a player controls to attack this combat if able
     *  (CR 508.1d, Siren's Call). Cleared at CLEANUP. */
    setAllCreaturesMustAttack: (playerId: string) => void;
    /** Removes a permanent from combat — clears isAttacking/isBlocking and
     *  updates combat data structures (CR 506.4). Removing a blocker leaves
     *  the attacker(s) it was blocking still blocked (CR 509.1h): they deal no
     *  combat damage to the defender without trample. Use `becomeUnblocked`
     *  for the rare effect that actually un-blocks an attacker. */
    removeFromCombat: (target: TargetSelection) => void;
    /** Makes an attacker that became blocked count as unblocked (CR 509.1h),
     *  so it deals its combat damage to the defending player. Strips it from
     *  the blocked set and from every blocker's assignment. Used by Ydwen
     *  Efreet's coin-flip removal. No-op outside combat. */
    becomeUnblocked: (attackerId: string) => void;
    /** Current block graph as attackerId → ids of the creatures blocking it
     *  (band-expanded, CR 702.21e). A pure read of combat state for effects
     *  that must inspect blocks — e.g. False Orders, which unblocks the
     *  attackers left with no blocker after their sole blocker is removed.
     *  Empty outside combat. */
    getBlockersByAttacker: () => Record<string, string[]>;
    /** Grants a target permanent the ability to block additional attackers
     *  this turn (CR 509.1a). `value` is the number of EXTRA attackers (999
     *  = "any number"). Cleared at CLEANUP. Used by Blaze of Glory. */
    setCanBlockAdditional: (target: TargetSelection, value: number) => void;
    /** Marks a target permanent as "must block all attackers if able" this
     *  turn (Blaze of Glory). Cleared at CLEANUP. */
    setMustBlockAll: (target: TargetSelection) => void;
    /** Marks a target permanent as unable to block this turn (CR 509.1b).
     *  Twin of `setMustBlockAll`. Cleared at CLEANUP. Used by Ydwen Efreet's
     *  lost block flip. No-op if target is not a permanent on the
     *  battlefield. */
    setCantBlockThisTurn: (target: TargetSelection) => void;
    /** Marks a target permanent (an attacker) as unable to be blocked this
     *  turn (CR 509.1b). Read on the attacker side by combat block-validation;
     *  cleared at CLEANUP (CR 514.2). No-op if target is not a permanent on the
     *  battlefield. Used by Tawnos's Wand ("target creature with power 2 or
     *  less can't be blocked this turn"). */
    setCantBeBlockedThisTurn: (target: TargetSelection) => void;
    /** Flips a coin (CR 705) using the game's seeded PRNG, so flips are
     *  replay-safe and reproducible given the seed. Returns true on "heads"
     *  (the flipping player wins the flip), false on "tails". Available where
     *  triggered and activated abilities resolve. Used by Bottle of Suleiman,
     *  Mijae Djinn, and Ydwen Efreet. */
    flipCoin: () => boolean;
    /** Sets colorOverride on a target permanent or spell (CR 305.7, layer 5).
     *  Replaces all color derivation — the target "becomes" the given colors.
     *  Used by lace instants. No-op if target has left play / stack. */
    setColorOverride: (target: TargetSelection, colors: Color[]) => void;
    /** Adds a text-changing effect (CR 612, layer 3) to a target permanent or
     *  spell. The change rides the target instance, so it lasts indefinitely
     *  and ends on a zone change (CR 612.6/612.7). Used by Magical Hack /
     *  Sleight of Mind. No-op if the target has left play / the stack. */
    addTextChange: (target: TargetSelection, change: TextChange) => void;
    /** The basic land types currently referenced by a target — its land
     *  subtypes plus the types its landwalk keywords reference, read through
     *  any active text changes (CR 612.6). These are the legal `from` choices
     *  for a land-type text change ("replace all instances of one basic land
     *  type"). Empty if the target references none. */
    getLandTypesPresent: (target: TargetSelection) => string[];
    /** The color words currently referenced in a target's text — the color
     *  words inside its ability strings ("protection from white") plus the
     *  colors its color-targeted requirements filter on (a Circle of
     *  Protection's "<color> source of your choice"), read through any active
     *  text changes (CR 612.6). These are the legal `from` choices for a
     *  color-word text change. Empty if the target references no color word. */
    getColorWordsPresent: (target: TargetSelection) => string[];
    /** Sets a transient combat pile label on a battlefield creature (Raging
     *  River, CR 509.2). Cleared at end of combat. No-op if the id isn't on
     *  the battlefield. */
    setPileLabel: (cardInstanceId: string, label: string) => void;
    /** Adds a combat-scoped block restriction (Raging River, ADR 0012): the
     *  attacker can be blocked only by flying creatures or creatures whose
     *  pile label matches `allowedPileLabel`. Replaces any existing entry for
     *  the same attacker. Cleared at end of combat. */
    addCombatBlockRestriction: (
        attackerId: string,
        allowedPileLabel: string
    ) => void;
    /** Copies a spell on the stack (CR 707.10, Fork). Clones the target stack
     *  item, inserts the copy directly above the original (so the copy
     *  resolves first), and returns the copy's new stack id — or `null` if the
     *  target is gone, isn't on the stack, or isn't an instant/sorcery spell
     *  (copies of permanent spells / abilities are out of scope). The copy
     *  inherits the original's resolve, targets, and chosen X, is controlled by
     *  the controller of THIS resolving spell, and ceases to exist after
     *  resolving instead of going to a graveyard (CR 707.10/112.5).
     *  `modifications.colorOverride` sets the copy's colors (CR 707.10c —
     *  Fork's "except that the copy is red"). */
    copyStackItem: (
        targetStackItemId: string,
        modifications?: { colorOverride?: Color[] }
    ) => string | null;
    /** Offers this spell's controller the chance to choose new targets for a
     *  copy created by `copyStackItem` (CR 707.10b — Fork's "you may choose
     *  new targets for the copy"). Enters a `copy-retarget` target-selection
     *  phase when the copied spell has a `targetRequirement` that needs at
     *  least one target; otherwise a no-op. Declining the selection
     *  (`cancelTarget`) keeps the copy's inherited targets. No-op if the copy
     *  is no longer on the stack. */
    requestCopyRetarget: (copyStackItemId: string) => void;

    // --- Mid-resolution choices (CR 608.2, 101.4) ---

    /** Requests a player choice during resolution. On first call in a step,
     *  enqueues a `PendingChoice` onto the game state and returns `undefined`
     *  — the caller must in that case return early to let the engine suspend.
     *  On resume (after the player has submitted the choice via
     *  `selectResolutionChoice`), the call returns the ordered id array the
     *  player selected. `choiceId` disambiguates multiple enqueues within a
     *  single step (typically the `playerId`); must be stable across replays. */
    requestChoice: (req: {
        playerId: string;
        choiceId: string;
        kind: ZonePickKind;
        zone: "battlefield" | "hand" | "library";
        filter?: PermanentFilter;
        count: number | { min: number; max: number };
        prompt: string;
        /** Owner of the zone being picked from. Defaults to `playerId` (the
         *  chooser picks from their own zone). Set when the chooser picks
         *  items from another player's zone (e.g. Demonic Hordes: opponent
         *  picks a Land from controller's battlefield). */
        zoneOwnerId?: string;
        /** When true, candidates are drawn from EVERY player's battlefield,
         *  not just one owner's (CR 707 — "a copy of any creature on the
         *  battlefield", Clone / Copy Artifact). Only meaningful for
         *  `zone: "battlefield"`. */
        allControllers?: boolean;
        /** Precomputed allow-list: the chooser may pick only these instance
         *  ids. Use when eligibility isn't a `PermanentFilter` (e.g. a
         *  mana-value bound). Validated server-side at submit; the frontend
         *  gates clickability on it. */
        candidateIds?: string[];
        /** For `kind: "choose-damage-target"` only — the player ids the chooser
         *  may pick as the damage target (CR 115.4 "any target" includes
         *  players). The submission carries either a damageable permanent id
         *  (from `candidateIds`) OR one of these player ids. Used by Cuombajj
         *  Witches ("1 damage to any target of an opponent's choice"). */
        candidatePlayerIds?: string[];
    }) => string[] | undefined;

    /** Requests an optional yes/no decision with an optional mana cost
     *  (CR 117.3a). On first call, enqueues a `may-pay` `PendingChoice` and
     *  returns `undefined` — the caller must return early. On resume the
     *  call returns `true` if the player accepted (and the cost, if any,
     *  was successfully paid by `submitMayPay`) or `false` if declined.
     *  Used by Soul Net ("you may pay {1}. If you do, gain 1 life") and
     *  Verduran Enchantress ("may draw a card" — pass `cost: undefined`). */
    requestMayPay: (req: {
        playerId: string;
        choiceId: string;
        cost?: ManaCost;
        prompt: string;
    }) => boolean | undefined;

    /** Requests a single pick from a list of abstract options (CR 614.12 /
     *  701.x "as it enters, choose …"). On first call, enqueues an
     *  `option-pick` `PendingChoice` and returns `undefined` — the caller must
     *  return early to suspend. On resume (after the player submits via
     *  `selectResolutionChoice`) the call returns the chosen option `id`.
     *  `choiceId` disambiguates multiple enqueues within a step and must be
     *  stable across replays. Used by the choose-body-on-entry creatures
     *  Primal Clay (3 body modes) and Shapeshifter (a number 0–7). */
    requestOptionChoice: (req: {
        playerId: string;
        choiceId: string;
        options: { id: string; label: string }[];
        prompt: string;
    }) => string | undefined;

    /** Sets the resolving permanent's BASE characteristics in place (CR 614.12
     *  "as it enters" body selection / a re-choice on the battlefield). Unlike
     *  `setBasePT` (a timestamped layer-7b set that the cleanup step purges),
     *  this mutates the printed-equivalent base `power`/`toughness` and the
     *  `subtypes`/`staticAbilities` arrays directly, so the choice persists
     *  indefinitely and feeds the layer pipeline as the pre-layer base.
     *  Resolves the recipient like `becomeCopyOf`: the spell still on the stack
     *  during `resolveSteps` (Primal Clay / Shapeshifter entry), or the source
     *  permanent on the battlefield during an upkeep re-choice (Shapeshifter).
     *  `power`/`toughness` overwrite (set, not add). `addSubtypes`/`addKeywords`
     *  append without duplicating. Used by Primal Clay (Wall mode adds subtype
     *  "Wall" + keyword "defender") and Shapeshifter (power = N, toughness =
     *  7 − N, re-set each upkeep). */
    setSelfBody: (spec: {
        power?: number;
        toughness?: number;
        addSubtypes?: string[];
        addKeywords?: string[];
    }) => void;

    /** Active-player-then-non-active-player order (CR 101.4). In 2-player
     *  games, returns [activePlayerId, opponentId]. Used by spells like
     *  Balance where each player makes a choice in APNAP order. */
    apNapOrder: () => string[];

    /** Count of lands controlled by `playerId` (CR 305). */
    getLandCount: (playerId: string) => number;

    /** Count of creatures controlled by `playerId` (CR 302). */
    getCreatureCount: (playerId: string) => number;

    /** Number of cards in `playerId`'s hand. */
    getHandSize: (playerId: string) => number;

    /** Ids of permanents on `playerId`'s battlefield matching the filter. */
    getBattlefieldIds: (playerId: string, filter?: PermanentFilter) => string[];

    /** The card definition id (`card.card.id`) of a permanent on the
     *  battlefield, or undefined if it isn't there. Used by identity filters
     *  that key off the card registry. */
    getCardDefinitionId: (cardInstanceId: string) => string | undefined;
    /** True if the permanent on the battlefield was originally printed in
     *  `setCode` — i.e. its card definition's home set matches (reprints do
     *  not change the home set). Used by Golgothian Sylex ("each nontoken
     *  permanent originally printed in the Antiquities expansion"). False if
     *  the id isn't on the battlefield. */
    isPrintedInSet: (cardInstanceId: string, setCode: string) => boolean;

    /** True if the permanent has the given subtype (CR 205.3). */
    hasSubtype: (target: TargetSelection, subtype: string) => boolean;

    /** Ids of cards in `playerId`'s hand. */
    getHandIds: (playerId: string) => string[];

    /** Sacrifices a permanent controlled by its current controller (CR 701.16).
     *  No-op if the id is not on the battlefield. */
    sacrifice: (cardInstanceId: string) => void;

    /** Discards a specific card from `playerId`'s hand (CR 701.8). No-op if
     *  the card is no longer in hand. */
    discardCard: (playerId: string, cardInstanceId: string) => void;

    /** Stacks a regeneration shield on a permanent (CR 701.15a). The next
     *  time that permanent would be destroyed this turn, the shield is
     *  consumed and the destroy is replaced with "remove all marked damage,
     *  tap, remove from combat". Multiple shields stack — each is consumed
     *  once, in any order, until they expire at CLEANUP (CR 514.2).
     *
     *  No-op if the target is no longer on the battlefield. */
    applyRegenerationShield: (target: TargetSelection) => void;

    /** Reads the `attachedTo` host id of an aura on the battlefield (CR 303.4b).
     *  Returns undefined if the source is not an aura, isn't on the
     *  battlefield, or isn't attached. Used by activated abilities on auras
     *  that target / affect the enchanted permanent without re-targeting it
     *  (e.g. Regeneration's "{G}: Regenerate enchanted creature."). */
    getAttachedTo: (sourceInstanceId: string) => string | undefined;

    /** Moves an Aura from its current host to `newHostId` without it leaving
     *  the battlefield (CR 303.4 / 701.3d — "attach"). Unapplies the aura's
     *  static grants from the old host and re-applies them to the new one.
     *  Returns false if the aura or the new host isn't on the battlefield.
     *  Used by Kudzu ("That land's controller may attach this Aura to a land
     *  of their choice."). */
    reattachAura: (auraInstanceId: string, newHostId: string) => boolean;

    /** Taps all lands controlled by `playerId` (CR 701.20a). Used by Mana
     *  Short and Drain Power. No-op for lands already tapped. */
    tapAllLands: (playerId: string) => void;

    /** Empties `playerId`'s mana pool and returns the drained amounts as a
     *  ManaCost (CR 106.4). Used by Mana Short (tap + drain) and Drain
     *  Power (tap + drain + transfer to caster). */
    drainManaPool: (playerId: string) => ManaCost;

    /** Marks `playerId` to skip their next turn (CR 614.10). The flag is
     *  consumed and cleared by advanceTurn(). Used by Time Vault. */
    setSkipNextTurn: (playerId: string) => void;

    // --- Library peek / reorder (CR 401) ---

    /** Returns the instance ids of the top N cards of `playerId`'s library
     *  without moving them (CR 401.4). */
    peekLibraryTop: (playerId: string, n: number) => string[];

    /** Reorders the top cards of `playerId`'s library so they match the order
     *  given by `orderedIds` (CR 401). All ids must already be in the top N. */
    reorderLibraryTop: (playerId: string, orderedIds: string[]) => void;

    /** Reveals `targetPlayerId`'s hand to the controller via a display-only
     *  pending choice (CR 401.4 — "look at"). Returns the revealed card ids
     *  on acknowledgement, `undefined` while suspended waiting for the
     *  controller to dismiss. */
    revealHand: (targetPlayerId: string) => string[] | undefined;

    /** Characteristics of every card in `playerId`'s hand, read from the card
     *  registry (CR 108.1). Used to compute eligibility for effects that
     *  inspect hand cards (Illusionary Mask: "a creature card whose mana cost
     *  could be paid by the {X} spent"). `manaValue` folds X to 0 (CR 202.3b).
     *  Empty for an empty hand. */
    getHandCards: (
        playerId: string
    ) => Array<{ id: string; types: CardType[]; manaValue: number }>;

    /** Casts a card from the caster's hand face down as a 2/2 colourless
     *  creature spell paying no mana cost (CR 708.2 / 707; Illusionary Mask).
     *  The card is moved hand → stack, turned face down (its real id retained
     *  in `faceDownOf` for the turn-up), and pushed on top of the stack — it
     *  resolves next into a face-down permanent. No-op if the id isn't in the
     *  caster's hand. */
    castFaceDown: (cardInstanceId: string) => void;
}

/** Delayed triggered ability template (CR 603.7a). Declared on the
 *  scheduling card's definition; the engine looks it up by id at fire time
 *  and calls `resolve` with the payload captured at scheduling. */
export interface DelayedTriggerDef {
    /** Local id on `CardDefinition.delayedTriggers`. */
    id: string;
    /** Oracle text shown on the stack when the trigger fires. */
    oracleText: string;
    /** When the trigger should fire. */
    timing: "next-end-step" | "next-end-of-combat" | "next-draw-step";
    /** Invoked when the trigger resolves from the stack. `payload` carries
     *  serialized references (ids) chosen at scheduling time. */
    resolve: (ctx: SpellContext, payload: Record<string, string>) => void;
}

// --- Continuous static effects (CR 611, 613) ---
// Minimal layer-system subset: P/T buffs (layer 7c) applied at read time.
// No layer ordering, no CDA support, no text-changing effects yet.
//
// Effects are expressed via an `applies` predicate (like SpellContext.resolve
// for spells). This keeps the engine small: no enum of scopes/filters to
// maintain — each card declares its own eligibility rule.

/** Minimal permanent shape exposed to static-effect predicates. */
export interface PermanentView {
    id: string;
    controllerId: string;
    ownerId: string;
    types: CardType[];
    subtypes: string[];
    isTapped: boolean;
    power?: number;
    toughness?: number;
    /** Set on auras attached to another permanent (CR 303.4b). Predicates
     *  for keyword-grant effects typically use `target.id === source.attachedTo`. */
    attachedTo?: string;
    /** Player chosen as this permanent entered (CR 603.6b), stored for the rest
     *  of the game. Read by phase-trigger conditions that fire only on the
     *  chosen player's step (The Rack — "the chosen player's upkeep"). The
     *  trigger system passes the raw `CardInstanceState` as `self`, so this is
     *  populated for trigger predicates. */
    chosenPlayerId?: string;
    /** True while this creature is a declared attacker (CR 508.1). Set at
     *  DECLARE_ATTACKERS, cleared at END_OF_COMBAT. Static effect predicates
     *  like Orcish Oriflamme read this to buff attacking creatures. */
    isAttacking?: boolean;
    /** True while this creature is a declared blocker (CR 509.1). Set at
     *  DECLARE_BLOCKERS, cleared at END_OF_COMBAT. Used by combat-role
     *  targeting (Righteousness: "target blocking creature"). */
    isBlocking?: boolean;
    /** True if the creature was declared as an attacker this turn (CR 506.2).
     *  Persists past END_OF_COMBAT so end-of-combat / end-step triggers can
     *  read it. */
    hasAttackedThisTurn?: boolean;
    /** True if the creature was declared as a blocker this turn. Mirrors
     *  `hasAttackedThisTurn` for end-of-combat triggers like Clockwork Beast. */
    hasBlockedThisTurn?: boolean;
    /** True while the creature still has summoning sickness (CR 302.6) — it
     *  entered the battlefield or came under its current controller's control
     *  since their most recent turn began, and is cleared at that controller's
     *  untap step. Exposed so end-step / upkeep triggers can implement the
     *  "unless it came under your control this turn" exemption (Erg Raiders).
     *  The trigger system passes the raw `CardInstanceState` as `self`, so this
     *  flag is populated for trigger predicates. */
    isSummoningSick?: boolean;
    /** One-shot P/T modifications scoped to a phase boundary (CR 611.1, 611.2).
     *  Each entry adds to `power`/`toughness` at read time; the engine purges
     *  entries whose `duration` has expired during phase-boundary cleanup
     *  (END_OF_COMBAT or CLEANUP). Used by "+X/+Y until end of turn" spells
     *  and pump activations (Firebreathing, Howl from Beyond, ...). */
    temporaryPTMods?: ReadonlyArray<{ power: number; toughness: number }>;
    /** Layer 7b set-P/T effects scoped to a phase boundary (CR 613.4b, ADR
     *  0017). Each entry sets `power` and/or `toughness` to a fixed value
     *  (independently optional); the latest entry per characteristic wins
     *  (array order is the timestamp). Purged at the same phase boundary as
     *  `temporaryPTMods`. Used by Singing Tree / Island of Wak-Wak (set power
     *  0) and Sorceress Queen (set 0/2). */
    temporaryPTSet?: ReadonlyArray<{ power?: number; toughness?: number }>;
    /** Conditional P/T modifications held "for as long as [the source] remains
     *  tapped" (CR 611.2; ATQ Ashnod's Battle Gear, Tawnos's Weaponry). Each
     *  entry adds to `power`/`toughness` at read time (layer 7d) while its
     *  `sourceId` permanent stays on the battlefield and tapped. Mirrors the
     *  `CardInstanceState` field so the layer system reads it through the view. */
    sourceTappedPTMods?: ReadonlyArray<{
        power: number;
        toughness: number;
        sourceId: string;
    }>;
    /** Counters on this permanent (CR 122). Map of counter type → count.
     *  Layer 7d (P/T-modifying counters: +1/+1, +1/+0, +0/+1, -1/-1, -0/-1,
     *  -1/-0) contributes at stat-read time. Other types are inert to layers
     *  and read by card-specific abilities only. */
    counters?: Readonly<Record<string, number>>;
    /** True for tokens (CR 111). Predicates that scope to "nontoken
     *  permanents" (Jihad's chosen-color clause) read this; populated from the
     *  raw `CardInstanceState` the engine passes through as the view. */
    isToken?: boolean;
    /** Cast-time modal choice (CR 700.2c). Present on modal permanents so
     *  static-effect and trigger predicates can read the chosen mode (Jihad's
     *  chosen colour). Mirrors the `CardInstanceState` field. */
    chosenModeId?: string;
    /** Raw card definition reference — predicates read manaCost for color, etc. */
    card: Record<string, unknown>;
}

/** Minimal read-only view of the battlefield used by characteristic-defining
 *  abilities (CR 604.3) whose value depends on board state — e.g. Nightmare's
 *  "P/T equal to Swamps you control". Intentionally a subset of the engine's
 *  full GameState so layer computation stays pure. */
export interface StaticEffectStateView {
    players: ReadonlyArray<{ battlefield: ReadonlyArray<PermanentView> }>;
}

export interface StaticEffectContext {
    /** Colors of a card derived from its mana cost (CR 202.2). Returns W/U/B/R/G subset. */
    getColors: (card: PermanentView) => Color[];
    /** True if card has type "Creature" (CR 208.2). */
    isCreature: (card: PermanentView) => boolean;
    /** True if card has the given subtype. */
    hasSubtype: (card: PermanentView, subtype: string) => boolean;
    /** Printed mana value of a card (CR 202.3). X in the printed cost
     *  counts as 0 for permanents on the battlefield (the chosen X is not
     *  preserved). Used by characteristic-defining abilities that key off
     *  the host's mana value (Animate Artifact). */
    getManaValue: (card: PermanentView) => number;
    /** Printed card type line (CR 205.2, from the card definition), unaffected
     *  by type-add / animate effects that mutate the live `types`. Used by
     *  predicates that must distinguish a printed noncreature permanent from
     *  one whose Creature type was added by another effect — e.g. Titania's
     *  Song's "Each NONCREATURE artifact" set, which must keep matching its own
     *  targets after it has made them creatures, and must never match a printed
     *  artifact creature (Ornithopter). */
    getPrintedTypes: (card: PermanentView) => CardType[];
}

export interface StaticPTBuff {
    kind: "pt-buff";
    /** Predicate: does this buff apply to `target` given its `source`? */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Optional source-level gate (CR 611.2c — "as long as ..."). Evaluated
     *  once per source (not per target) against the whole board: when present
     *  and false, the buff contributes nothing this read, regardless of
     *  `applies`. Use for conditional anthems whose activeness depends on game
     *  state — e.g. Jihad ("white creatures get +2/+1 as long as the chosen
     *  player controls a nontoken permanent of the chosen color"). */
    condition?: (
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    power: number;
    toughness: number;
}

/** Characteristic-defining P/T ability (CR 604.3). Used when a creature's
 *  power and toughness are defined by a game-state lookup rather than a flat
 *  buff — e.g. Nightmare ("P/T each equal to Swamps you control"). The
 *  `compute` function is called at stat-read time; its result is added on top
 *  of the card's base P/T, so cards using this kind typically declare base
 *  `power: 0` / `toughness: 0`. */
export interface StaticPTCDA {
    kind: "pt-cda";
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Compute the P/T contribution. `target` is the permanent whose P/T is
     *  being read (relevant when the source grants a CDA to another
     *  permanent — e.g. Animate Artifact reads the host's mana value to set
     *  the host's own P/T). `source` is the permanent that owns the static
     *  effect; for self-targeting CDAs (Nightmare, Bog Wraith on Plagues)
     *  `source === target`. */
    compute: (
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext,
        target: PermanentView
    ) => { power: number; toughness: number };
}

/** Continuous static ability that grants a keyword to the enchanted
 *  permanent (CR 611, 113.1). Typical usage: an Aura grants "protection
 *  from red" or "flying" to its host. The engine applies the grant
 *  imperatively when the aura attaches (pushing the keyword into the
 *  host's `staticAbilities`) and reverses it when the aura leaves the
 *  battlefield — so every read of `staticAbilities.includes(kw)` observes
 *  the effect without a per-reader layer-query hop. */
export interface StaticKeywordGrant {
    kind: "keyword-grant";
    /** Predicate: does this grant apply to `target` given `source`? For
     *  auras, use the exported `AURA_AFFECTS_HOST` constant. */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Keyword string pushed into the host's `staticAbilities` (e.g.
     *  "protection from red", "flying"). */
    keyword: string;
}

/** Continuous control-changing effect (CR 613.1b, layer 2). Typical usage:
 *  an Aura like Control Magic flips the controller of its enchanted host.
 *  Applied imperatively when the aura attaches — the host's `controllerId`
 *  is reassigned to the aura's controller, the host is moved into that
 *  player's battlefield array, and summoning sickness is reset (CR 702.10c,
 *  the creature is no longer continuously under its controller's control
 *  since the beginning of the most recent turn). Reversed when the aura
 *  leaves play.
 *
 *  Multiple simultaneous control-change auras on the same permanent are
 *  resolved by timestamp (latest-applied wins while present) via the host's
 *  `controlChanges` stack on `CardInstanceState`. The base controller is
 *  `ownerId` (CR 108.3) — recovered automatically when the stack empties. */
export interface StaticControlChange {
    kind: "control-change";
    /** Predicate: does this control-change apply to `target` given `source`?
     *  For auras, use the exported `AURA_AFFECTS_HOST` constant. */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
}

/** Continuous static ability that grants an activated ability to matching
 *  permanents (CR 611, 113.1). Typical usage: a lord like Zombie Master
 *  grants "{B}: Regenerate this creature." to every other Zombie. The
 *  template lives on the granting card's `grantTemplates[]` (kept off
 *  `activatedAbilities` so the source itself doesn't expose a native copy of
 *  the ability). The grant is applied imperatively when the source or a
 *  matching permanent enters the battlefield, and reversed when the source
 *  leaves play.
 *
 *  Resolution semantics: when the granted ability is activated on a target,
 *  the engine resolves it with the target as the source permanent (so e.g.
 *  Zombie Master's regen shields the Zombie that activated it, not the
 *  Master itself). Cost payment, target requirement and effect body are read
 *  from the template on the granting card's def. */
export interface StaticActivatedGrant {
    kind: "activated-grant";
    /** Predicate: does this grant apply to `target` given `source`? */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Id on `source.grantTemplates[]` to grant. */
    abilityId: string;
}

/** Continuous static ability that grants a TRIGGERED ability to matching
 *  permanents (CR 611, 113.1). The lord-style analogue of
 *  `StaticActivatedGrant` for triggers: an anthem grants "At the beginning of
 *  your upkeep, sacrifice this artifact unless you pay {2}" to every artifact
 *  (Energy Flux). The template lives on the granting card's
 *  `triggeredGrantTemplates[]` (kept off `triggeredAbilities` so the source
 *  itself doesn't fire the granted trigger). The grant is applied imperatively
 *  when the source or a matching permanent enters the battlefield and reversed
 *  when the source leaves play — exactly like `activated-grant`.
 *
 *  Resolution semantics: the granted trigger is scanned/resolved AS IF it were
 *  printed on the recipient (via `effectiveTriggeredAbilities`), so the
 *  trigger's `self` is the artifact carrying it — `scope: "your"` fires at the
 *  artifact controller's own upkeep (CR 603.6a) and `ctx.sourceInstanceId`
 *  refers to the artifact itself ("sacrifice this artifact"). */
export interface StaticTriggeredGrant {
    kind: "triggered-grant";
    /** Predicate: does this grant apply to `target` given `source`? */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Id on `source.triggeredGrantTemplates[]` to grant. */
    abilityId: string;
}

/** Continuous static ability that adds card type(s) to a permanent
 *  (CR 205, 611, 1.3 — layer 4 type-setting effects). Mutates the affected
 *  permanent's `types` array imperatively on apply (and reverses on
 *  unapply), tracking origin in `grantedTypes` so duplicates from multiple
 *  sources don't double-add and removal only takes effect when the last
 *  granting source detaches. Used by Animate Artifact ("the enchanted
 *  artifact is an artifact creature"). The `applies` predicate is read at
 *  apply time and is not re-evaluated continuously — for LEA's scope this
 *  is sufficient (no card revokes a type-add mid-life), but the model is
 *  intentionally simpler than CR's layer-1-through-7 recompute. */
export interface StaticTypeAdd {
    kind: "type-add";
    /** Predicate: does this grant apply to `target` given `source`? For
     *  auras whose effect is conditional on the host's printed types (e.g.
     *  Animate Artifact's "as long as enchanted artifact isn't a creature"),
     *  the predicate combines AURA_AFFECTS_HOST with the printed-type
     *  check. */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Types to add to the target. Duplicates against printed `types` or
     *  other concurrent grants are deduplicated by the engine. */
    types: CardType[];
}

/** Continuous "loses all abilities" static effect (CR 613.1f layer 6 —
 *  ability-removing effects). Suppresses ALL of the affected permanent's
 *  abilities: keyword abilities (stripped from `staticAbilities`, tracked via
 *  `removedKeywords` for restore), activated abilities (native lookups return
 *  null while suppressed), triggered abilities (excluded from the trigger
 *  scan), and intrinsic mana abilities. Used by Titania's Song ("Each
 *  noncreature artifact loses all abilities and becomes an artifact
 *  creature ..."). Applied/reversed imperatively like `type-add` and
 *  `keyword-remove` — the `applies` predicate is read at apply time and when a
 *  matching permanent enters (`applyExistingGrantsTo`); for ATQ's scope this
 *  is sufficient (no card revokes the loss mid-life while the source stays in
 *  play). Per CR 613, ability-removal here precedes the layer-7 P/T pipeline,
 *  so a card whose P/T comes from a separate static effect on the same source
 *  (Titania's Song's mana-value CDA) still has its P/T set. */
export interface StaticAbilityLoss {
    kind: "ability-loss";
    /** Predicate: does this loss apply to `target` given `source`? */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
}

/** Continuous untap-step restriction (CR 502.1) — caps how many permanents
 *  matching `filter` the active player may untap. Read by the `untapStep`
 *  dispatcher in `convex/gre/phases.ts`. Built by the `untapRestriction`
 *  factory under `convex/cards/abilities/static/`.
 *
 *  Unlike the other `StaticEffect` members this one carries no `applies`
 *  predicate: it is a global game-state restriction (CR 611 — characteristic-
 *  defining/ continuous, scoped by `scope`), not a per-permanent effect, and
 *  the dispatcher does its own eligibility computation against the active
 *  player's battlefield using `filter`. */
export interface StaticUntapRestriction {
    kind: "untap-restriction";
    /** Stable id (matches the factory's `args.id`) — used by the engine to
     *  key the pending-choice `choiceId` per restriction. */
    id: string;
    /** Oracle line shown in the prompt when the cap binds. */
    oracleText: string;
    /** Permanent filter the cap is scoped to (lands for Winter Orb, creatures
     *  for Smoke, "any" for Stasis). */
    filter: import("./filters").PermanentFilter;
    /** Inclusive upper bound on simultaneous untaps from the matching set
     *  during the active player's untap step. 0 = full skip. */
    maxUntap: number;
    /** Whose untap step the cap binds. `each-player` — applies regardless of
     *  the source's controller. Reserved enum keeps room for future
     *  controller-scoped restrictions without breaking the type. */
    scope: "each-player";
}

/** Card-level block restriction (CR 509.1b). Declares that a permanent
 *  (or its host, for auras) either restricts what can block it when
 *  attacking (`side: "attacker"`) or restricts what it can block
 *  (`side: "blocker"`). The engine collects these from the card definition
 *  and from attached auras at block-declaration time.
 *
 *  The predicate receives P/T already enriched to effective (post-layer-7c)
 *  values by the combat validator, so predicates that check `opponent.power`
 *  automatically honor static buffs (Crusade, Bad Moon, etc.). */
export interface StaticBlockRestriction {
    kind: "block-restriction";
    id: string;
    /** "attacker" — restricts which blockers may be assigned to this
     *  creature when it attacks.
     *  "blocker" — restricts which attackers this creature may block. */
    side: "attacker" | "blocker";
    /** Returns `true` when the block is LEGAL, `false` to reject.
     *  For side "attacker": `self` = attacker, `opponent` = candidate blocker.
     *  For side "blocker": `self` = blocker, `opponent` = attacker. */
    predicate: (
        self: PermanentView,
        opponent: PermanentView,
        state?: StaticEffectStateView
    ) => boolean;
    /** Oracle text displayed as the rejection reason. */
    oracleText: string;
}

/** Card-level attack restriction (CR 508.1c). Declares that a creature
 *  cannot attack unless a condition on the defending player's battlefield
 *  is met. The engine collects these from the card's `staticEffects[]` at
 *  attack-declaration time.
 *
 *  The predicate receives the attacking creature and the full defender
 *  battlefield so conditional restrictions ("can't attack unless defending
 *  player controls an Island") are expressible. */
export interface StaticAttackRestriction {
    kind: "attack-restriction";
    id: string;
    /** Returns `true` when the attack is LEGAL, `false` to reject.
     *  `self` = the creature attempting to attack.
     *  `defenderBattlefield` = the defending player's permanents. */
    predicate: (
        self: PermanentView,
        defenderBattlefield: readonly PermanentView[]
    ) => boolean;
    /** Oracle text displayed as the rejection reason. */
    oracleText: string;
}

/** Card-level attack requirement (CR 508.1d). Declares that a creature
 *  must attack each combat if able. The engine collects these from the
 *  card's `staticEffects[]` and enforces the requirement when the creature
 *  is otherwise eligible (not tapped, not summoning-sick, no defender). */
export interface StaticAttackRequirement {
    kind: "attack-requirement";
    id: string;
    /** Oracle text shown when the requirement forces an attack. */
    oracleText: string;
}

/** Card-level block requirement (CR 509.1c). Declares that creatures
 *  able to block the enchanted/source permanent must do so. The engine
 *  collects these from the card definition and attached auras at
 *  block-confirmation time and auto-assigns missing blockers.
 *
 *  Scope "all-able" means every eligible creature the defending player
 *  controls must block this attacker (Lure). */
export interface StaticBlockRequirement {
    kind: "block-requirement";
    id: string;
    /** Oracle text shown when the requirement forces a block. */
    oracleText: string;
    scope: "all-able";
}

/** Continuous static effect that overrides the controller's maximum hand
 *  size (CR 402.2 / 514.1). Player-scoped, not per-permanent: the reader in
 *  `effectiveMaxHandSize` (`convex/gre/phases.ts`) walks the controller's
 *  battlefield and merges every active override into a single effective
 *  cap. `"unlimited"` always wins; among numeric values the largest (most
 *  permissive) prevails. Used by Library of Leng / Reliquary Tower /
 *  Spellbook-style cards.
 *
 *  Unlike per-permanent statics (`pt-buff`, `keyword-grant`), this kind has
 *  no `applies` predicate — it always applies to the source's controller. */
export interface StaticHandSizeOverride {
    kind: "hand-size-override";
    value: number | "unlimited";
    /** Whose maximum hand size this overrides. Defaults to `"controller"` (the
     *  source's controller — Library of Leng / Reliquary Tower). Set to
     *  `"chosen-player"` when the override targets the player chosen as the
     *  source entered the battlefield (Cursed Rack — "an opponent of your
     *  choice... that player's maximum hand size is four"); the reader resolves
     *  that to the source instance's stored `chosenPlayerId`. */
    appliesTo?: "controller" | "chosen-player";
}

/** Layer 4 subtype replacement (CR 305.7 — "enchanted land is a [type]").
 *  Replaces the target's subtypes entirely with the specified array. The
 *  engine stores the printed subtypes before the first replacement so removal
 *  of the source restores them. Multiple concurrent sources stack: the last
 *  applied wins (timestamp order), and unapplying one falls back to the
 *  previous source or to printed subtypes when none remain. */
export interface StaticSubtypeSet {
    kind: "subtype-set";
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    subtypes: string[];
}

/** Layer 5 color grant (CR 305.7 — "is a black creature"). Adds colors to
 *  the target without affecting its mana cost. Tracked via `grantedColors`
 *  on CardInstanceState so unapply can restore the original color identity. */
export interface StaticColorGrant {
    kind: "color-grant";
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    colors: Color[];
}

/** Cost-modification static effect (CR 601.2f). Scanned at cast-announcement
 *  time; matching `costIncrease` is added to and matching `costReduction` is
 *  subtracted from the spell/ability base cost.
 *
 *  The optional third `effectSource` argument given to the `appliesTo*`
 *  predicates is the permanent that carries THIS effect (e.g. the Aura),
 *  distinct from `card`/`source` which is the spell/ability being modified.
 *  It lets an Aura scope its modifier to its host — Power Artifact's
 *  `appliesToAbility` checks `effectSource.attachedTo === source.id` so only
 *  the enchanted artifact's abilities are reduced. Board-wide modifiers
 *  (Gloom) ignore it. */
export interface StaticCostModifier {
    kind: "cost-modifier";
    appliesToSpell?: (
        card: PermanentView,
        ctx: StaticEffectContext,
        effectSource?: PermanentView
    ) => boolean;
    appliesToAbility?: (
        source: PermanentView,
        ctx: StaticEffectContext,
        effectSource?: PermanentView
    ) => boolean;
    /** Mana added to the base cost (CR 601.2f). Defaults to nothing. */
    costIncrease?: ManaCost;
    /** Mana removed from the base cost (CR 601.2f reductions). Only the generic
     *  portion is reduced — colored pips can't be reduced by a generic
     *  reduction. Defaults to nothing. */
    costReduction?: ManaCost;
    /** Floor on the post-reduction TOTAL mana of the cost (sum of all pips),
     *  CR 601.2f / 118.7. Power Artifact's reminder text: "This effect can't
     *  reduce the cost to less than one mana", i.e. `minTotalMana: 1`. A
     *  reduction never takes the total below this; colored pips are never
     *  touched, so the floor only ever protects generic mana. Ignored when no
     *  `costReduction` is present. */
    minTotalMana?: number;
}

/** Keyword-removal static effect (CR 613.1a layer 6). Suppresses a keyword
 *  on matching permanents. Tracked via `removedKeywords` on the target so
 *  unapply can restore the original. */
export interface StaticKeywordRemove {
    kind: "keyword-remove";
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    keyword: string;
}

/** Mana-substitution static effect (CR 609.4b — "spend mana as though it
 *  were mana of another color/type"). While the source is on the battlefield,
 *  its controller may pay a cost requiring `to`-color mana with `from`-color
 *  mana. Derived live at payment time (auto-reverts when the source leaves),
 *  so it carries no per-player persisted state. Used by Sunglasses of Urza
 *  ("You may spend white mana as though it were red mana."). */
export interface StaticManaSubstitution {
    kind: "mana-substitution";
    from: Color;
    to: Color;
}

/** Continuous protection bundle for matching permanents (CR 611 continuous
 *  effect — evaluated live, never timestamp-applied). Unlike `keyword-grant`,
 *  which mutates the target's `staticAbilities` once at apply time and reverts
 *  at unapply time, this kind is read on demand at each gate (targeting,
 *  enchant, destroy, control change), so its `applies` predicate may depend on
 *  mutable source state that the imperative apply/unapply hooks never observe —
 *  e.g. "as long as `source` is untapped" (Guardian Beast). Each flag selects
 *  which protection clauses are barred for a permanent matched by `applies`.
 *
 *  This mirrors the live-query model already used by `isProtectedFromColors`
 *  (CR 702.16b) and `isCombatDamageImmune` (Ebony Horse): the guard is a
 *  battlefield-wide rule, queried at the moment the protected action is
 *  attempted, not a per-permanent mutation. Future "while <condition>, these
 *  permanents you control are protected" cards reuse the same kind. */
export interface StaticPermanentGuard {
    kind: "permanent-guard";
    /** Stable id (for debugging / oracle tracing). */
    id: string;
    /** Predicate: is `target` guarded right now, given `source` and live board
     *  state? The predicate is evaluated at each gate, so reading
     *  `source.isTapped` (Guardian Beast's "as long as ~ is untapped") yields
     *  the current tap state — no re-apply hook needed. */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** CR 702.16b-style "can't be the target of spells or abilities". Gated in
     *  `getLegalTargets` and `selectTarget`. */
    cantBeTargeted?: boolean;
    /** Narrows `cantBeTargeted` to sources whose card types intersect this
     *  list (CR 109.5 — the source's characteristics). Used by Artifact Ward's
     *  "can't be the target of abilities from artifact sources" (filter
     *  `["Artifact"]`). When omitted, `cantBeTargeted` blocks targeting from
     *  ANY source (Guardian Beast). Evaluated at the targeting gates, which
     *  pass the source's types. */
    targetSourceTypeFilter?: CardType[];
    /** CR 303.4 "can't be enchanted" — an Aura can't be cast at, or attach to,
     *  the guarded permanent. Already-attached Auras are unaffected (the gate
     *  only blocks new attachment). */
    cantBeEnchanted?: boolean;
    /** CR 702.12-style indestructible — "destroy" effects and lethal-damage
     *  SBA-by-destroy don't move the guarded permanent to the graveyard. */
    indestructible?: boolean;
    /** CR 613.1b layer 2 — the guarded permanent's controller can't be
     *  changed. Gated in `applyControlChange`. */
    controlCantChange?: boolean;
}

export type StaticEffect =
    | StaticPTBuff
    | StaticPTCDA
    | StaticKeywordGrant
    | StaticControlChange
    | StaticActivatedGrant
    | StaticTriggeredGrant
    | StaticTypeAdd
    | StaticSubtypeSet
    | StaticColorGrant
    | StaticUntapRestriction
    | StaticBlockRestriction
    | StaticAttackRestriction
    | StaticAttackRequirement
    | StaticBlockRequirement
    | StaticHandSizeOverride
    | StaticCostModifier
    | StaticManaSubstitution
    | StaticPermanentGuard
    | StaticKeywordRemove
    | StaticAbilityLoss;

/** Canonical aura predicate: "this static effect applies to my host". Shared
 *  by every aura's `applies` callback (CR 303.4 — auras affect their enchanted
 *  permanent). Use this constant on `StaticKeywordGrant.applies` /
 *  `StaticControlChange.applies` instead of inlining the closure so the intent
 *  is named and changes (e.g. broadening to "host or its controller") happen
 *  in one place. */
export const AURA_AFFECTS_HOST: StaticKeywordGrant["applies"] = (
    target,
    source
) => target.id === source.attachedTo;

/** Canonical "this static effect applies to its source" predicate, used by
 *  self-buffing CDA effects (e.g. Nightmare's flying-Swamp scaling — only the
 *  source itself receives the P/T). Counterpart of `AURA_AFFECTS_HOST` for
 *  effects that don't depend on `attachedTo`. */
export const EFFECT_AFFECTS_SELF: StaticKeywordGrant["applies"] = (
    target,
    source
) => target.id === source.id;

/** "This token can't be enchanted" (CR 303.4 — Tetravite tokens). A
 *  self-targeting `permanent-guard` with `cantBeEnchanted`, mirroring Guardian
 *  Beast's clause but scoped to the source itself. Built as a named factory so
 *  both `createToken` (server registration) and `maybeSynthesizeToken` (client
 *  / post-DB-round-trip rehydration from the token id) reconstruct the SAME
 *  effect — the guard predicate is a closure and can't ride the serialized
 *  token id, so it must be rebuilt deterministically from the id's effect-kind
 *  segment. */
export function cantBeEnchantedSelfGuard(): StaticPermanentGuard {
    return {
        kind: "permanent-guard",
        id: "token-cant-be-enchanted",
        applies: EFFECT_AFFECTS_SELF,
        cantBeEnchanted: true,
    };
}

/** Canonical "tap target artifact, creature, or land" target shape (Twiddle,
 *  Icy Manipulator, Lifelace-style cards). Pre-Walls/Planeswalkers/Battles
 *  targeting trio — keep the shape named so future ACL-targeting prints
 *  share one source of truth. */
export const TARGET_ACL_PERMANENT: TargetRequirement = {
    type: ["Artifact", "Creature", "Land"],
    count: 1,
};

// --- Triggered abilities (CR 603) ---
// Inline structure mirroring ActivatedAbility: each trigger declares which
// game event it listens to, a predicate identifying relevant occurrences, and
// a resolve function invoked from the stack after both players pass priority.

export type GameEventType =
    | "DAMAGE_DEALT"
    | "PHASE_BEGIN"
    | "CREATURE_DIED"
    | "PERMANENT_ENTERED"
    | "PERMANENT_LEFT"
    | "SPELL_CAST"
    | "PERMANENT_TAPPED"
    | "ABILITY_ACTIVATED"
    | "STATE_CHECK"
    | "TRIGGER_FIZZLED"
    | "ATTACKERS_DECLARED"
    | "BLOCKERS_CONFIRMED";

/** Damage event emitted whenever a source inflicts damage on a target
 *  (CR 120.3). Used by "whenever ~ deals damage" triggers. The
 *  `sourceColors / sourceTypes / sourceSubtypes / sourceStaticAbilities`
 *  fields snapshot the damage source's characteristics at the moment damage
 *  was dealt (CR 603.10 last-known information); the source may have left
 *  the battlefield by the time the trigger resolves. Mirrors the same fields
 *  on `DamageReplacementEvent`. Optional for back-compat with synthetic
 *  events constructed in tests — emit sites populate them. */
export interface DamageDealtEvent {
    type: "DAMAGE_DEALT";
    /** Instance id of the permanent or stack item that dealt the damage. */
    sourceInstanceId: string;
    /** Controller of the damage source at the time of the event. */
    sourceControllerId: string;
    /** Target that took damage — player or permanent. */
    target: TargetSelection;
    amount: number;
    /** True for combat damage (CR 510), false for spell/ability damage. */
    isCombat: boolean;
    /** Colors of the damage source (CR 202.2), snapshotted at emit time. */
    sourceColors?: ReadonlyArray<Color>;
    /** Card types of the damage source (CR 205), snapshotted at emit time. */
    sourceTypes?: ReadonlyArray<CardType>;
    /** Subtypes of the damage source (CR 205.3), snapshotted at emit time. */
    sourceSubtypes?: ReadonlyArray<string>;
    /** Static keyword abilities the source had at emit time (CR 702). */
    sourceStaticAbilities?: ReadonlyArray<string>;
}

/** Phase/step entry event emitted by the turn structure at the start of
 *  each non-auto phase (CR 500.1). Used by "at the beginning of ~" triggers
 *  (CR 603.6a). `activePlayerId` is the player whose phase it is — the
 *  trigger's `matches()` decides whether the permanent's controller cares
 *  (e.g. Howling Mine fires on each player's draw step, regardless of
 *  owner). */
export interface PhaseBeginEvent {
    type: "PHASE_BEGIN";
    phase: Phase;
    activePlayerId: string;
}

/** Death event emitted when a creature moves from battlefield to graveyard
 *  (CR 700.4). Emitted by `removePermanentTo` for any death path — combat
 *  damage, non-combat damage SBA (CR 704.5g), destroy effects, sacrifice.
 *  The event carries `damagedBySources` so "if ~ dealt damage to it this
 *  turn"-style triggers (Sengir Vampire) can inspect the victim after it
 *  has left the battlefield. */
export interface CreatureDiedEvent {
    type: "CREATURE_DIED";
    creatureInstanceId: string;
    creatureControllerId: string;
    /** Card types snapshotted at the moment of death (CR 603.10 last known
     *  information). Mirrors `PermanentLeftEvent.types`; consumed by
     *  `diedTrigger`'s last-known-information payload so authors don't have
     *  to refetch from a separate event source. */
    creatureTypes: ReadonlyArray<CardType>;
    /** Instance ids of sources that dealt damage to this creature this turn. */
    damagedBySources: readonly string[];
    /** Effective power of the dying creature snapshotted at the moment it
     *  left the battlefield (CR 603.10 last known information). Used by
     *  triggers like "deals damage equal to that creature's power". */
    creaturePower: number;
    /** Effective toughness snapshotted at the moment the creature left the
     *  battlefield (CR 603.10). Used by triggers like Creature Bond. */
    creatureToughness: number;
    /** Instance ids of the creatures that, at the moment of death, were
     *  blocking this creature or blocked by it (CR 603.10 last known
     *  information). Read by death triggers that act on combat partners after
     *  the dying creature has already left the battlefield (Abu Ja'far —
     *  "destroy all creatures blocking or blocked by it"). Empty when the
     *  creature was not in combat. Optional so older event fixtures and
     *  serialized logs without the field deserialize as "no partners". */
    combatPartnerIds?: readonly string[];
}

/** Enter-the-battlefield event emitted whenever a permanent enters play via
 *  `finalizeSpellResolution` (normal spell cast) or `returnToBattlefield` /
 *  `putReanimatedOnBattlefield` (reanimation). Triggers self-ETB abilities
 *  ("when ~ enters the battlefield, do X"). Mirrors the `PERMANENT_LEFT`
 *  shape so the trigger collector can use the same lookup pattern. */
export interface PermanentEnteredEvent {
    type: "PERMANENT_ENTERED";
    instanceId: string;
    controllerId: string;
    cardId?: string;
    types: ReadonlyArray<CardType>;
}

/** Leave-the-battlefield event emitted whenever a permanent transitions
 *  battlefield→(graveyard|exile|hand|library) via `removePermanentTo` (CR
 *  603.10). Carries last-known-information snapshot fields so LTB-triggers
 *  on the leaving permanent itself ("when this Aura leaves the battlefield,
 *  destroy enchanted creature") can read the host id at the moment of
 *  departure. The leaving permanent is located by `collectTriggers` in its
 *  destination zone (graveyard/exile/hand) via the `recentlyLeft` lookup
 *  mirroring the `CREATURE_DIED` last-known-info pattern. */
export interface PermanentLeftEvent {
    type: "PERMANENT_LEFT";
    /** Instance id of the permanent that left the battlefield. */
    instanceId: string;
    /** Controller of the permanent at the moment it left. */
    controllerId: string;
    /** Owner of the leaving permanent (CR 109.5). Stable through control
     *  changes; read by triggers like Personal Incarnation's "owner loses
     *  half their life" LTB. */
    ownerId: string;
    /** Card definition id (mirrors `card.id`) so type-based filters can run
     *  without re-reading the registry. */
    cardId?: string;
    /** Card types snapshotted at the moment of departure (CR 603.10). */
    types: ReadonlyArray<CardType>;
    /** Whether the leaving permanent was an Aura (CR 303.4). */
    wasAura: boolean;
    /** Host id the leaving Aura was attached to (CR 303.4b). Read by
     *  Animate Dead's LTB-trigger to identify the reanimated creature to
     *  sacrifice. Undefined for non-Aura permanents or unattached Auras. */
    attachedToBeforeLeave?: string;
    /** Destination zone of the move. */
    toZone: "graveyard" | "exile" | "hand" | "library";
    /** Why the permanent left the battlefield (CR 603.10). `"sacrifice"` is set
     *  only when the permanent was sacrificed (CR 701.16); every other exit
     *  (destruction, lethal-damage SBA, bounce, mill, exile) is left undefined.
     *  Read by leave-the-battlefield triggers that must distinguish sacrifice
     *  from other departures (Urza's Miter — "Whenever an artifact you control
     *  is put into a graveyard, if it wasn't sacrificed, ..."). */
    cause?: "sacrifice";
}

/** Spell-cast event emitted when a spell is put on the stack (CR 601.2i).
 *  Used by triggers like Verduran Enchantress ("whenever you cast an
 *  enchantment spell") and the sphere cycle ("whenever a player casts a
 *  [color] spell"). Carries the caster, the cast spell's stack item id, and
 *  the spell's types/subtypes/colors so `matches()` can filter without
 *  re-reading the card registry. */
export interface SpellCastEvent {
    type: "SPELL_CAST";
    /** Player who cast the spell. */
    casterId: string;
    /** Stack item id of the freshly-cast spell. */
    spellInstanceId: string;
    /** Card definition id of the spell. */
    spellCardId: string;
    /** Card types of the spell ("Instant", "Sorcery", "Creature", ...). */
    spellTypes: ReadonlyArray<CardType>;
    /** Card subtypes of the spell ("Goblin", "Aura", ...). */
    spellSubtypes: ReadonlyArray<string>;
    /** Colors derived from the spell's mana cost (CR 202.2). */
    spellColors: ReadonlyArray<Color>;
}

/** Tap event emitted whenever a permanent transitions from untapped to
 *  tapped (CR 701.20a). Carries `forMana: true` when the tap is paying the
 *  cost of a mana ability (CR 605) — the canonical "tapped for mana"
 *  trigger condition for Mana Flare, Manabarbs, Wild Growth. Emitted from
 *  every tap site (twiddle/spell tap, combat declaration, mana abilities,
 *  regen rider) so triggers like Lifetap ("becomes tapped") see them all. */
export interface PermanentTappedEvent {
    type: "PERMANENT_TAPPED";
    permanentId: string;
    controllerId: string;
    permanentTypes: ReadonlyArray<CardType>;
    permanentSubtypes: ReadonlyArray<string>;
    forMana: boolean;
    /** Mana produced by the activated ability that did this tap. Set only
     *  when `forMana` is true. Used by Mana Flare ("adds one mana of any
     *  type that land produced"). */
    manaProduced?: ManaCost;
}

/** Activated-ability-use event emitted when a permanent's activated ability
 *  (non-mana, `useStack: true`) is put on the stack, paid for, and committed
 *  (CR 602.1). This is the COMPLEMENT of `PERMANENT_TAPPED`: it fires only for
 *  abilities that do NOT have a {T} component in their cost, so the two events
 *  together let a card react to "tapped OR a non-tap ability activated"
 *  (Haunting Wind, Powerleech, Artifact Possession — Antiquities cluster B).
 *
 *  An ability with a {T} cost already emits `PERMANENT_TAPPED` from the tap
 *  itself, so emitting `ABILITY_ACTIVATED` there too would double-count; the
 *  emit site gates on `!ability.cost.tap`. Mana abilities (`useStack: false`)
 *  resolve immediately and never reach the commit site, so they never emit
 *  this event (their {T} taps still emit `PERMANENT_TAPPED` for "tapped for
 *  mana" triggers).
 *
 *  Carries the source permanent's controller/types/subtypes snapshotted at
 *  activation time (CR 603.10 last-known information) so `matches()` can filter
 *  on "your/an opponent's artifact" or "enchanted artifact" without re-reading
 *  the registry — mirroring the `PermanentTappedEvent` payload shape. */
export interface AbilityActivatedEvent {
    type: "ABILITY_ACTIVATED";
    /** Instance id of the permanent whose ability was activated. */
    permanentId: string;
    /** Controller of the source permanent at activation time. */
    controllerId: string;
    /** Card types of the source (CR 205), snapshotted at activation time. */
    permanentTypes: ReadonlyArray<CardType>;
    /** Card subtypes of the source (CR 205.3), snapshotted at activation. */
    permanentSubtypes: ReadonlyArray<string>;
    /** Id of the activated ability on the source's CardDefinition. Lets a
     *  trigger distinguish multiple abilities on one source if ever needed. */
    abilityId: string;
}

/** State trigger probe (CR 603.8) emitted at every stable checkpoint where a
 *  player would gain priority. Carries no payload — `matches()` reads
 *  `state` to decide whether the trigger condition is currently met. */
export interface StateCheckEvent {
    type: "STATE_CHECK";
}

/** Emitted when a triggered ability fizzles at resolution because its
 *  intervening-if condition (CR 603.4d) is false at that moment. The stack
 *  item is removed without invoking `resolve`; downstream triggers can react
 *  to the fizzle (and the game-events log records it). */
export interface TriggerFizzledEvent {
    type: "TRIGGER_FIZZLED";
    /** Instance id of the permanent that produced the trigger (the source on
     *  the battlefield at trigger time, not the stack item id). */
    triggerSourceId: string;
    /** Id of the triggered ability on the source's CardDefinition. */
    triggeredAbilityId: string;
    /** Why the trigger fizzled. Currently only intervening-if failure is
     *  modeled; further reasons (countered, illegal target) flow through
     *  other paths. */
    reason: "intervening-if-false";
}

/** Combat pairing event emitted once per attacker-blocker pair after the
 *  defending player confirms blockers (CR 509.1). Used by "blocks or becomes
 *  blocked by" triggers (Cockatrice, Thicket Basilisk). One event per pair
 *  lets the trigger match on its own involvement. */
/** Emitted once when the active player confirms their attacking creatures
 *  (CR 508.1). Drives "whenever one or more creatures you control attack"
 *  triggers (Raging River). Single event per declaration, carrying every
 *  attacker — not one per attacker — so the trigger fires once. */
export interface AttackersDeclaredEvent {
    type: "ATTACKERS_DECLARED";
    /** Controller of the attacking creatures (CR 508.1). */
    attackingPlayerId: string;
    /** Instance ids of the creatures declared as attackers this combat. */
    attackerIds: ReadonlyArray<string>;
}

export interface BlockersConfirmedEvent {
    type: "BLOCKERS_CONFIRMED";
    attackerId: string;
    attackerControllerId: string;
    attackerTypes: ReadonlyArray<CardType>;
    attackerSubtypes: ReadonlyArray<string>;
    blockerId: string;
    blockerControllerId: string;
    blockerTypes: ReadonlyArray<CardType>;
    blockerSubtypes: ReadonlyArray<string>;
}

export type GameEvent =
    | DamageDealtEvent
    | PhaseBeginEvent
    | CreatureDiedEvent
    | PermanentEnteredEvent
    | PermanentLeftEvent
    | SpellCastEvent
    | PermanentTappedEvent
    | AbilityActivatedEvent
    | StateCheckEvent
    | TriggerFizzledEvent
    | AttackersDeclaredEvent
    | BlockersConfirmedEvent;

/** Read-only window over the live `GameState` exposed to `matches()` for
 *  state triggers (CR 603.8). Kept narrow on purpose so card definitions can
 *  inspect persistent game conditions ("controller has no Islands",
 *  "opponent has 13 life") without coupling to engine-internal types. The
 *  engine passes its full `GameState` here at the call site — this view only
 *  describes the fields cards may rely on. */
export interface TriggerStateView {
    players: ReadonlyArray<{
        id: string;
        life: number;
        battlefield: ReadonlyArray<{
            id: string;
            controllerId: string;
            ownerId: string;
            types: ReadonlyArray<string>;
            subtypes: ReadonlyArray<string>;
            staticAbilities: ReadonlyArray<string>;
            /** True for tokens (CR 111). Exposed so state-trigger conditions
             *  can scope to "nontoken permanents" — Jihad's self-sacrifice
             *  clause. Populated from the raw `CardInstanceState`. */
            isToken?: boolean;
            /** Raw card definition reference — condition predicates read
             *  `manaCost` to derive color (CR 202.2). Populated from the raw
             *  `CardInstanceState` the engine passes through as the view. */
            card?: Record<string, unknown>;
        }>;
        hand: { readonly length: number };
        landsPlayedThisTurn?: number;
        /** Graveyard contents in stack order (index 0 = bottom, last = top).
         *  Exposed so graveyard-zone triggers can inspect card position —
         *  Nether Shadow needs "three or more creature cards above it"
         *  (CR 603.6e). Only the fields cards may rely on are surfaced. */
        graveyard?: ReadonlyArray<{
            id: string;
            ownerId: string;
            types: ReadonlyArray<string>;
        }>;
    }>;
    activePlayerId?: string;
}

export interface TriggeredAbility {
    id: string;
    /** Oracle text shown on the stack and in context menus. */
    oracleText: string;
    /** Which event kind can fire this ability. Used to index-filter before matches(). */
    event: GameEventType;
    /** Zone the source must be in for this ability to be scanned (CR 603.6e —
     *  abilities that function while the card is in a zone other than the
     *  battlefield). Defaults to the battlefield when omitted. `"graveyard"`
     *  opts the card into `collectTriggers`' graveyard scan path (Nether
     *  Shadow's upkeep self-reanimation). */
    zone?: "graveyard";
    /** True if `event` triggers this ability on the permanent carrying it.
     *  `state` is supplied for state triggers (CR 603.8) that need to inspect
     *  persistent game conditions. */
    matches: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Intervening-if condition (CR 603.4d). When defined, re-evaluated by
     *  the engine immediately before `resolve` runs. If it returns false the
     *  trigger fizzles: it leaves the stack without invoking `resolve`, and
     *  a `TRIGGER_FIZZLED` event is emitted so downstream triggers can
     *  react. Signature mirrors `matches` — `self` is sourced from the
     *  current battlefield (or last-known information if the source has
     *  since left). */
    interveningIf?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect run when the trigger resolves from the stack. */
    resolve: (ctx: SpellContext, event: GameEvent) => void;
    /** Retained when this permanent becomes a copy of another (CR 707.9d —
     *  "except it has this ability"). Vesuvan Doppelganger's upkeep re-copy
     *  trigger sets this so it keeps functioning after the copy overwrites the
     *  presented characteristics. Ignored for non-copies. */
    retainedThroughCopy?: boolean;
}

// --- Replacement effects (CR 614) ---
//
// Continuous effects that intercept a game event BEFORE the original action
// runs and either rewrite the event payload (e.g. damage redirected to a
// different target) or cancel the event entirely (e.g. lifegain replaced by
// drawing cards). Distinct from prevention effects (CR 615), which always
// cancel and never redirect, and from triggered abilities (CR 603), which
// fire AFTER the action and go on the stack. Order in the apply loop: CR
// 614 (replacement) → CR 615 (prevention) → original action.
//
// Engine iteration (CR 616): when an event fires, the loop scans active
// replacement effects on every battlefield permanent and applies matching
// ones one at a time, honoring CR 616.1d ("a replacement effect can only
// apply once per event"). The loop terminates when no further replacement
// matches the (possibly rewritten) event.

export type ReplacementEventKind =
    | "damage"
    | "lifegain"
    | "lifeloss"
    | "discard"
    | "lose-game"
    | "tap"
    | "destroy";

/** Damage event subject to CR 614 redirection / prevention. */
export interface DamageReplacementEvent {
    kind: "damage";
    /** Instance id of the permanent or stack item dealing the damage. Used by
     *  source-filtering replacements ("damage from a flying source" — Veteran
     *  Bodyguard) and to look up source characteristics via the registry. */
    sourceInstanceId: string;
    /** Source controller at the moment of the event (CR 109.5). */
    sourceControllerId: string;
    /** Colors of the source (CR 202.2). */
    sourceColors: ReadonlyArray<Color>;
    /** Card types of the source. */
    sourceTypes: ReadonlyArray<CardType>;
    /** Subtypes of the source (CR 205.3). Used to discriminate "damage a
     *  Desert would deal" (Camel, Desert Nomads). Optional for back-compat
     *  with synthetic events; populated by `runDamageReplacement`. */
    sourceSubtypes?: ReadonlyArray<string>;
    /** Static keyword abilities of the source (CR 702.x). Used to discriminate
     *  "damage from a flying source" etc. */
    sourceStaticAbilities: ReadonlyArray<string>;
    /** Target of the damage event. Mutable in the replacement loop —
     *  redirection rewrites this to point at a different player/permanent. */
    target: TargetSelection;
    /** Amount of damage. Mutable — preventNextN-style shields would normally
     *  decrement this here, but in the current engine prevention runs in CR
     *  615 outside the replacement loop. Effects that "deal that much damage
     *  to ~ instead" carry the amount unchanged. */
    amount: number;
    isCombat: boolean;
}

/** Life-change event: either lifegain (gainLife) or lifeloss (loseLife) on
 *  a specific player. Lich's "if you would gain life, draw cards instead"
 *  and "if you would lose life, sacrifice/discard instead" intercept these. */
export interface LifeChangeReplacementEvent {
    kind: "lifegain" | "lifeloss";
    playerId: string;
    amount: number;
}

/** Discard event: a specific card in a player's hand about to move to the
 *  graveyard. Library of Leng's "may put it on top of your library instead"
 *  intercepts this. The replacement chooses whether to redirect. */
export interface DiscardReplacementEvent {
    kind: "discard";
    playerId: string;
    cardInstanceId: string;
}

/** Game-loss event: a player about to lose the game from a CR 104 condition
 *  (life ≤ 0, drawing from empty library, etc.). Lich's "you don't lose the
 *  game" replacement consumes this event. */
export interface LoseGameReplacementEvent {
    kind: "lose-game";
    playerId: string;
    /** CR 104 reason. Currently only "life-zero" is intercepted in-engine. */
    reason: "life-zero";
}

/** Tap event: a permanent about to become tapped (CR 701.20a). Face-down
 *  permanents intercept this to turn face up first (CR 708, ADR 0013). The
 *  replacement does not cancel the tap — it turns the creature up and lets it
 *  become tapped as its real self. */
export interface TapReplacementEvent {
    kind: "tap";
    cardInstanceId: string;
}

/** Destroy event: a permanent about to be destroyed (CR 701.7). A
 *  replacement intercepts the destruction BEFORE it happens (CR 614),
 *  distinct from regeneration (CR 701.15, a specialised shield consulted
 *  inside `regenerateOrDestroy`). Pyramids' "the next time target land
 *  would be destroyed this turn" save runs as a transient destroy
 *  replacement; a permanent-bound `replacementEffects[]` entry with
 *  `eventKind: "destroy"` consumes this for an "if ~ would be destroyed,
 *  instead ..." continuous effect. See ADR 0020. */
export interface DestroyReplacementEvent {
    kind: "destroy";
    /** Instance id of the permanent about to be destroyed. */
    targetInstanceId: string;
}

export type ReplacementEvent =
    | DamageReplacementEvent
    | LifeChangeReplacementEvent
    | DiscardReplacementEvent
    | LoseGameReplacementEvent
    | TapReplacementEvent
    | DestroyReplacementEvent;

/** Side-effect mutators handed to a `ReplacementEffect.replace` body. Lets
 *  the effect issue follow-up actions ("draw N cards instead", "sacrifice
 *  these permanents", "move this card to library top") without coupling
 *  card definitions to the full engine surface. */
export interface ReplacementApplyContext {
    /** Player ids in active-then-non-active order (CR 101.4). */
    apNapOrder: () => string[];
    drawCards: (playerId: string, amount: number) => void;
    /** Sacrifices the first `count` non-token permanents on `playerId`'s
     *  battlefield matching `filter`, in battlefield-declaration order. Used
     *  by Lich's "sacrifice X nontoken permanents". Returns the number
     *  actually sacrificed (clamped to availability). */
    autoSacrifice: (
        playerId: string,
        count: number,
        filter?: PermanentFilter
    ) => number;
    /** Moves a hand card to the top of the player's library. Used by Library
     *  of Leng's discard replacement. */
    moveHandCardToLibraryTop: (
        playerId: string,
        cardInstanceId: string
    ) => boolean;
    /** Reveals a hand card to all players (logged in the event stream). The
     *  Library of Leng "may reveal that card" clause uses this. No engine
     *  state mutation — public information event for the UI. */
    revealHandCard: (playerId: string, cardInstanceId: string) => void;
    /** Direct life adjustment used by replacements that emit a different
     *  category of life-change (e.g. lifegain → draw N implicitly converts
     *  the gain to 0). Bypasses the replacement loop to avoid recursion. */
    adjustLifeRaw: (playerId: string, delta: number) => void;
    /** Removes up to `count` counters of `type` from the source permanent.
     *  Returns the number actually removed (clamped to availability). Used by
     *  Rock Hydra's damage→counter-removal replacement (CR 614.1a). */
    removeCounter: (type: string, count: number) => number;
    /** Turns the source permanent face up (CR 708.9, ADR 0013): clears the
     *  face-down marker, restores the real card's characteristics, and reveals
     *  it to both players. Returns the now-revealed creature's real power and
     *  toughness so a turn-up-on-damage replacement can deal/apply with the
     *  true values. No-op (returns the current P/T) if the source isn't face
     *  down. */
    turnSelfFaceUp: () => { power: number; toughness: number };
    /** Read-only inspector for state used by `appliesTo` predicates and by
     *  `replace` bodies that need to inspect the source's environment. */
    state: ReplacementStateView;
    /** The permanent carrying the replacement effect. */
    self: PermanentView;
}

/** Narrow read-only view of the live game state passed to replacement
 *  predicates and side-effect bodies. */
export interface ReplacementStateView {
    players: ReadonlyArray<{
        id: string;
        life: number;
        handSize: number;
        battlefield: ReadonlyArray<{
            id: string;
            controllerId: string;
            ownerId: string;
            types: ReadonlyArray<string>;
            subtypes: ReadonlyArray<string>;
            staticAbilities: ReadonlyArray<string>;
            isToken: boolean;
        }>;
        /** Per-player replacement preferences (CR "may" opt-ins). Read by
         *  Library of Leng's discard replacement to honor a player's
         *  toggled "send to graveyard instead" override. */
        preferences?: { libraryOfLengRouting?: "library" | "graveyard" };
    }>;
    /** Read-only snapshot of the active combat state (CR 506). Defined only
     *  during combat phases (DECLARE_ATTACKERS through END_OF_COMBAT). Read
     *  by Veteran Bodyguard's "damage from unblocked attacking creatures"
     *  filter. */
    combat?: {
        attackerIds: ReadonlyArray<string>;
        /** attackerId → ordered blocker ids (CR 509.2). Empty array means
         *  the attacker is unblocked. */
        blockersByAttacker: Readonly<Record<string, ReadonlyArray<string>>>;
        /** Declared attacking bands (CR 702.21e). Read by Camel to extend its
         *  Desert-damage prevention to the creatures banded with it. */
        bands?: ReadonlyArray<{ memberIds: ReadonlyArray<string> }>;
    };
}

/** Outcome of a `ReplacementEffect.replace` call. */
export type ReplacementResult =
    | { kind: "modified"; event: ReplacementEvent }
    | { kind: "consumed" };

export interface ReplacementEffect {
    id: string;
    oracleText: string;
    eventKind: ReplacementEventKind;
    /** Whether this replacement intercepts the given event. `self` is the
     *  permanent carrying the effect; `state` is a read-only view. */
    appliesTo: (
        event: ReplacementEvent,
        self: PermanentView,
        state: ReplacementStateView
    ) => boolean;
    /** Replace the event. Return `{ kind: "modified", event }` to rewrite
     *  the event (engine continues the replacement loop with the new
     *  payload). Return `{ kind: "consumed" }` to cancel the original
     *  action — the effect typically performs its own side-effects via
     *  `ctx` before returning consumed. */
    replace: (
        event: ReplacementEvent,
        ctx: ReplacementApplyContext
    ) => ReplacementResult;
}

/** Pump every attacking (or blocking) creature by a fixed amount until end of
 *  turn (CR 611.2). Drives Army of Allah (+2/+0 attackers) and Piety (+0/+3
 *  blockers). Parametric so future "all attackers/blockers get +X/+Y" cards are
 *  data rather than a duplicated resolve closure. */
export interface PumpCombatEffect {
    kind: "pump-combat";
    side: "attacking" | "blocking";
    power: number;
    toughness: number;
}

/** Declarative shorthand for one-effect resolve bodies. String values map to a
 *  closure in `convex/cards/effectRegistry.ts`; object values carry their own
 *  parameters. Add new shorthands as soon as the same `resolve` body repeats
 *  across two cards (rule of two extraction). */
export type EffectShorthand = "destroy-target" | PumpCombatEffect;

/** Opt-in structured AI combat hints (ADR 0021, issue #229). Declares the
 *  combat-relevant SHAPE of a card whose effect lives in an opaque imperative
 *  `resolve()` body, so the interaction-aware combat predictor can model the
 *  card while it is HELD in hand. Purely a prediction input — it never changes
 *  how the spell actually resolves. Each field is independent and optional; a
 *  card may carry one, both, or neither.
 *
 *    * `pump` — an until-end-of-turn power/toughness boost on a creature (a
 *      combat trick, e.g. Giant Growth `+3/+3`). The predictor adds it to a
 *      held-back attacker so an ambush attacker is no longer pre-judged dead,
 *      and to the threat a defender faces so over-committing blockers into a
 *      likely pump is discounted.
 *    * `removal` — an instant-speed effect that can kill a creature in combat
 *      (e.g. Lightning Bolt). The predictor lets a defender holding it remove a
 *      blocker (attacker connects) and discounts an over-committed block. The
 *      magnitude is intentionally coarse (a single creature removed), matching
 *      the crude, valuation-free combat predictor. */
export interface AiCombatHint {
    /** Until-end-of-turn stat boost this card grants when cast in combat. */
    pump?: { power: number; toughness: number };
    /** True if this card is instant-speed creature removal usable in combat. */
    removal?: boolean;
}

/** Full card definition used by the GRE. */
export interface CardDefinition {
    id: CardId;
    name: string;
    manaCost?: ManaCost;
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    loyalty?: number;
    /** AI valuation override (ADR 0018, the Forge `SVar:AI*` analog). When set,
     *  the shared `cardValue` primitive returns this Forge-scale worth verbatim
     *  instead of deriving one from the card's characteristics — the escape
     *  hatch for the bombs and duds the heuristic misjudges. Latent worth only
     *  (the bot's hand/library/graveyard valuation and resolution-choice
     *  ordering); the realized battlefield eval is unaffected. Optional and rare:
     *  derivation scales to the full catalog, this annotates just the
     *  exceptions. */
    aiValue?: number;
    /** Opt-in structured AI combat hints (ADR 0021, issue #229). Card effects
     *  are imperative `resolve()` bodies the bot search cannot introspect, so a
     *  card whose body is a combat trick or instant-speed removal declares the
     *  shape of that effect here. The interaction-aware combat predictor
     *  (`convex/gre/dangerClock.ts`) reads these hints off CASTABLE instants in
     *  the relevant player's hand (gated on enough open mana) to model held
     *  interaction in combat — an attacker's ambush pump (so a bait attacker is
     *  no longer pre-judged dead) and a defender's caution against committing
     *  blockers into a likely trick. ABSENCE of a hint = current behavior (the
     *  predictor ignores the card). Latent/predictive only — it never changes
     *  how a spell actually resolves. Optional and rare: only cards that matter
     *  to combat prediction need annotating. */
    aiCombatHint?: AiCombatHint;
    /** Printed Oracle text (read-only, display/reference only). Mirrors the
     *  card's printed rules text from Scryfall. The engine does NOT parse this
     *  string — behavior comes from `resolve`/`activatedAbilities`/etc.
     *  Surfaced in the card preview for spells (Instant/Sorcery), and useful
     *  for cross-checking implementation against the printed rules. */
    oracleText?: string;
    /** Target requirements declared at cast time (CR 601.2c). For modal
     *  spells (`modes` set), this is overridden by the chosen mode's
     *  `targetRequirement` — keep undefined on the card and put the per-mode
     *  requirements inside `modes[i].targetRequirement`. */
    targetRequirement?: TargetRequirement;
    /** Imperative resolve function — called when the spell resolves from the
     *  stack. For modal spells, this is bypassed: the chosen mode's
     *  `resolve` runs instead. */
    resolve?: (ctx: SpellContext) => void;
    /** Modal spell modes (CR 700.2). When set, the caster picks exactly one
     *  mode at announcement (CR 601.2b) — the chosen mode's
     *  `targetRequirement` drives target selection, and its `resolve` runs
     *  on stack resolution. The card-level `targetRequirement`/`resolve` are
     *  ignored. Only "choose one" is supported for now; "choose any number"
     *  / "choose one or both" / "choose X" can be added by extending this
     *  shape later. */
    modes?: SpellMode[];
    /** Declarative shorthand for spells whose entire effect maps to a single
     *  registered primitive (see `convex/cards/effectRegistry.ts`). The engine
     *  compiles the shorthand into a resolve closure at lookup time. Use this
     *  for vanilla effects ("destroy target X", "counter target spell") so the
     *  card definition stays pure data. Mutually exclusive with `resolve` and
     *  `resolveSteps` — combining them throws at lookup. */
    effect?: EffectShorthand;
    /** Multi-step resolve for spells that gather player choices mid-resolution
     *  (CR 608.2, 101.4). The engine runs steps in order; each step may call
     *  `SpellContext.requestChoice` to enqueue pending choices. When a step
     *  enqueues choices, the engine suspends and waits for
     *  `selectResolutionChoice` mutations. On resume, the same step is
     *  re-invoked — `requestChoice` now returns the stored selections, the
     *  step applies effects, and the engine advances to the next step.
     *
     *  Use `resolveSteps` XOR `resolve`. If both are present, `resolveSteps`
     *  wins. Used by Balance and similar "each player chooses / each player
     *  sacrifices" spells. */
    resolveSteps?: ((ctx: SpellContext) => void)[];
    /** Permanent enters the battlefield tapped (e.g. Nevinyrral's Disk). */
    entersTapped?: boolean;
    /** Tracks continuity of control like summoning sickness, even for
     *  noncreature permanents (CR 302.6 generalised). When set, the permanent
     *  enters with `isSummoningSick` and clears it at its controller's untap
     *  step, so an activated ability can gate on "controlled continuously since
     *  your most recent turn began" via `canActivate: (s) => !s.isSummoningSick`
     *  combined with `controllerTurnOnly`. Used by Rocket Launcher. */
    tracksControlContinuity?: boolean;
    /** Counters placed on the permanent when it enters the battlefield
     *  (CR 122.1, 614.1c). Each entry is a counter type and a count, where
     *  `count: "X"` reads the value chosen for X at cast time (CR 107.3).
     *  Applied by
     *  `finalizeSpellResolution` after the permanent is on the battlefield. */
    entersWith?: { counters?: { type: string; count: number | "X" }[] };
    staticAbilities?: string[];
    /** Continuous static effects (CR 611). Applied at stat-read time by the layer system. */
    staticEffects?: StaticEffect[];
    activatedAbilities?: ActivatedAbility[];
    /** Activated-ability templates GRANTED to other permanents by a
     *  StaticActivatedGrant on this card's `staticEffects` (CR 113.1, 611).
     *  Kept separate from `activatedAbilities` so the source itself does not
     *  expose them as native activated abilities — only matching permanents
     *  receive a reference via `grantedActivatedAbilities`. The `id` on each
     *  template is the value referenced by the grant's `abilityId` field. */
    grantTemplates?: ActivatedAbility[];
    triggeredAbilities?: TriggeredAbility[];
    /** Triggered-ability templates GRANTED to other permanents by a
     *  StaticTriggeredGrant on this card's `staticEffects` (CR 113.1, 611).
     *  Kept separate from `triggeredAbilities` so the source itself does not
     *  fire the granted trigger — only matching permanents receive a reference
     *  via `grantedTriggeredAbilities` and are scanned for it by the trigger
     *  collector. The `id` on each template is the value referenced by the
     *  grant's `abilityId` field. Used by Energy Flux. */
    triggeredGrantTemplates?: TriggeredAbility[];
    /** Continuous replacement effects (CR 614). Each effect declares the kind
     *  of game event it can intercept ("damage", "lifegain", "lifeloss",
     *  "discard", "lose-game"), an `appliesTo` predicate that filters by event
     *  payload, and a `replace` body that mutates / cancels the event before
     *  the original action runs. Multiple replacements compose (CR 616) — the
     *  engine iterates until no more apply, honoring CR 616.1d (a given
     *  replacement applies at most once per event).
     *
     *  Active only while the permanent is on the battlefield; the engine
     *  scans `state.players[*].battlefield` for sources at each event point.
     *  Used by Lich (lifegain→draw, lifeloss→sacrifice, lose-game cancel),
     *  Simulacrum / Veteran Bodyguard / Personal Incarnation (damage
     *  redirect), Library of Leng (discard→top-of-library). */
    replacementEffects?: ReplacementEffect[];
    /** Delayed triggered ability templates (CR 603.7a) scheduled by this
     *  card's `resolve()`. Looked up by id when a queued instance fires. */
    delayedTriggers?: DelayedTriggerDef[];
    sbaMods?: string[];
    /** Additional costs to cast this spell (CR 117.9 / 601.2f). Paid at cast
     *  time, NOT at resolve. The chooser picks a permanent matching
     *  `sacrificeFilter` on their own battlefield; the cast is illegal if no
     *  matching permanent exists (CR 117.9). The picked permanent is
     *  sacrificed on commit and its pre-sacrifice mana value is snapshotted
     *  on the stack item so `SpellContext.getAdditionalSacrificeMv()` can
     *  read it at resolve. Used by Sacrifice ("As an additional cost,
     *  sacrifice a creature. Add an amount of {B} equal to the sacrificed
     *  creature's mana value"). Currently exclusive with
     *  `targetRequirement` — combining the two would need a third pending
     *  state. */
    additionalCosts?: {
        sacrificeFilter: PermanentFilter;
    };
    /** Adds this many generic mana to the total cost for each target beyond
     *  the first (CR 601.2f). Used by Fireball ("costs {1} more to cast for
     *  each target beyond the first"). */
    additionalGenericPerExtraTarget?: number;
    /** Restricts cast timing to a specific subset of phases (CR 117.1b).
     *  When set, the spell is castable only while `state.phase` is in this
     *  list. Used by Berserk ("cast only before the combat damage step") —
     *  the instant-speed check still applies, this only narrows further. */
    castPhaseRestriction?: Phase[];
    /** When true, the normal draw at draw step is suppressed if the controller
     *  controls this permanent. A phaseTrigger at DRAW handles the choice
     *  (skip or draw). Used by Island Sanctuary. */
    drawStepReplacement?: boolean;
    /** Restricts cast timing to the opponent's turn only (Siren's Call). */
    castTurnRestriction?: "opponent";
    /** Extra land drops per turn granted to the controller while this permanent
     *  is on the battlefield (CR 305.2 — Fastbond). Added to LAND_DROPS_PER_TURN
     *  at land-play legality check time. Use 999 for unlimited. */
    extraLandDrops?: number;
    /** CR 702.16n — an Aura that grants the enchanted permanent protection
     *  from its own color (e.g. White Ward gives pro-white and is itself
     *  white) normally falls off via 702.16c. Cards with this flag carry
     *  the "this effect doesn't remove this Aura" rider and bypass the
     *  protection-detach SBA. Note: the CR exempts only the self-referential
     *  case; other instances of the same protection on the host still cause
     *  even an exempt aura to detach, but no multi-source protection cards
     *  exist in the current set, so we model this as a flat exemption. */
    exemptFromProtectionDetach?: boolean;
    /** Number of additional creatures this permanent can block beyond the
     *  default of 1 (CR 509.1a). E.g. Two-Headed Giant of Foriys declares 1,
     *  meaning it can block 2 total. The combat validator reads this from the
     *  card definition; temporary grants (Blaze of Glory) set
     *  `CardInstanceState.canBlockAdditional` instead. */
    canBlockAdditional?: number;
    /** For synthesized token CardDefinitions (CR 111, 707.1): Scryfall id of
     *  a printed token card to use as the visual representation. The card
     *  image layer prefers this over the def's own id when fetching art —
     *  printed tokens come from later sets (10E for Alpha cards), so the
     *  Alpha-era card has no token image of its own. Undefined for non-token
     *  defs and for tokens with no printed art (the placeholder renderer
     *  takes over in that case). */
    imagePrintId?: string;
}

/** Reprint of an existing `CardDefinition` in another set. The mechanics are
 *  defined exactly once on the original `CardDefinition`; reprints declare
 *  only the metadata that varies between physical printings: a per-print
 *  Scryfall UUID (used for the card image) and the set code.
 *
 *  Resolution: the card registry maps both `CardDefinition.id` and every
 *  `CardPrint.printId` to the same underlying `CardDefinition`, so a
 *  `getCardById(printId)` lookup transparently returns the original
 *  mechanics regardless of which printing the deck/instance references.
 *  The instance retains the print's id (`card.id === printId`) so the image
 *  layer renders the chosen edition's art. */
export interface CardPrint {
    /** Per-print Scryfall UUID. Used as the image lookup key and as the id
     *  stored on `CardInstanceState.card.id` when the player picks this
     *  edition. Must be globally unique across all sets. */
    printId: CardId;
    /** Id of the original `CardDefinition` whose mechanics this print uses
     *  (typically the LEA print's Scryfall UUID for cards first printed in
     *  Alpha). The registry resolves `printId → definitionId → CardDefinition`. */
    definitionId: CardId;
    /** Lowercase set code of this printing (e.g. "leb", "2ed"). Informational
     *  — used by the deck builder UI to label the print. */
    setCode: string;
}
