import type {
    Phase,
    Zone,
    ZonePickKind,
    ManaRestriction,
    PhaseReturnCondition,
    PhaseInRider,
    LibraryDestination,
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

/** A continuous land-mana colour substitution (CR 614 — a replacement of the
 *  mana a land produces). Active while the declaring permanent is on the
 *  battlefield; the engine scans every battlefield for sources at each tap and
 *  rewrites the mana a LAND is about to add to the pool. Two shapes:
 *
 *  - `color` — a single-colour override: ANY land tapped for mana produces that
 *    colour instead of any other type, in the same TOTAL quantity (Infernal
 *    Darkness, "If a land is tapped for mana, it produces {B} instead of any
 *    other type"). The type changes, the amount does not.
 *  - `byBasicSubtype` — a per-basic-subtype permutation: a land whose subtypes
 *    include a listed basic land subtype produces the mapped colour instead
 *    (Naked Singularity, "Plains produce {R}, Islands produce {G}, …"). A land
 *    whose subtype is not in the map is unaffected by THIS source.
 *
 *  Exactly one of `color` / `byBasicSubtype` is set. The substitution is
 *  global (it affects every player's lands, like the printed cards), so the
 *  source's controller is not consulted. Multiple active substitutions apply in
 *  timestamp order; the engine applies them in battlefield order (CR 614.1
 *  layering of replacements is not modelled to the letter — the cards in scope
 *  never overlap on a single land in a legal board). */
export type LandManaSubstitution =
    | { color: Color }
    | { byBasicSubtype: Partial<Record<string, Color>> };

export type ManaCost = {
    X?: number | string;
    W?: number;
    U?: number;
    B?: number;
    R?: number;
    G?: number;
    C?: number;
    /** Fixed generic mana that coexists with a VARIABLE `{X}` pip (CR 107.3 /
     *  202.3). The `X` field doubles as the generic-mana slot when it is a
     *  number, so a cost that has BOTH a variable `{X}` and printed generic —
     *  e.g. Soul Burn's `{X}{2}{B}` — cannot encode the `{2}` in `X` (that slot
     *  holds the variable marker `"X"`). `generic` carries the fixed portion;
     *  `normalizeManaCost` folds it into the total generic alongside the chosen
     *  X, and `manaValue` counts it toward the printed mana value (variable X
     *  still contributes 0). Omit (or 0) when there is no fixed generic. */
    generic?: number;
    /** How many times the chosen X is added to the generic cost when `X` is
     *  the variable `"X"` (CR 107.3). Defaults to 1; set to 2 for `{X}{X}`
     *  costs (Recall — "{X}{X}{U}") so the player pays twice the announced X.
     *  Ignored when `X` is a fixed number (plain generic mana). The printed
     *  mana value (`manaValue`) still treats variable X as 0 regardless of the
     *  factor (CR 202.3b). */
    xFactor?: number;
    /** CR 107.4f / 118.? — Phyrexian mana pips ({C/P}). Each entry is the NUMBER
     *  of `{<color>/P}` symbols in the printed cost (Dismember `{1}{B/P}{B/P}` →
     *  `{ B: 2 }`, Gitaxian Probe `{U/P}` → `{ U: 1 }`). A Phyrexian pip is paid
     *  at cast time with EITHER one mana of the indicated colour OR 2 life — the
     *  caster's per-pip choice. This field only DECLARES the pips; the mana-vs-
     *  life split is resolved in the cost system (`convex/gre/phyrexian.ts`,
     *  threaded through `announceCast` as `phyrexianLifePips`), never here.
     *  `normalizeManaCost` deliberately IGNORES this field (Phyrexian pips are
     *  not part of the fixed mana requirement); `manaValue` counts each pip as 1
     *  (CR 202.3f — the symbol is valued as its colour, without the `/P`), and
     *  the card's colour identity (`getColorsFromCost`) includes these colours
     *  (CR 105.2 — a Phyrexian symbol is a coloured mana symbol). Not a Mechanics
     *  Registry keyword and not an Effect Script Op — pure cost-system infra. */
    phyrexian?: Partial<Record<Color, number>>;
};

/** CR 702.34a / 118.5 — the full Flashback cost, generalizing the mana-only
 *  `CardDefinition.flashback?: ManaCost` to carry an optional NON-mana cost
 *  component that applies ONLY on the flashback (graveyard) cast, never on the
 *  card's normal hand cast. A card whose flashback cost is purely mana can still
 *  set `flashback` to a bare `ManaCost` — the engine normalizes both shapes
 *  (`convex/gre/flashback.ts` → `normalizeFlashbackCost`). All additional costs
 *  reuse existing cost machinery scoped to the flashback cast path only:
 *  `sacrifice` routes through the unified sacrificeChoice layer (always an
 *  explicit player choice, CR 701.21a), `exileFromHand` through the flashback
 *  exile-cost picker. Used by Lava Dart ("Flashback—Sacrifice a Mountain",
 *  no mana). */
export interface FlashbackCost {
    /** The mana portion of the flashback cost, if any. Absent for a purely
     *  non-mana flashback cost (Lava Dart pays only "Sacrifice a Mountain"). */
    mana?: ManaCost;
    /** CR 702.34a / 118.5 — "Sacrifice a <filter>" flashback-only additional
     *  cost (Lava Dart: "Sacrifice a Mountain"). The caster picks WHICH matching
     *  permanent to sacrifice through the unified sacrificeChoice layer — never
     *  auto-picked. Exactly one permanent is sacrificed per flashback cast. */
    sacrifice?: PermanentFilter;
    /** CR 702.34a / 118.5 — "Exile a <colour> card from your hand" flashback-only
     *  additional cost. The caster exiles exactly one matching card from their
     *  own hand via the flashback exile-cost picker. `color` filters the
     *  eligible cards (CR 105.2); omit for any card. */
    exileFromHand?: { color?: Color };
}

/** CR 702.138 — Escape. A card with escape may be cast from its owner's
 *  graveyard by paying its ESCAPE COST: a mana cost PLUS exiling OTHER cards
 *  from that graveyard (CR 702.138a). A permanent cast this way "escaped"
 *  (CR 702.138e) — a flag the resulting permanent carries
 *  (`CardInstanceState.escaped`), read by "as long as ~ escaped" /
 *  "sacrifice it unless it escaped" clauses (Uro, Phlage, Nethergoyf).
 *  Unlike Flashback (CR 702.34), an escaped card is NOT exiled as it resolves —
 *  it moves graveyard → stack → its normal destination (battlefield for a
 *  permanent, graveyard for an instant/sorcery). Read by
 *  `convex/gre/escape.ts`. */
export interface EscapeCost {
    /** The mana portion of the escape cost (CR 702.138a). */
    mana: ManaCost;
    /** CR 702.138a — exile OTHER cards from the caster's graveyard as an
     *  additional cost; the escaping card itself is never eligible ("other
     *  cards"). Two shapes:
     *   - FIXED count ("exile three/five other cards", Uro / Phlage /
     *     Underworld Breach): `{ count: N }`.
     *   - VARIABLE, card-type-constrained ("exile any number of other cards …
     *     with four or more card types among them", Nethergoyf):
     *     `{ minCardTypes: N }` — the caster exiles any number (≥1) of other
     *     graveyard cards whose combined distinct card types number ≥ N. */
    exile: { count: number } | { minCardTypes: number };
}

/** CR 702.33 — Kicker. An OPTIONAL additional cost the caster may choose to pay
 *  as they cast the spell ("You may pay an additional [cost] as you cast this
 *  spell"). Paid ON TOP of the mana cost at cast time (unlike an
 *  {@link AlternativeCost}, which replaces it). Whether the spell was kicked is
 *  snapshotted on the resulting stack item (`StackItem.kickerCount`) and read at
 *  resolution — DSL scripts branch on it with the `{ kickerCount: true }`
 *  value ({@link EffectKickerCountValue}). Kicker is a cost-system / keyword-cast
 *  capability (engine infra), NOT an Effect Script Op.
 *
 *  - single Kicker (Overload, Burst Lightning, Bloodchief's Thirst, Tear
 *    Asunder, Consult the Star Charts): kicked at most once → `kickerCount` is
 *    0 (not kicked) or 1 (kicked).
 *  - Multikicker (CR 702.33e — Everflowing Chalice): `multi: true` lets the
 *    caster pay the kicker cost any number of times; `kickerCount` records how
 *    many times it was paid. */
export interface KickerCost {
    /** The additional mana cost paid per kick (CR 702.33a). */
    cost: ManaCost;
    /** CR 702.33e — Multikicker: the kicker cost may be paid any number of
     *  times as the spell is cast. Omitted/false = a single kicker (paid at most
     *  once). */
    multi?: boolean;
}

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

/** The complete set of permanent card types (CR 300.1) — the card types that
 *  represent a permanent on the battlefield: artifact, battle, creature,
 *  enchantment, land, and planeswalker. This is the correct target set for
 *  "target permanent" of any type (Boomerang, Vindicate, Obelisk of Undoing)
 *  and for a "permanent card" zone-change test (ECL Moonshadow). Lives in the
 *  leaf `types` module (no runtime imports) so card sets can reference it
 *  without forming a registry import cycle. Re-exported from `gre/constants`.
 *
 *  NOTE: distinct from `CASTABLE_PERMANENT_TYPES` in `gre/constants`, which
 *  deliberately EXCLUDES Land because it scopes "types a resolving STACK ITEM
 *  can become" — lands are never cast (CR 305.1), so never appear on the
 *  stack. Use this full list wherever CR 300.1 permanence is meant. */
export const PERMANENT_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
] as const satisfies readonly CardType[];

export type CardSupertype =
    | "Basic"
    | "Legendary"
    | "Ongoing"
    | "Snow"
    | "World";

/** Printed rarity of a card (CR 206). Rarity is a property of a *printing*,
 *  not of the underlying card — a card reprinted at a different rarity carries
 *  a different `rarity` on each `CardPrint`. Restricted to the three classic
 *  rarities used by the implemented sets (LEA–LEG era); modern "mythic" /
 *  "special" / "bonus" can be added when those sets ship. Consumed by
 *  rarity-budgeted Formats (Alpha 40, ADR 0036). Informational for Basic
 *  lands — they are gated by the `Basic` supertype, not by rarity. `"mythic"`
 *  ships with the cross-set worklist work (ADR 0041) — Vintage Cube draws
 *  heavily on modern mythics; the LEA–LEG sets never use it, and the Alpha 40
 *  rarity budget (commons/uncommons/rares only) is unaffected. `"special"` /
 *  `"bonus"` remain unmodelled — the import tool bails loudly on them. */
export type Rarity = "common" | "uncommon" | "rare" | "mythic";

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
    /** If set, restricts legal targets to permanents and stack spells that are
     *  AT LEAST ONE of the listed colors (CR 202.2 — OR semantics). Used by
     *  multi-color "source of your choice" choices such as Greater Realm of
     *  Preservation ("a black or red source of your choice"). Players are never
     *  a legal target when this is set (a player isn't a colored source).
     *  Orthogonal to the single-color `colorFilter` — set one or the other. */
    colorFilterAny?: ReadonlyArray<Color>;
    /** Restricts legal permanent targets to those whose `subtypes` include at
     *  least one of these (CR 205.3). Single string is a shorthand for one
     *  subtype. Used by spells like Volcanic Eruption ("X target Mountains")
     *  or Stone Rain ("target land" with no extra subtype constraint — that
     *  case omits this field). Ignored for player / spell / graveyard targets. */
    subtypeFilter?: string | string[];
    /** Restricts legal permanent targets to those that have ALL of these
     *  supertypes (CR 205.4a). Read against the LIVE supertype status so
     *  Melting / Arcum's Weathervane mutations are honored. Used by Avalanche
     *  ("X target snow lands"). Single string is shorthand for one supertype.
     *  Ignored for player / spell / graveyard targets. */
    supertypeFilter?: CardSupertype | CardSupertype[];
    /** Excludes legal permanent targets that have ANY of these supertypes
     *  (CR 205.4a — the negative of `supertypeFilter`). Read against the LIVE
     *  supertype status, same as `supertypeFilter`. Used by "target nonbasic
     *  land" (Wasteland) — `excludeSupertypes: "Basic"`. Single string is
     *  shorthand for one supertype. Ignored for player / spell / graveyard
     *  targets. */
    excludeSupertypes?: CardSupertype | CardSupertype[];
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
     *  Default "any". Honored for graveyard targets (Regrowth), for
     *  battlefield-permanent targets (Simulacrum: "target creature you
     *  control"), and for PLAYER targets (CR 115 — "target opponent", Word of
     *  Command; "you" keeps only the caster). Ignored for spell targets.
     *
     *  `"active"` restricts to permanents controlled by the ACTIVE player
     *  (CR 102.1) — independent of who is choosing. Used by "target creature
     *  the active player controls" abilities that any player may activate
     *  (Arcum's Whistle). */
    controller?: "you" | "opponent" | "any" | "active";
    /** Restricts legal permanent targets by live combat role (CR 508.1,
     *  509.1). "attacking" requires `isAttacking === true`; "blocking"
     *  requires `isBlocking === true`. Used by Righteousness ("target
     *  blocking creature"). An array matches ANY listed role (OR semantics) —
     *  "target attacking or blocking creature" (D'Avenant Archer). Ignored for
     *  player / spell / graveyard targets. */
    combatRoleFilter?: "attacking" | "blocking" | ("attacking" | "blocking")[];
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
    /** Excludes legal permanent targets whose `staticAbilities` include this
     *  keyword (CR 702 — the negative of `requireAbility`). Used by Flood
     *  ("tap target creature without flying"). Ignored for player / spell
     *  targets. */
    excludeAbility?: string;
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
    /** Restricts legal SPELL targets (`type: "spell"`) to spells whose card
     *  type does NOT include any of these (CR 114.1 — the negative of
     *  `spellTypeFilter`). Used by Spell Pierce ("target noncreature spell").
     *  An ability on the stack is never a legal target here (it isn't a
     *  spell — CR 113.7a). Single string is shorthand for one type. Ignored
     *  for non-spell target types. */
    spellExcludeTypeFilter?: CardType | CardType[];
    /** Restricts legal SPELL targets (`type: "spell"`) to CREATURE spells
     *  whose power OR toughness (CR 114.1 + 208.2 — the values on the card
     *  itself; a spell isn't a permanent yet, so no continuous effect applies)
     *  is at most this number. Matches EITHER characteristic (an "or"
     *  comparison, not "and" — mirrors the oracle phrasing "with power or
     *  toughness N or less"). A stack item that isn't a creature spell (or an
     *  ability) never qualifies. Used by Stern Scolding ("Counter target
     *  creature spell with power or toughness 2 or less") — pair with
     *  `spellTypeFilter: "Creature"`. Ignored for non-spell target types. */
    spellCreaturePtFilter?: { maxPowerOrToughness: number };
    /** Restricts legal PLAYER targets to players who attacked this turn
     *  (CR 506.2). A player "attacked this turn" iff they control a creature
     *  whose `hasAttackedThisTurn` flag is set (the flag persists from declare
     *  attackers through CLEANUP — see `phases.ts`). Used by Fire and Brimstone
     *  ("target player who attacked this turn"). Ignored for non-player target
     *  types. */
    playerAttackedThisTurn?: boolean;
    /** Restricts legal SPELL targets (`type: "spell"`) to spells that have
     *  EXACTLY ONE target and whose single target IS the source's controller
     *  (the activating player). Used by Reflecting Mirror ("target spell with a
     *  single target if that target is you", CR 114.1 / 115.10). Ignored for
     *  non-spell target types. */
    spellSingleTargetingController?: boolean;
    /** Divide-as-you-choose marker (CR 601.2d / 120.4). When set, this spell
     *  divides a fixed total of damage / counters among the chosen targets,
     *  each target getting at least 1. `total` resolves the budget:
     *    - a number — fixed total (Fiery Justice = 5);
     *    - `"X"` — the chosen / derived X (Fire Covenant, Spoils of War);
     *    - `"X+1"` — X plus one (Meteor Shower — "X plus 1 damage").
     *  The engine caps the selectable target count at the total (you can't pick
     *  more targets than there are points to assign, since each needs ≥ 1) and
     *  drives the per-target amount UI. The resolved total flows to
     *  `PendingTarget.divideTotal` and the assigned split to the stack item's
     *  `targetAmounts`. `count` should be `{ min: 1 }` (open-ended). */
    divideAsChosen?: { total: number | "X" | "X+1" };
    /** Restricts legal SPELL targets (`type: "spell"`) to spells that WOULD
     *  destroy a land the activating player controls (CR 114.1 + 701.7). A
     *  spell qualifies when either:
     *    - it has `effect: "destroy-target"` and one of its chosen targets is a
     *      Land the activating player controls, or
     *    - its definition is flagged `destroysAllLands` (mass land destruction)
     *      and the activating player controls at least one land.
     *  Used by Equinox's granted "{T}: Counter target spell if it would destroy
     *  a land you control." Evaluated by `spellWouldDestroyLandControlledBy` in
     *  `gre/rules.ts`. Ignored for non-spell target types. */
    spellWouldDestroyLandYouControl?: boolean;
    /** Restricts a stack-object target (`type: "spell"`) by object KIND
     *  (CR 113 / 114.1). Omitted = SPELLS ONLY — a "target spell" targets a
     *  spell, never an ability (CR 701.5a; a triggered/activated ability on the
     *  stack is not a legal target for Counterspell et al.). `"spell"` is the
     *  explicit form of that same spell-only default. `"activated-ability"`
     *  instead keeps ONLY activated abilities on the stack (CR 602 / 113.3 — the
     *  stack item carries an `abilityId`); used by Brown Ouphe ("Counter target
     *  activated ability from an artifact source"). `"ability"` keeps ANY
     *  ability — activated OR triggered (and delayed) — but no spells; used by
     *  Stifle ("Counter target activated or triggered ability"). Abilities are
     *  legal targets ONLY under an explicit ability kind. Mana abilities never
     *  use the stack (CR 605.3a), so they are never a legal target regardless.
     *  Ignored for non-spell target types. */
    spellStackKind?: "spell" | "activated-ability" | "ability";
    /** Restricts a stack-object target (`type: "spell"`) to objects whose
     *  SOURCE card types include at least one of these (CR 113.7a). An
     *  activated ability on the stack carries the source permanent's card
     *  characteristics, so this reads the stack item's live `types`. Used by
     *  Brown Ouphe ("...from an artifact source"). Single string is shorthand
     *  for one type. Ignored for non-spell target types. */
    stackSourceTypeFilter?: CardType | CardType[];
    /** Restricts a stack SPELL target (`type: "spell"`) to spells that target
     *  at least one of these permanent instance ids (CR 114.1). Injected at
     *  activation time via a dynamic `getTargetRequirement` with the source's
     *  own id. Used by Mistfolk ("Counter target spell that targets this
     *  creature"). Abilities on the stack never qualify. Ignored for non-spell
     *  target types. */
    spellTargetsInstanceIds?: ReadonlyArray<string>;
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
 *    (Old Man of the Sea).
 *  - `source-tapped`: holds while the source is simply tapped, with no power
 *    constraint (Preacher — "for as long as this creature remains tapped"). */
export type ControlChangeCondition =
    | { kind: "controller-controls-source"; controllerId: string }
    | { kind: "source-tapped-and-power-ge" }
    | { kind: "source-tapped" };

/** JSON-pure "for as long as" duration discriminator for the `gainControl`
 *  Effect Script Op (ADR 0045, issue #848). Each member maps 1:1 onto a
 *  `ControlChangeCondition` kind that the conditional-control SBA re-evaluates
 *  (CR 611.2b); the Op interpreter builds the runtime condition (filling in the
 *  new controller id where the kind needs it). Omitting `duration` on the Op is
 *  the INDEFINITE reassignment (no condition — the Ghazbán Ogre shape). The
 *  member set mirrors `ControlChangeCondition` exactly (minus the "for as long
 *  as you control the source" controllerId, which the interpreter fills from
 *  the resolved new controller):
 *  - `while-you-control-source` → `controller-controls-source` (Aladdin,
 *    Thrull Champion — "for as long as you control this creature").
 *  - `while-source-tapped` → `source-tapped` (Preacher, Seasinger — "for as
 *    long as this creature remains tapped").
 *  - `while-source-tapped-and-power-ge` → `source-tapped-and-power-ge` (Old Man
 *    of the Sea — tapped AND the target's power ≤ the source's power).
 *  There is deliberately NO "until end of turn" member: `ControlChangeCondition`
 *  has no EOT variant (Ray of Command / Magus of the Unseen stay `resolve()`,
 *  issue #730). */
export type GainControlDuration =
    | "while-you-control-source"
    | "while-source-tapped"
    | "while-source-tapped-and-power-ge";

/** Where a COUNTERED SPELL ends up instead of CR 701.5a's default owner's
 *  graveyard (issue #683's "if that spell is countered this way, …" clause —
 *  No More Lies "exile it", Memory Lapse "put it on top of its owner's
 *  library", Remand "put it into its owner's hand"). `"graveyard"` is the
 *  CR 701.5a default; every other member is a `moveZone`-style destination
 *  applied to the stack item at the moment it's removed from the stack
 *  (before a plain `moveZone` Op could reach it — a spell on the stack isn't
 *  one of `moveZone`'s recognized object kinds). */
export type CounterDestination = "graveyard" | "exile" | "hand" | "library-top";

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
        /** "Tap N untapped permanents matching <filter> you control" as an
         *  activation cost (CR 602.1, 118.8). The activating player chooses
         *  which `count` untapped permanents to tap while paying the cost; the
         *  activation is illegal unless at least `count` untapped permanents on
         *  their battlefield match the filter. Distinct from `tap` (which taps
         *  THIS source): the source is excluded from the candidate pool, so a
         *  card with both `tap: true` and `tapOtherFilter` taps itself PLUS the
         *  chosen others (Hand of Justice — "{T}, Tap three untapped white
         *  creatures you control: Destroy target creature"). The filter is
         *  evaluated with the activating player as the controller-relation
         *  reference, so `controllerRelation: "you"` resolves to the activator.
         *  Reused by FEM's Vodalian War Machine ("Tap an untapped Merfolk you
         *  control"). */
        tapOtherFilter?: { filter: PermanentFilter; count: number };
        /** Life payment (CR 118.4). Legal while `player.life >= life`; SBA
         *  handles the loss if payment takes life to 0 or below. */
        life?: number;
        /** Loyalty cost of a LOYALTY ABILITY (CR 606). A SIGNED integer that is
         *  the whole marker of a loyalty ability: `+N` puts N loyalty counters
         *  on the source, `-N` removes N, `0` is neutral. Its mere presence (a
         *  planeswalker's activated ability) makes the engine derive the three
         *  loyalty restrictions from it, so no separate flags are needed
         *  (`game.ts` `assertLoyaltyActivationLegal`):
         *   - sorcery-speed only, and only the source's controller during their
         *     own main phase with an empty stack (CR 606.3, reuses
         *     `isSorceryTiming`);
         *   - at most one loyalty ability of a given permanent per turn
         *     (CR 606.3, per-instance `loyaltyActivatedThisTurn`);
         *   - a `-N` cost is illegal if it would take the permanent below 0
         *     loyalty (CR 606.5).
         *  Paid at activation commit by adjusting `counters["loyalty"]`
         *  (`payLoyaltyCost`) — the same counters map starting loyalty is placed
         *  in (CR 306.5b). A loyalty ability has no mana/tap component, so it
         *  never enters the `pendingActivation` deferred-payment path. */
        loyalty?: number;
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
        /** "Discard this card" as an activation cost (CR 702.29a / 118.3 — the
         *  Cycling cost's non-mana component). The SOURCE card itself is
         *  discarded from its owner's hand as the ability goes on the stack.
         *  Only meaningful together with `activateFromHand: true` (the source
         *  lives in hand). Routed through the shared discard choke point
         *  (`discardToGraveyard`) so it honors CR 614 discard replacements
         *  (Library of Leng) and emits CARD_DISCARDED (CR 701.8) — a card
         *  cycled while Marauding Mako is in play triggers its
         *  "whenever you discard" ability. Distinct from `sacrifice` (which
         *  sacrifices THIS source from the battlefield). Used by every Cycling
         *  card. */
        discardThis?: boolean;
        /** "Discard N cards at random" cost (CR 118.3 / 701.8 — an additional
         *  cost paid by discarding randomly-chosen cards). The ability is only
         *  legal to activate while the activating player has at least one card
         *  in hand; `count` cards (clamped to hand size) are discarded at
         *  random, using the game's seeded PRNG, at activation commit. Used by
         *  Coral Helm ("Discard a card at random: target creature gets +2/+2"). */
        discardAtRandom?: number;
        /** "Discard a card matching <filter>" as an activation cost (CR 602.1,
         *  118.3 — an additional cost paid by discarding a CHOSEN card from
         *  hand, as opposed to `discardLastDrawn` — a fixed card — or
         *  `discardAtRandom` — no choice). The activating player picks WHICH
         *  `count` matching card(s) in their hand to discard while paying the
         *  cost (never auto-picked — a real player choice through a dedicated
         *  picker, `selectActivationDiscardCost`, mirroring `sacrificeFilter`'s
         *  player-choice discipline); the activation is illegal unless at
         *  least `count` cards in hand match `filter`. Routed through the
         *  shared discard choke point (`discardToGraveyard`) so it honors CR
         *  614 discard replacements (Library of Leng) and emits
         *  CARD_DISCARDED (CR 701.8). Used by Survival of the Fittest
         *  ("Discard a creature card: …", issue #901). */
        discardFilter?: { filter: EffectCardFilter; count: number };
        /** "Exile N cards from a single graveyard" as an activation cost
         *  (CR 602.1, 118.5, 406 — exile zone). A real cost: the activating
         *  player chooses ONE graveyard and exiles exactly `count` cards from it
         *  that match `cardType` (when set — Night Soil exiles "creature
         *  cards"). The activation is illegal unless at least one eligible
         *  graveyard holds `count` matching cards (a single graveyard must
         *  satisfy the whole cost — you cannot split it across two graveyards).
         *  By default ANY player's graveyard is eligible (CR 118.5 doesn't
         *  restrict the zone's owner — Night Soil); `owner: "you"` restricts the
         *  cost to the ACTIVATING player's OWN graveyard (Grim Lavamancer —
         *  "Exile two cards from your graveyard"). The player picks the graveyard
         *  + the specific cards via `selectActivationCost`; the cards move
         *  graveyard → exile at activation commit (so cancelling leaves the
         *  graveyard untouched). Drives Night Soil ("{1}, Exile two creature
         *  cards from a single graveyard: …") and Grim Lavamancer. */
        exileFromGraveyard?: {
            count: number;
            cardType?: CardType;
            owner?: "you";
        };
        /** Derives the value of X in this ability's mana cost from the targeted
         *  spell instead of asking the player to choose it (CR 107.3 — "X is
         *  twice the mana value of that spell"). Only meaningful when
         *  `mana.X === "X"` and the ability has a single `type: "spell"` target.
         *  At target selection the engine computes
         *  `chosenX = multiplier * mvOfStackItem(targetSpell)` and pays that as
         *  the {X} portion. Used by Reflecting Mirror (multiplier 2). */
        xFromTargetSpellMv?: { multiplier: number };
        /** Dynamic mana cost equal to the mana cost of the permanent this Aura
         *  is attached to (CR 601.2f / 202.3 — FEM Merseine: "Pay enchanted
         *  creature's mana cost: Remove a net counter from this Aura."). When
         *  true, the engine reads the printed mana cost of `card.attachedTo`'s
         *  permanent at activation time and uses it as this ability's mana cost
         *  (in addition to any `mana` declared, which is normally omitted). The
         *  activation is illegal when the source isn't attached to anything.
         *  Pair with `canActivate` to restrict who may activate it (Merseine
         *  limits it to the enchanted creature's controller). */
        manaEqualToEnchantedCreatureCost?: boolean;
    };
    /** Oracle text for this ability (displayed in context menus and on the stack). */
    oracleText: string;
    /** Target requirements declared at activation time (CR 602.2b). Chosen
     *  when the ability is activated, validated again on resolution. */
    targetRequirement?: TargetRequirement;
    /** Marks an ability whose only effect is to animate its own source
     *  (`SpellContext.animateAsCreature` targeting `ctx.sourceInstanceId`).
     *  The animate primitive is a no-op while the source already carries an
     *  `animation` record (CR 611.1 — one animation at a time; see
     *  `state.ts` `animateAsCreature`), so re-activating spends mana for
     *  nothing. The bot move enumerator (`gre/moves.ts`) skips such an
     *  ability while the source is already animated, so the Brain never
     *  wastes mana on the redundant activation (manlands: Mishra's Factory,
     *  Jade Statue). */
    animatesSelf?: boolean;
    /** Effect for mana abilities (useStack: false). */
    effect?: (ctx: ActivatedAbilityContext) => void;
    /** Rider on a TAP mana ability (CR 605.1a, `useStack: false`): when the
     *  source is tapped for mana, the engine also arms a delayed triggered
     *  ability (CR 603.7a) from the source card's `delayedTriggers[]`, with the
     *  activating player as the trigger's controller (CR 113.7) and the source
     *  instance id placed in the payload under `sourceId`. This is the
     *  declarative seam for "{T}: Add one mana of any color. <X> at the
     *  beginning of the next end step." — the mana-ability `effect` context only
     *  exposes `addMana`, so a tap-mana side effect that needs the stack-grade
     *  delayed-trigger machinery rides this field instead (ADR 0040). Used by
     *  Rainbow Vale (control-change-on-tap). No-op on untap. */
    armsDelayedTriggerOnTap?: {
        triggerId: string;
        timing: DelayedTriggerTiming;
    };
    /** Rider on a CHOICE tap mana ability (CR 605.1a, `useStack: false`): when
     *  the source is tapped for mana and the chosen option produces a COLOURED
     *  mana (any colour other than {C}), the source deals N damage to its
     *  controller as part of the same mana ability resolving — the painland
     *  cycle (Adarkar Wastes, Brushland, Karplusan Forest, Sulfurous Springs,
     *  Underground River — "{T}: Add {C}.  {T}: Add {W} or {U}. This land deals
     *  1 damage to you."). Modelled as one `manaChoices` ability whose first
     *  option is the painless {C} and whose coloured options carry the rider, so
     *  the colourless tap stays free while only the coloured tap pings the
     *  controller (this is why City of Brass's blanket PERMANENT_TAPPED trigger
     *  can't express it — that fires on EVERY tap). The damage rides the
     *  permanent-source player-damage pipeline (`dealDamageFromPermanentToPlayer`
     *  — CR 614 replacement → CR 615 prevention), not the stack: a mana ability
     *  never uses the stack (CR 605.3a). No-op on untap and on the {C} choice. */
    dealsDamageToControllerOnColoredTap?: number;
    /** Rider on a TAP mana ability (CR 605.1a, `useStack: false`): the source
     *  deals N damage to its controller EVERY time it's tapped for mana,
     *  regardless of the mana produced or chosen (Ancient Tomb — "{T}: Add
     *  {C}{C}. This land deals 2 damage to you."). Unlike
     *  `dealsDamageToControllerOnColoredTap` (gated on a coloured `manaChoices`
     *  pick, painlands), this fires unconditionally — the fixed-output
     *  analogue of `putDepletionCounterOnTap`'s "every tap" shape. Routed
     *  through the same permanent-source player-damage pipeline (CR 614
     *  replacement → CR 615 prevention), never the stack (CR 605.3a). No-op
     *  when the source was sacrificed paying the cost. */
    dealsDamageToControllerOnTap?: number;
    /** Rider on a TAP mana ability (CR 605.1a, CR 122.1, `useStack: false`):
     *  when the source is tapped for mana, the engine also puts one depletion
     *  counter on the source as part of the same mana ability resolving — the
     *  Ice Age depletion-dual cycle (Land Cap, Lava Tubes, River Delta,
     *  Timberline Ridge, Veldt — "{T}: Add {W} or {U}. Put a depletion counter
     *  on this land."). Fires on EVERY tap-for-mana (both options are coloured;
     *  there is no painless choice), distinguishing it from the painland
     *  `dealsDamageToControllerOnColoredTap` rider. Paired with the
     *  `does-not-untap-with-depletion-counter` static ability (the land skips
     *  its untap step while a depletion counter remains, CR 502.1) and a
     *  "remove a depletion counter at your upkeep" trigger (CR 603.6a), so the
     *  land untaps every other turn. The counter add is reversed if the source
     *  is untapped to refund unspent mana in the same priority window (CR
     *  106.4). No-op on untap. */
    putDepletionCounterOnTap?: boolean;
    /** Mana abilities don't use the stack — they resolve immediately (CR 605.3a). */
    useStack: boolean;
    /** Noted-mana battery (CR 106.10). When true, the engine captures the TYPE
     *  and amount of mana spent to pay THIS activation's cost (the manaPool
     *  delta around payment) and writes it onto the resulting stack item as
     *  `notedManaSpent`, so the resolve step can read it via
     *  `SpellContext.getNotedManaSpent()`. Used by Jeweled Amulet / Ice Cauldron
     *  ("note the type [and amount] of mana spent to pay this activation cost").
     *  Only meaningful for `useStack: true` abilities with a mana cost. */
    noteManaSpent?: boolean;
    /** Effect for stack abilities (useStack: true) — called with full SpellContext on resolution. */
    resolve?: (ctx: SpellContext) => void;
    /** Effect Script (ADR 0045, issue #803) — this activated ability's effect
     *  as declarative, JSON-pure data, executed by the interpreter
     *  (`convex/gre/effects/interpreter.ts`) through the SAME shared code path
     *  as spell-site scripts, with the ability's controller and source
     *  permanent bound (`$source`, `ctx.controller`). Mutually exclusive with
     *  `resolve` / `resolveSteps` on this ability — combining them throws at
     *  the `getAbilityEffectFn` seam and fails the catalogue-wide validation
     *  sweep. Only meaningful for `useStack: true` abilities (a mana ability's
     *  `effect` is a separate, stackless site). */
    effects?: EffectOp[];
    /** Multi-step resolve for stack abilities that gather player choices
     *  mid-resolution (CR 608.2, 101.4). Mirrors `CardDefinition.resolveSteps`:
     *  the engine runs steps in order; a step that calls
     *  `SpellContext.requestChoice` suspends the ability and waits for
     *  `selectResolutionChoice`. On resume the SAME step is re-invoked (earlier
     *  steps are NOT re-run, tracked via `resolutionStep`), so effects applied
     *  before the suspension are not duplicated. This is what lets
     *  "draw, then discard with a choice" abilities draw exactly once: the draw
     *  lives in an earlier step than the discard choice. Use `resolveSteps` XOR
     *  `resolve`; if both are present, `resolveSteps` wins. Used by Bazaar of
     *  Baghdad ("{T}: Draw two cards, then discard three cards"). */
    resolveSteps?: ((ctx: SpellContext) => void)[];
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
    /** Counter type whose removal is the *scaling* part of a mana-choice cost
     *  (CR 122.6 / 605.1a). When set on a `useStack: false` tap mana ability
     *  that also supplies `manaChoices` / `getManaChoices`, the chosen mana
     *  index N is interpreted as "remove N counters of this type from the
     *  source", paid at tap commit alongside the {T} cost. This is how the
     *  Mana Batteries express "{T}, Remove any number of charge counters: Add
     *  one mana of this artifact's colour, then an additional one for each
     *  counter removed this way." — choices are `[1 mana, 2 mana, …, 1+available]`
     *  and removing N counters yields 1+N mana. The removed counters are
     *  snapshotted on the instance (`manaCounterRemoval`) so untapping the
     *  source before the mana is spent restores them. Distinct from
     *  `cost.removeCounter`, which is a FIXED-count counter cost. */
    manaChoiceRemovesCounters?: string;
    /** Board-conditional mana CHOICES (CR 106.1, 605.1a) — the choice analog of
     *  `manaAmount`. When present, the engine computes the list of mana options
     *  the activator may pick from at activation time, instead of reading the
     *  static `manaChoices`. The same pure resolver runs on the client (to render
     *  the colour picker) and the server (to validate the chosen index), so the
     *  index the client submits and the server reads always reference the same
     *  list. `manaChoices` remains the representative / fallback list for
     *  best-effort callers without a board snapshot. Receives the source
     *  permanent, the controller id, and every player's battlefield view. Used by
     *  Fellwar Stone ("Add one mana of any color that a land an opponent controls
     *  could produce") to derive its colours from opponents' lands. */
    getManaChoices?: (
        source: PermanentView,
        controllerId: string,
        battlefields: ReadonlyArray<{
            playerId: string;
            /** Each permanent on this player's battlefield, paired with the set
             *  of colours it COULD produce when tapped (CR 106.4), precomputed
             *  by the engine via the shared producible-colour helper so the card
             *  definition stays decoupled from the engine's mana machinery. */
            permanents: ReadonlyArray<{
                permanent: PermanentView;
                producibleColors: ReadonlyArray<Color>;
            }>;
        }>
    ) => ManaCost[];
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
    /** "Only your opponents may activate this ability" (CR 602.1). By default
     *  only the source's controller may activate; when this is set the
     *  controller may NOT activate it, but any of the controller's opponents
     *  with priority may (paying the costs from their own resources). The
     *  source's controller is unchanged and the ability resolves as a normal
     *  activated ability on the stack. Mutually exclusive in spirit with
     *  `activatableByAnyPlayer` (which also lets the controller activate). Used
     *  by Clergy of the Holy Nimbus ("{1}: This creature can't be regenerated
     *  this turn. Only your opponents may activate this ability."). */
    activatableByOpponentsOnly?: boolean;
    /** "Only the controller of the enchanted creature may activate this
     *  ability" (CR 602.1 — FEM Merseine). The ability lives on an Aura; only
     *  the player who controls the permanent the Aura is attached to
     *  (`source.attachedTo`) may activate it, regardless of who controls the
     *  Aura. Overrides the controller-only default. */
    activatableByEnchantedController?: boolean;
    /** "Activate this ability while its source is in a GRAVEYARD" (CR 113.6 /
     *  602.5b). By default an activated ability functions only while its source
     *  is on the battlefield; this flag lets the engine locate the source in a
     *  graveyard and activate it from there. Only the graveyard's owner may
     *  activate (checked in `activateAbility`). Pair with `canActivate` for a
     *  graveyard-order predicate and `activationPhaseRestriction` /
     *  `controllerTurnOnly` for timing. The effect references the source via
     *  the DSL `$source` selector, which `moveZone` resolves to the graveyard
     *  card (→ battlefield reanimates it). Used by Ashen Ghoul ("{B}: Return
     *  this card from your graveyard to the battlefield. Activate only during
     *  your upkeep and only if three or more creature cards are above this
     *  card."). */
    activateFromGraveyard?: boolean;
    /** "Activate this ability while its source is in your HAND" (CR 113.6 /
     *  702.29a). By default an activated ability functions only while its
     *  source is on the battlefield; this flag lets the engine locate the
     *  source in a hand and activate it from there. Only the hand's owner may
     *  activate (checked in `activateAbility`). This is the seam Cycling
     *  (CR 702.29 — "[cost], Discard this card: Draw a card") rides: the
     *  Cycling ability declares `activateFromHand: true`, a mana `cost`, and
     *  `cost.discardThis: true`, so the source is discarded from hand as part
     *  of the activation cost and the ability resolves (drawing a card) on the
     *  stack. Usable any time its controller has priority (instant speed,
     *  CR 702.29b) unless narrowed by `activationPhaseRestriction`. */
    activateFromHand?: boolean;
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
     *  upkeep, e.g. Xenic Poltergeist); untap = the UNTAP step (CR 502.1 —
     *  "until its controller's next untap step", combined with
     *  `player: "controller"` to scope to the affected permanent's controller,
     *  e.g. Orcish Farmer's land-type change). */
    phase: "end-of-turn" | "end-of-combat" | "upkeep" | "untap";
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
    /** Additional card types to add while animated, beyond "Creature" (which
     *  every animate effect grants implicitly). Mishra's Factory becomes a
     *  "2/2 Assembly-Worker artifact creature" — `additionalTypes: ["Artifact"]`
     *  (CR 208.2, 611.1). Only types not already present are added, and the
     *  revert removes exactly those that were added. */
    additionalTypes?: CardType[];
    duration: DurationSpec;
}

// --- Permanent filter (shared by sweeper primitives) ---
//
// Defined in `./filters.ts` (single source of truth, ADR 0002). Re-exported
// here for back-compat with existing imports from `convex/cards/types`.

import type { PermanentFilter } from "./filters";
export type { PermanentFilter } from "./filters";

// --- May-pay cost union (CR 117.3a / 118.4 / 702.24) ---

/** The cost a `requestMayPay` decision offers to pay. Generalized from a bare
 *  `ManaCost` to the small union the Ice Age block's cumulative upkeep
 *  (CR 702.24) actually demands (ADR 0042): any combination of mana, a flat
 *  life payment, and a typed sacrifice. All present legs must be paid together
 *  (all-or-nothing); an absent leg costs nothing.
 *
 *  A plain `ManaCost` is still a legal value (the historical mana-only shape) —
 *  `normalizeMayPayCost` widens it to `{ mana }`, so every existing mana-only
 *  caller is unaffected. */
export type MayPayCost =
    | ManaCost
    | {
          /** Mana leg (CR 117.3a). */
          mana?: ManaCost;
          /** Flat life leg (CR 118.4 — "Pay N life"). */
          life?: number;
          /** Typed sacrifice leg (CR 701.16 — "Sacrifice a land"). Permanents
           *  matching `filter` controlled by the payer are sacrificed on
           *  accept. `count` selects between two payment shapes:
           *
           *   - **fixed cardinal** (`number`) — "sacrifice N matching
           *     permanents". The payer picks exactly `count` victims (CR
           *     701.16b); the historical shape (shock lands, cumulative
           *     upkeep, ADR 0042).
           *   - **summed-power threshold** (`{ minTotalPower: N }`) —
           *     "sacrifice ANY NUMBER of matching permanents with total power
           *     ≥ N" (CR 118 / 701.16, Phyrexian Dreadnought). The payer picks
           *     a variable-size set whose summed EFFECTIVE power (layer
           *     pipeline, CR 613) meets or exceeds `N`; over-payment is legal,
           *     minimality is not required.
           *
           *  The threshold rides the COST leg (a punisher paid through
           *  `mayPay`) rather than a generic `choice`-Op rider deliberately:
           *  Phyrexian Dreadnought's "sacrifice unless you sacrifice …" is a
           *  cost-or-lose-the-permanent decision, which is exactly what the
           *  `mayPay` pipeline already models (accept → pay the whole union;
           *  decline → the `if !$paid` consequence sacrifices the source). A
           *  general "sacrifice things totalling power N" `choice` rider is
           *  deferred until a card needs it OUTSIDE a cost context (YAGNI). */
          sacrifice?: {
              filter: PermanentFilter;
              count: number | { minTotalPower: number };
          };
          /** Discard leg (CR 701.9 / 118.3 — "discard a card"). Mirrors the
           *  sacrifice leg's picker, but from HAND instead of the battlefield:
           *  the payer chooses which `count` distinct card(s) from their hand
           *  to discard on accept (issue #899, Formidable Speaker — "you may
           *  discard a card. If you do, search your library for a creature
           *  card…"). Fixed cardinal only — no summed-power threshold shape
           *  exists for a discard leg (that's a sacrifice-specific CR 118
           *  wrinkle, Phyrexian Dreadnought); add one only if a card demands it
           *  (YAGNI). No type filter either: every printed "discard a card"
           *  may-pay leg is untyped — add a `filter` leg the same way the
           *  sacrifice leg has one, only when a card needs it. */
          discard?: {
              count: number;
          };
      };

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

/** JSON-pure token specification for the `createToken` Effect Script Op
 *  (ADR 0045, issue #847). The declarable subset of `TokenSpec`: every printed
 *  characteristic a token enters with — name, card types, subtypes,
 *  supertypes, power/toughness, colors, keyword static abilities and optional
 *  token art — EXCEPT `staticEffects`, whose `applies` predicates carry
 *  closures (not JSON-expressible; a token that needs continuous static
 *  effects, e.g. Tetravite's "can't be enchanted", stays a `resolve()` card).
 *  Every field is plain data, so an `effects[]` script carrying an
 *  `EffectTokenSpec` survives the JSON-purity sweep (ADR 0046). Passed verbatim
 *  to `SpellContext.createToken` by the interpreter. */
export interface EffectTokenSpec {
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
    /** Colors of the token (CR 105 / 110.5 — colorless if omitted). */
    colors?: Color[];
    /** Keyword static abilities the token enters with (e.g. `["flying"]`). */
    staticAbilities?: string[];
    /** Optional Scryfall id of a printed token card for real token art. */
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
    /** Acting Player (ADR 0037, CR 601) — the player who makes this
     *  resolution's choices. Equals `controller` for every normal cast; differs
     *  only for a controlled cast (Word of Command), where the controlled
     *  opponent is the `controller`/`caster` of the chosen spell but the Word of
     *  Command controller is the acting player. Resolve steps that prompt a
     *  decision should route to `actingPlayer`. */
    actingPlayer: string;
    /** The instance id of the stack item resolving. For activated abilities,
     *  this equals the id of the source permanent on the battlefield — use
     *  it to target self (e.g. Jade Statue's animate-self ability). */
    sourceInstanceId: string;
    /** The card DEFINITION id of the resolving stack item (CR 108.1 — the
     *  card the spell/ability is printed on). Read by scheduling primitives
     *  that stamp their source card on persisted records — a delayed
     *  trigger's `sourceCardId`, so the fired trigger renders its source
     *  card on the stack (ADR 0048). Empty string for synthetic items with
     *  no registry id. */
    sourceCardId: string;
    /** The event that fired this triggered ability (CR 603), or undefined at
     *  spell / activated-ability sites. Threaded from the resolving stack item
     *  (`StackItem.triggerEvent`). Read by the Effect Script interpreter to
     *  resolve `$event.<field>` refs through the EVENT_FIELD_REGISTRY (ADR 0049,
     *  issue #865) — legal only at trigger sites (the validator enforces the
     *  scope statically, so a spell/activated script can never read it). */
    triggerEvent?: GameEvent;
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
    /** Records an ordered pair of basic land types chosen as the source
     *  permanent enters, stored on the instance for the rest of the game
     *  (CR 603.6b / 614.12 — Illusionary Terrain "as this enchantment enters,
     *  choose two basic land types"). `[first, second]`. Read back by a
     *  `subtype-set` static's `subtypesFor` callback (ADR 0050). The source is
     *  the resolving permanent; no-op if it has left the battlefield. */
    setChosenSubtypes: (pair: string[]) => void;
    /** Reads the mode chosen as the source permanent entered (CR 700.2c modal
     *  pick stored on the instance as `chosenModeId`). Undefined if no mode was
     *  chosen or the source has left the battlefield. Used by Psychic Allergy's
     *  upkeep trigger to read the colour chosen as it entered. */
    getChosenModeId: () => string | undefined;
    /** True if the given permanent currently has a keyword removal record
     *  for `keyword` (set by a keyword-remove static effect). */
    hasRemovedKeyword: (permanentId: string, keyword: string) => boolean;
    /** Applies a copy effect (CR 707.2) to the permanent currently resolving
     *  — the spell entering the battlefield (Clone ETB choice) or the trigger
     *  source (Vesuvan upkeep re-copy). The recipient becomes a copy of the
     *  permanent identified by `sourceCreatureId`. No-op if the copy target
     *  has left the battlefield. */
    becomeCopyOf: (sourceCreatureId: string, opts?: CopyEffectOptions) => void;
    /** Token-recipient form of `becomeCopyOf` (CR 707.2 + CR 111.1): creates a
     *  fresh token under `controllerId` and immediately applies a copy effect
     *  so the token enters as a copy of the permanent identified by
     *  `sourceCreatureId` (Dance of Many — "create a token that's a copy of
     *  target nontoken creature"). The token's copiable values (types,
     *  subtypes, P/T, abilities) are taken from the copied creature's printed
     *  characteristics, NOT its current counters / damage / continuous effects
     *  (CR 707.2). The token is stamped with `createdBy` provenance so its
     *  creator can locate it later (the Dance leave-linkage). Returns the new
     *  token's instance id, or undefined if the copy source has left the
     *  battlefield. */
    createTokenCopyOf: (
        sourceCreatureId: string,
        controllerId: string,
        createdBy?: string,
        opts?: CopyEffectOptions
    ) => string | undefined;
    // --- Primitives ---
    /** Deals `amount` damage to `target` (CR 120). Runs CR 614 replacement
     *  effects, then — unless `unpreventable` is set — CR 615 prevention
     *  shields (per-player/per-target). `unpreventable` (Urza's Rage's kicked
     *  mode: "the damage can't be prevented") skips ONLY the prevention
     *  shields; CR 614 replacement/redirection and CR 702.16 protection still
     *  apply (no card in the catalogue needs "can't be prevented" to override
     *  protection too). Default false — every existing caller is unaffected. */
    dealDamage: (
        target: TargetSelection,
        amount: number,
        unpreventable?: boolean
    ) => void;
    /** Generic Fight primitive (CR 701.12-style mutual damage). The resolving
     *  ability's source permanent (`sourceInstanceId`) and `target` each deal
     *  damage equal to their power to the other, simultaneously, through the
     *  normal damage path (so replacement/prevention/protection effects apply
     *  and triggers fire). Both powers are snapshotted before any damage, and
     *  a creature that dies to the fight still deals its full damage. Reusable
     *  by any fight card (pre-"fight" Tracker template and modern "fights").
     *  No-op if either creature is no longer on the battlefield. */
    fight: (target: TargetSelection) => void;
    gainLife: (playerId: string, amount: number) => void;
    loseLife: (playerId: string, amount: number) => void;
    /** Adds `n` poison counters to a player (CR 122 — counters on a player).
     *  Mutates the dedicated `PlayerState.poisonCounters` scalar (ADR 0032),
     *  not the object counter map. No cap; a player reaching ten or more loses
     *  the game (CR 704.5c), enforced as an SBA in `checkGameOverSBA`. */
    addPoisonCounters: (playerId: string, n: number) => void;
    /** CR 122.1 — "you get {E}": adds `n` energy counters to a player. Mutates
     *  the dedicated `PlayerState.energyCounters` scalar (mirroring
     *  `addPoisonCounters`), not the object counter map. No cap and no loss
     *  condition — energy is a pure resource. n <= 0 is a no-op. The declarative
     *  skin is the `getEnergy` Effect Script Op. */
    addEnergy: (playerId: string, n: number) => void;
    /** CR 122.1 — the player's current energy-counter total (0 when none). */
    getEnergy: (playerId: string) => number;
    /** CR 122.1 / 118.12 — "pay {E}": spends `n` energy counters, all-or-
     *  nothing. Returns true and deducts when the player has at least `n`
     *  (a paid cost); returns false and spends nothing when they can't afford it
     *  (CR 118.4 — an unpayable cost isn't paid). n <= 0 is a trivially-paid
     *  no-op. */
    payEnergy: (playerId: string, n: number) => boolean;
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
    /** One-shot untap-prevention: the target doesn't untap during its
     *  controller's NEXT untap step, after which the effect clears itself
     *  (CR 302.6 / 502.1). Distinct from `lockUntapWhileSourceTapped` (held
     *  while a source stays tapped) and the `does-not-untap` keyword
     *  (permanent). No-op if the target has left the battlefield. Used by
     *  Barl's Cage. */
    skipNextUntap: (target: TargetSelection) => void;
    /** Grants the target "can attack this turn as though it didn't have
     *  defender" (CR 508.1a override — FEM Vodalian War Machine). Cleared at
     *  CLEANUP. No-op if the target has left the battlefield. */
    allowAttackDespiteDefender: (target: TargetSelection) => void;
    /** Sets the target's base power and/or toughness to a fixed value until
     *  `duration` expires (CR 613.4b layer 7b, ADR 0017). Pass `undefined` for
     *  a characteristic to leave it untouched ("base power 0" sets power only).
     *  Counters (7c) and +N/+N modifiers (7d) still apply on top of the set
     *  value. The latest set per characteristic wins. No-op if the target has
     *  left the battlefield. Pass `"indefinite"` for a set that never expires
     *  at a phase boundary (CR 613.4b — Wall of Tombstones); a `DurationSpec`
     *  scopes the set to a boundary (Halfdane "until your next upkeep",
     *  Singing Tree, Sorceress Queen). The value is computed by the caller at
     *  resolution time and locked thereafter (CR 611.2). */
    setBasePT: (
        target: TargetSelection,
        power: number | undefined,
        toughness: number | undefined,
        duration: DurationSpec | "indefinite"
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
    /** CR 702.138e — true iff `target` is a permanent that ESCAPED (was cast
     *  from a graveyard via Escape, `CardInstanceState.escaped`). False for a
     *  non-permanent target or one that left play. Read by the `escaped`
     *  EffectValue ("sacrifice it unless it escaped"). */
    isEscaped: (target: TargetSelection) => boolean;
    /** Number of creatures that have died this turn (CR 603 — running tally
     *  scoped per turn, reset at turn start). Read by triggers like
     *  Scavenging Ghoul's end-step "for each creature that died this turn". */
    getDeathsThisTurn: () => number;
    getController: (target: TargetSelection) => string;
    /** The owner of a permanent (CR 108.3 — immutable, never changed by
     *  control-magic effects). Returns undefined if the id is not on the
     *  battlefield. Distinct from `getController`: ownership decides which
     *  player's hand a returned card goes to and which "you own" clauses an
     *  effect matches (Remove Enchantments returns only enchantments/Auras the
     *  caster owns, destroying the rest). */
    getOwnerId: (cardInstanceId: string) => string | undefined;
    /** Whether a permanent is currently a declared attacker (CR 508.1).
     *  Returns false for players and for permanents not on the battlefield.
     *  Used by mass effects that scope to attacking creatures (Remove
     *  Enchantments' "Auras attached to attacking creatures opponents
     *  control"). */
    getIsAttacking: (cardInstanceId: string) => boolean;
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
    /** Replaces a target permanent's subtypes for a limited duration (CR 305.7 /
     *  611.2 — "Target land becomes a Swamp until its controller's next untap
     *  step", Orcish Farmer). Overwrites `subtypes` so subtype-driven reads
     *  (intrinsic mana — a land made a Swamp taps for {B} — and landwalk) see the
     *  change immediately; the phase-boundary purge restores the captured printed
     *  subtypes when `duration` expires. Pair with `duration: { phase: "untap",
     *  player: "controller" }` for the canonical "until its controller's next
     *  untap step" lifetime. Only one timed change is held per permanent — a
     *  second call replaces the first (CR 305.7 — the most recent change wins),
     *  restoring against the original printed subtypes. No-op for non-permanent
     *  targets or a target no longer on the battlefield. */
    setSubtypesUntil: (
        target: TargetSelection,
        subtypes: string[],
        duration: DurationSpec
    ) => void;
    /** Adds or removes a supertype on a target permanent indefinitely
     *  (CR 205.4a). `present: false` removes the supertype, `present: true`
     *  adds it. Not tied to a source staying in play — the mutation lasts
     *  until another effect changes it (Arcum's Weathervane: "Target snow land
     *  is no longer snow." / "Target nonsnow basic land becomes snow.").
     *  Writes the same instance markers as the `supertype-set` static effect,
     *  source-keyed `"indefinite"`. No-op for non-permanent targets. */
    setSupertype: (
        target: TargetSelection,
        supertype: CardSupertype,
        present: boolean
    ) => void;
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
     *  to matching battlefield permanents via `applySourceStaticEffects`.
     *  `controllerId` defaults to `playerId` (owner == controller, Resurrection).
     *  Pass a distinct `controllerId` to reanimate a card from any player's
     *  graveyard/exile under a DIFFERENT player's control (CR 400.7 / 800.4a —
     *  owner stays the pile's owner, controller becomes `controllerId`). Used by
     *  Hymn of Rebirth ("from a graveyard ... under your control"). */
    returnToBattlefield: (
        playerId: string,
        cardInstanceId: string,
        fromZone: "graveyard" | "exile",
        controllerId?: string
    ) => boolean;
    /** CR 400.7 / 614-batch (issue #1094) — the SIMULTANEOUS twin of
     *  `returnToBattlefield`: returns a whole set of graveyard cards to the
     *  battlefield as ONE event, not N sequential calls. Every entry is
     *  staged onto the battlefield (or Aura-attached, CR 303.4c) BEFORE any
     *  of them runs its grant-application / ETB pass, so no returned
     *  permanent's static-effect grants or "enters the battlefield" trigger
     *  observe only a partial subset of its siblings. Backs the `forEach {
     *  set: "graveyard" }, simultaneous: true` DSL shape (Replenish); a mass
     *  reanimation across multiple players' graveyards (Living Death) passes
     *  each entry's own `playerId`. `controllerId` — when given — redirects
     *  EVERY entry the same way `returnToBattlefield`'s 4th argument does;
     *  omitted defaults each entry to its own owner. An entry no longer in
     *  its named graveyard at resolution is silently skipped (CR 608.2b).
     *  Returns the cardInstanceIds that actually entered the battlefield —
     *  excludes vanished entries and a hostless Aura (CR 303.4c: no legal
     *  object to enchant, even among its own reanimating siblings). */
    returnGraveyardSetToBattlefield: (
        entries: { playerId: string; cardInstanceId: string }[],
        controllerId?: string
    ) => string[];
    /** Library tutor → battlefield primitive (CR 400.7 zone change, ADR
     *  0027). Moves a card a player owns from their library onto their
     *  battlefield — the destination half of a search effect whose search
     *  half is `requestChoice({ kind: "search-library", zone: "library" })`.
     *  Distinct from `returnToBattlefield` (graveyard/exile sources) because a
     *  library is hidden and unordered: callers pick the instance id from the
     *  `requestChoice` result, then route it here. The card becomes a new
     *  object — battlefield transient state is cleared, summoning sickness is
     *  set for creatures (CR 302.1), existing lord-grants reach it and its own
     *  static effects push out, and an ETB notification fires (CR 603.6).
     *  Returns true if the card was in the library and moved, false on silent
     *  fizzle (CR 608.2b). Used by Transmute Artifact. Pair with
     *  `shuffleLibrary` (CR 701.20) after the search resolves. */
    putFromLibraryOntoBattlefield: (
        playerId: string,
        cardInstanceId: string
    ) => boolean;
    /** Puts a card from `playerId`'s HAND onto their battlefield (CR 400.7 — a
     *  zone change that is not "playing" the card, so no cost is paid and the
     *  land-drop limit is not consumed). Mirrors `putFromLibraryOntoBattlefield`:
     *  splices the instance out of the hand and routes it through the shared
     *  battlefield-entry path (ETB notification + continuous-effect application,
     *  CR 603.6 / 611). Returns true if the card was in hand and moved, false on
     *  silent fizzle when the id is no longer in hand at resolution (CR 608.2b).
     *  Used by Gaea's Touch ("put a basic Forest card from your hand onto the
     *  battlefield"). */
    putFromHandOntoBattlefield: (
        playerId: string,
        cardInstanceId: string
    ) => boolean;
    /** PLAYS a land from `playerId`'s hand under their control "if able"
     *  (CR 305.2 / 116.2a). Distinct from `putFromHandOntoBattlefield` (a free
     *  zone change that does NOT consume a land drop): this is the special
     *  action of playing a land — it consumes the player's one-land-per-turn
     *  drop and is REFUSED (returns false) when that drop is already spent.
     *  Used by Word of Command ("The player plays that card if able") to play
     *  the chosen land under the controlled opponent's control, counting toward
     *  the opponent's land drop. Returns true if the land was played, false if
     *  not able (not in hand, not a Land, or the land drop is spent). */
    playLandForPlayer: (playerId: string, cardInstanceId: string) => boolean;
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
    /** Gains control of a target permanent until end of turn (CR 611.2b /
     *  613.1b, layer 2 — Ray of Command, Magus of the Unseen, issue #730).
     *  Unlike `gainControl` (whose optional `condition` is reverted by the
     *  conditional-control SBA), this installs an "until end of turn" duration
     *  that the phase-boundary purge reverts at the cleanup step (CR 514.2).
     *  Pass `opts.tapOnLoss` for the "when you lose control of it, tap it"
     *  rider (CR 701.20a): the permanent taps the instant control reverts.
     *  No-op if the target has left the battlefield. */
    gainControlUntilEndOfTurn: (
        target: TargetSelection,
        newControllerId: string,
        opts?: { tapOnLoss?: boolean }
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
    /** CR 701.17 — mills the top `amount` cards of a player's library into
     *  their graveyard, one at a time (re-reading the live top each pass so
     *  successive mills chase the receding library top), stopping early once
     *  the library empties (CR 701.17a). The single choke point for "when this
     *  card is put into your graveyard from your library" triggers (Gaea's
     *  Blessing) — emits one `CARD_MILLED` event per card AFTER it lands in the
     *  graveyard, the mill analogue of `drawCards`/`emitCardDrawn`. No-op for
     *  `amount ≤ 0`. */
    millCards: (playerId: string, amount: number) => void;
    /** CR 614 — arms a one-shot replacement for the NEXT card `playerId` would
     *  draw this turn (Aladdin's Lamp): look at the top X, keep one to draw,
     *  bottom the rest in a random order. The draw step consumes it and
     *  suspends on a `draw-look-keep` choice. No-op for `x ≤ 0` ("X can't be
     *  0"). Turn-scoped — cleared at the start of the next turn. */
    armNextDraw: (playerId: string, x: number) => void;
    /** CR 614 (issue #1145) — arms a turn-scoped "if a card would be put into
     *  YOUR graveyard from anywhere this turn, exile that card instead" grant
     *  (Yawgmoth's Will's redirect clause). Distinct from a permanent-bound
     *  `replacementEffects[]` entry with `eventKind: "graveyard-bound"`
     *  (Dauthi Voidwalker) — that lasts only as long as its source stays on
     *  the battlefield, while this survives the casting spell leaving the
     *  stack. Cleared unconditionally at CLEANUP (CR 514.2). */
    armGraveyardRedirectThisTurn: (ownerId: string) => void;
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
    /** CR 603.7a / ADR 0028 — exile `targetId` and every Aura attached to it,
     *  noting the host's counters, and arm an exile-and-return bundle keyed to
     *  `sourceId`. Unlike `phaseOut` this is a real zone change (leaves/enters
     *  triggers fire; the returned object is new). Returns the bundle id, or
     *  null if the target isn't on the battlefield. The return is driven by
     *  `returnExiledForSource` from the source's leaves/untaps triggers
     *  (Tawnos's Coffin). */
    exileWithAttachments: (
        targetId: string,
        opts: {
            sourceId: string;
            returnTapped: boolean;
            /** CR 701.18 — whether the host's attachments travel into exile WITH
             *  it and return re-attached. Default `true` (Tawnos's Coffin:
             *  Auras/Equipment are exiled and come back attached). Set `false`
             *  for host-only exile (Banishing Light / O-Ring): only the host is
             *  exiled and returned — its Auras die to the orphan-aura SBA
             *  (CR 704.5n) and its Equipment detaches and stays on the
             *  battlefield. */
            includeAttachments?: boolean;
        }
    ) => string | null;
    /** CR 603.7a / ADR 0028 — return every exile-and-return bundle held by
     *  `sourceId`: the host re-enters under its owner's control (tapped, with
     *  the noted counters) and the exiled Auras re-enter attached to it.
     *  No-op if `sourceId` holds nothing. Called from the source's "leaves the
     *  battlefield or becomes untapped" triggers. */
    returnExiledForSource: (sourceId: string) => void;
    /** Randomizes the order of a player's library using the seeded PRNG
     *  (CR 701.20). Deterministic under replay. */
    shuffleLibrary: (playerId: string) => void;
    /** Counters a spell or ability on the stack (CR 701.5a). Target must be
     *  TargetSelection with type "spell". No-op if target no longer on stack
     *  (CR 608.2b). `destination` overrides where a COUNTERED SPELL (never an
     *  ability — CR 701.5a / 113.7a, abilities simply cease to exist) ends up
     *  instead of its owner's graveyard — the "if that spell is countered this
     *  way, exile/return/put-on-top instead" clause carried by No More Lies,
     *  Memory Lapse, and Remand. Omitted/`"graveyard"` is the default CR
     *  701.5a destination. */
    counter: (
        target: TargetSelection,
        destination?: CounterDestination
    ) => void;
    /** Player discards `amount` cards chosen uniformly at random (CR 701.8a).
     *  Capped at current hand size — no-op on an empty hand. Randomness is
     *  drawn from the game's seeded PRNG so replays reproduce the same picks.
     *  `requireType` restricts the candidate pool to cards whose printed types
     *  include that type (CR 701.8a — Rag Man: "discards a creature card at
     *  random"); the random pick is taken only from matching cards, and the
     *  effect is a no-op when none match. */
    discardAtRandom: (
        playerId: string,
        amount: number,
        requireType?: CardType
    ) => void;
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
    /** Type and amount of mana spent to pay THIS activation's cost (CR 106.10).
     *  Per-colour counts, captured at activation commit. Only populated when the
     *  ability declares `noteManaSpent: true`; empty otherwise. Read by the
     *  noted-mana batteries (Jeweled Amulet, Ice Cauldron) on resolution to
     *  decide which colour to note. */
    getNotedManaSpent: () => Record<string, number>;
    /** Noted-mana battery write (CR 106.10 — Jeweled Amulet, Ice Cauldron).
     *  Stores the noted colour + amount on the source permanent `cardInstanceId`
     *  so the later "add the noted mana" ability can replay it. Overwrites the
     *  previous note. `castableCardId` (Ice Cauldron) restricts the replayed
     *  mana to casting that one exiled card; omit for unrestricted notes
     *  (Jeweled Amulet). No-op if the source isn't on the battlefield. */
    noteMana: (
        cardInstanceId: string,
        note: { mana: Record<string, number>; castableCardId?: string }
    ) => void;
    /** Noted-mana battery replay (CR 106.10). Reads the note stored on
     *  `cardInstanceId` and adds that mana to `playerId`'s pool — unrestricted
     *  (Jeweled Amulet) or instance-restricted to the noted card (Ice Cauldron).
     *  No-op if the source isn't on the battlefield or has no noted mana. */
    addNotedMana: (cardInstanceId: string, playerId: string) => void;
    /** Play-from-exile grant (CR 601.3e — Ice Cauldron: "You may cast that card
     *  for as long as it remains exiled"). Flags the card `cardInstanceId` as
     *  playable from exile by `playerId`; the play/cast pipeline then accepts it
     *  as a source — casting it if it's a spell, or playing it as a land if it's
     *  a land (CR 305.2). Looks the card up in `zoneOwnerId`'s exile (defaults to
     *  `playerId` — the historical same-player shape used by Ice
     *  Cauldron/Elkin Bottle/Chrome Mox/Headliner Scarlett's own-zone
     *  impulse-draw). Set `zoneOwnerId` explicitly for a CROSS-PLAYER grant
     *  where the exiled card is owned by someone other than the grantee
     *  (Robber of the Rich: the card is exiled from — and stays owned by —
     *  the defending player, CR 400.7, but the attacking player is granted
     *  cast permission). No-op if the id isn't in that zone owner's exile.
     *
     *  `window` (CR 514.2 / 608.2g) declares the expiry:
     *    - "while-exiled" (default): open-ended — the permission persists as
     *      long as the card remains exiled (Ice Cauldron, Robber of the Rich).
     *    - "this-turn": an impulse window ("play that card this turn" —
     *      Headliner Scarlett, Expressive Iteration). The permission is revoked
     *      at the CLEANUP step of the turn it was granted, while the card stays
     *      exiled. */
    grantCastFromExile: (
        cardInstanceId: string,
        playerId: string,
        zoneOwnerId?: string,
        window?: "this-turn" | "while-exiled"
    ) => void;
    /** Value chosen for X at cast-time (CR 107.3, 601.2b). 0 if the spell
     *  has no X in its cost. Read by spells like Fireball on resolution. */
    getX: () => number;
    /** CR 702.33 — how many times this spell's Kicker cost was paid as it was
     *  cast (0 = not kicked; 1 for a single kicker; N for a paid-N-times
     *  Multikicker, CR 702.33e). Snapshotted on the stack item
     *  (`StackItem.kickerCount`) at cast commit and read at resolution. Read in
     *  DSL via the `{ kickerCount: true }` value; `> 0` is the "was it kicked"
     *  test (Overload, Burst Lightning, …). */
    getKickerCount: () => number;
    /** Mana value of a target (CR 202.3 / 202.3b). For a permanent target,
     *  returns the printed cost's mana value — X in the cost counts as 0
     *  because the chosen X is not currently preserved on the resulting
     *  permanent. For a spell target on the stack, X folds in the chosen
     *  value from the stack item. For a graveyard-card target (issue #680 —
     *  Reanimate's "lose life equal to that card's mana value"), looks the
     *  card up in its owner's graveyard and returns its printed mana value.
     *  Returns 0 for player / unknown targets. Used by Spell Blast ("counter
     *  target spell with mana value X"). */
    getManaValue: (target: TargetSelection) => number;
    /** Mana value snapshotted on the stack item when this spell's
     *  additional sacrifice cost (CR 117.9) was paid at cast time. Returns
     *  `undefined` for spells without an `additionalCosts.sacrificeFilter`.
     *  Used by Sacrifice ("Add an amount of {B} equal to the sacrificed
     *  creature's mana value") to read the captured value at resolve. */
    getAdditionalSacrificeMv: () => number | undefined;
    /** Subtypes snapshotted on the stack item when this spell's additional
     *  sacrifice/exile cost (CR 117.9 / 601.2f) was paid at cast time. Returns
     *  `undefined` for spells without an `additionalCosts` picker. Used by Soul
     *  Exchange ("Put a +2/+2 counter on that creature if the exiled creature
     *  was a Thrull") to read the exiled creature's subtypes at resolve. */
    getAdditionalCostSubtypes: () => string[] | undefined;
    /** Effective POWER snapshotted on the stack item when this ability's
     *  additional sacrifice cost (CR 117.9 / 613 layer 7c) was paid. Captured
     *  at cost commit because the sacrificed permanent is gone by resolution
     *  (CR 608.2h last-known information). Returns `undefined` when no creature
     *  was sacrificed for the cost. Used by Freyalise Supplicant ("deals damage
     *  equal to half the sacrificed creature's power, rounded down"). */
    getAdditionalSacrificePower: () => number | undefined;
    /** Domain (CR 702 preamble — an italic ability word, no independent rules
     *  meaning of its own): the number of basic land types among lands
     *  `playerId` controls (0–5, CR 305.6 — a dual land with two basic
     *  subtypes contributes two). A thin skin over `countDomain` (this
     *  module), reading the SAME live `state.players[].battlefield` the layer
     *  system reads. Used by the ninth `EffectValue` grammar member
     *  (`{ domain: { of } }`, issue #1066) and by `StaticPTCDA.compute`
     *  closures (Kavu Scout, Wayfaring Giant, Exotic Curse, Strength of
     *  Unity) via the shared `countDomain` helper directly. */
    getDomain: (playerId: string) => number;
    /** CR 104.2a — an alternate win condition set by a resolving spell/ability
     *  (Coalition Victory), through the SAME `state.gameOver` seam State-Based
     *  Actions use (`checkGameOverSBA`, `gre/sba.ts`). Sets `winnerId` to
     *  `playerId` and `loserId` to the opponent with `reason: "alternate-win"`.
     *  A no-op if the game already ended (mirrors `drawGame`'s guard — CR
     *  104.2a doesn't re-decide an already-decided game). Mirrors `loseGame`'s
     *  direct-assignment shape (CR 104.3), the win-side counterpart. */
    winGame: (playerId: string) => void;
    /** Deals `totalAmount` damage divided evenly, rounded down, among the
     *  given targets (CR 120.1, 603.3). Remainder (if any) is discarded.
     *  Used by Fireball and other "divided among any number of targets"
     *  spells. No-op if targets is empty. */
    dealDividedDamage: (
        targets: TargetSelection[],
        totalAmount: number
    ) => void;
    /** Deals `totalAmount` damage DIVIDED AS YOU CHOOSE among the given
     *  targets — each target getting at least 1 (CR 601.2d / 120.4). The
     *  per-target split is read from the amounts the caster assigned at
     *  announcement (stored on the stack item as `targetAmounts`); when no
     *  explicit split was recorded the engine falls back to a deterministic
     *  "≥1 each, remainder front-loaded" division so the call is always safe.
     *  Used by Fire Covenant / Fiery Justice / Meteor Shower. No-op if
     *  `targets` is empty or `totalAmount <= 0`. */
    dealDamageDividedAsChosen: (
        targets: TargetSelection[],
        totalAmount: number
    ) => void;
    /** Distributes `totalAmount` counters of `type` AS YOU CHOOSE among the
     *  given targets — each target getting at least 1 (CR 601.2d / 120.4).
     *  Same announcement-time split / fallback rules as
     *  `dealDamageDividedAsChosen`. Used by Spoils of War ("Distribute X +1/+1
     *  counters among any number of target creatures"). No-op for non-permanent
     *  targets, empty `targets`, or `totalAmount <= 0`. */
    distributeCountersAsChosen: (
        targets: TargetSelection[],
        totalAmount: number,
        type: string
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
    /** Ends the game in a draw (CR 104.4a — Divine Intervention's "the game is
     *  a draw"). Sets `state.gameOver` with `isDraw: true`; there is no winner
     *  and no loser. No-op if the game is already over. */
    drawGame: () => void;
    /** Cumulative non-combat / combat damage dealt to `playerId` this turn
     *  (CR 120.3 tally). Read by Simulacrum ("equal to the damage dealt to
     *  you this turn"). Resets at turn start. */
    getDamageDealtThisTurn: (playerId: string) => number;
    /** Cumulative damage dealt to `playerId` this turn BY ARTIFACT SOURCES
     *  (CR 120.3 tally, narrowed to artifacts). Read by Reverse Polarity
     *  ("twice the damage dealt to you so far this turn by artifacts").
     *  Resets at turn start. */
    getArtifactDamageDealtThisTurn: (playerId: string) => number;
    /** Damage currently marked on a permanent (CR 120.3). Damage accumulates
     *  on a creature until CLEANUP (CR 514.2), so a non-zero value at any point
     *  during the turn means the creature "has been dealt damage this turn".
     *  Returns 0 if the permanent is not on the battlefield or carries no
     *  marked damage. Read by Giant Shark's combat pump ("becomes blocked by a
     *  creature that has been dealt damage this turn"). */
    getMarkedDamage: (target: TargetSelection) => number;
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
     *  ≤ 0. `tallyId` (optional) tags the shield so the total damage it
     *  actually prevents accumulates in `state.preventionTallies`, readable
     *  later via `consumePreventionTally` (Sacred Boon's +0/+1-per-1-prevented
     *  follow-up). */
    preventNextNDamageToTarget: (
        target: TargetSelection,
        amount: number,
        duration: DurationSpec,
        tallyId?: string
    ) => void;
    /** Returns and clears the running total of damage a tagged prevention
     *  shield has absorbed (CR 615.1 readback). Zero if nothing was prevented
     *  under `tallyId`. Consumed once — Sacred Boon reads it at the next end
     *  step to size its +0/+1 counter grant. */
    consumePreventionTally: (tallyId: string) => number;
    /** Registers a per-player damage-prevention shield with a source match and
     *  a reduction mode (CR 615.1). `match.sourceInstanceId` scopes it to one
     *  source; otherwise `match.sourceStaticAbility` scopes it to sources whose
     *  damage carries that keyword (e.g. "flying"); an empty match is
     *  unconditional. `mode` is "all" (prevent everything) or "half-down"
     *  (prevent half, rounded down). `remaining` is the number of damage events
     *  the shield absorbs before it is purged (default 1, one-shot). Unconsumed
     *  shields wear off when `duration` expires. Used by Dark Sphere (half from
     *  a chosen source, once) and Scarecrow (all flying-source damage this turn). */
    addPlayerDamagePreventionShield: (
        playerId: string,
        match: { sourceInstanceId?: string; sourceStaticAbility?: string },
        mode: "all" | "half-down",
        duration: DurationSpec,
        remaining?: number
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
    /** Marks `target` as assigning no combat damage this turn (CR 510.1c —
     *  Farrel's Mantle, Farrel's Zealot). The creature deals 0 combat damage in
     *  every damage step this turn (source-only — it can still be dealt combat
     *  damage and can still die). Distinct from `preventAllCombatDamageToAndBy`
     *  (which is a two-way prevention shield). Idempotent; cleared at CLEANUP.
     *  No-op for non-permanent targets. */
    markAssignsNoCombatDamage: (target: TargetSelection) => void;
    /** Redirects all combat damage that unblocked creatures would deal to
     *  `playerId` this turn onto the permanent `toPermanentId` instead (CR
     *  614.6 — Kjeldoran Royal Guard). Turn-scoped; idempotent; cleared at
     *  CLEANUP. Trample-through damage from a blocked creature is not
     *  redirected. */
    redirectUnblockedCombatDamage: (
        playerId: string,
        toPermanentId: string
    ) => void;
    /** Marks `playerId` as having an active Gaze of Pain rider this turn (ICE —
     *  "until end of turn, whenever a creature you control attacks and isn't
     *  blocked …"). Turn-scoped floating trigger flag read by Gaze of Pain's
     *  graveyard-zone triggered ability; idempotent; cleared at CLEANUP. */
    markGazeOfPainActive: (playerId: string) => void;
    /** Registers a turn-scoped delayed lifegain effect on `target` (CR 603.7 /
     *  119, Glyph of Life). For `duration`, whenever `target` is dealt combat
     *  damage by an attacking creature (CR 506.2 — the source is in
     *  `combat.attackerIds`), the spell's controller gains that much life.
     *  Damage from a blocker or any non-combat source does NOT trigger it.
     *  No-op if the target has left the battlefield or is not a permanent. */
    gainLifeWhenDamagedByAttacker: (
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
    /** Grants a keyword ability to `target` PERMANENTLY (CR 611.2c) — no
     *  duration, no aura link. The grant persists for as long as the permanent
     *  stays on the battlefield and is independent of any source still being in
     *  play. Used by Cocoon's hatch ("that creature gains flying" after the
     *  Aura is sacrificed). No-op if the target has left play or already has the
     *  keyword. */
    grantStaticAbilityPermanent: (
        target: TargetSelection,
        ability: string
    ) => void;
    /** Grants an ACTIVATED ability to `target` for a limited duration
     *  (CR 113.1, 611.1b). The template is looked up at activation time on the
     *  granting card's `grantTemplates[]` (`sourceCardId` + `abilityId`), so
     *  the permanent exposes it as if printed on it. The duration-scoped
     *  sibling of the continuous `activated-grant` static effect; the
     *  phase-boundary purge removes it when `duration` expires. An "activate
     *  only once" cap rides on the template's `oncePerTurn` (until-EOT grant ==
     *  one turn). No-op if target has left the battlefield. Used by Touch of
     *  Vitae's "gains '{0}: Untap this creature. Activate only once.'". */
    grantActivatedAbility: (
        target: TargetSelection,
        sourceCardId: string,
        abilityId: string,
        duration: DurationSpec
    ) => void;
    /** Grants a triggered ability to `target` for a limited duration
     *  (CR 113.1, 611.1b). The template is looked up at trigger-scan time on
     *  the granting card's `triggeredGrantTemplates[]` (`sourceCardId` +
     *  `abilityId`) and unioned into the target's effective triggers, so the
     *  engine scans and resolves it as if printed on `target`. The
     *  duration-scoped sibling of the continuous `triggered-grant` static
     *  effect; the phase-boundary purge removes it when `duration` expires.
     *  No-op if target has left the battlefield. Used by Rapid Fire's "that
     *  creature gains rampage 2 until end of turn". */
    grantTriggeredAbility: (
        target: TargetSelection,
        sourceCardId: string,
        abilityId: string,
        duration: DurationSpec
    ) => void;
    /** Grants a triggered ability to a single target permanent with NO
     *  duration and NO aura link (CR 113.1 / 611.2c) — it persists for as long
     *  as the target stays on the battlefield, independent of the granting
     *  source. The template lives on the granting card's
     *  `triggeredGrantTemplates[]` (`sourceCardId` + `abilityId`), unioned into
     *  the target's effective triggers by `effectiveTriggeredAbilities` so the
     *  engine scans / resolves it as if printed on the target. The permanent
     *  (indefinite) sibling of `grantTriggeredAbility`; both the phase-boundary
     *  purge and the aura-unapply pass skip entries lacking duration/auraId, so
     *  it is cleared only when the target leaves play. Used by Balduvian Shaman
     *  ("that enchantment gains 'Cumulative upkeep {1}'") and Dreams of the Dead
     *  ("that creature gains 'Cumulative upkeep {2}'"). */
    grantTriggeredAbilityPermanent: (
        target: TargetSelection,
        sourceCardId: string,
        abilityId: string
    ) => void;
    /** Marks a permanent so that if it would leave the battlefield, it is
     *  exiled instead of going to any other zone (CR 614.1c — a replacement
     *  applied to every battlefield-departure path: dies, sacrifice, bounce,
     *  destroy). Unlike `setExileOnDeath` (one-shot, cleared at CLEANUP, death
     *  only) this is a PERSISTENT per-instance flag covering ALL leave paths and
     *  surviving across turns, cleared only when the permanent actually leaves
     *  play. Used by Dreams of the Dead's reanimation ("if the creature would
     *  leave the battlefield, exile it instead of putting it anywhere else"). */
    setExileOnLeave: (target: TargetSelection) => void;
    /** Removes every keyword static ability matching `predicate` from a
     *  permanent for a limited duration (CR 611.1b layer 6). Each removed
     *  keyword is spliced out of `staticAbilities` so combat / rules checks stop
     *  seeing it at read time; the phase-boundary purge restores it when
     *  `duration` expires. The duration-scoped counterpart of
     *  `grantStaticAbility`. No-op if the target has left the battlefield. Used
     *  by Shelkin Brownie ("loses all 'bands with other' abilities until end of
     *  turn") and Tolaria (also strips plain banding). */
    removeStaticAbilities: (
        target: TargetSelection,
        predicate: (keyword: string) => boolean,
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
     *  `getDefinition(sourceCardId).delayedTriggers[triggerId]`. `payload` holds
     *  serializable state (instance / player ids) read by the resolver —
     *  closures are not permitted so replays reproduce correctly. Used by
     *  Berserk's "at the beginning of the next end step, destroy ~".
     *
     *  `timing: "next-draw-step"` fires at the beginning of a specific player's
     *  next draw step (CR 504) — pass that player's id as `targetPlayerId` so
     *  the trigger fires only on their draw step (Nafs Asp).
     *
     *  `timing: "next-main-phase"` fires at the beginning of a specific player's
     *  next main phase (CR 505) — the next PRECOMBAT_MAIN or POSTCOMBAT_MAIN of
     *  the player passed as `targetPlayerId`, on that player's own turn. Used by
     *  Mana Drain ("add {C} at the beginning of your next main phase").
     *
     *  `timing: "next-upkeep"` fires at the beginning of the next upkeep step
     *  (CR 502) regardless of whose turn it is — the immediate next UPKEEP any
     *  player reaches consumes it, exactly once (CR 603.7d). Used by the Ice Age
     *  cantrips ("draw a card at the beginning of the next turn's upkeep").
     *  Pass no `targetPlayerId` so it fires at the very next upkeep.
     *
     *  The remaining timings ignore `targetPlayerId` and fire at the next global
     *  boundary.
     *
     *  `inline` (ADR 0048) — the Effect Script path: instead of a card-def
     *  template, the delayed BODY is a pure-JSON Op list persisted on the
     *  `DelayedTriggerInstance` itself (with the oracle text shown when it
     *  fires). At fire time the payload is re-bound as the body's initial
     *  binding environment and the interpreter runs the body directly — no
     *  card-def lookup. Used by the `delayedTrigger` Effect Script Op; the
     *  template path (`triggerId` lookup) remains the legacy seam for
     *  `resolve()` cards. */
    scheduleDelayedTrigger: (
        sourceCardId: string,
        triggerId: string,
        timing: DelayedTriggerTiming,
        // A value is a single id (ADR 0048) or a frozen `string[]` list
        // (ADR 0049, issue #866 — a list-valued capture read as a list binding
        // by an inline body's forEach). Legacy `resolve()` cards pass only the
        // scalar form; the widening is covariant, so their calls still type.
        payload: Record<string, string | string[]>,
        targetPlayerId?: string,
        inline?: DelayedTriggerInlineBody,
        /** REQUIRED for the `leaves-battlefield` timing (CR 603.7a / 603.10):
         *  the instance id whose `PERMANENT_LEFT` fires this delayed trigger.
         *  Undefined for every phase-boundary timing. */
        watchInstanceId?: string
    ) => void;
    /** Returns true if the target permanent was declared as an attacker this
     *  turn (CR 506.2). Used by "destroy it if it attacked this turn"-style
     *  delayed triggers. Returns false for players and for permanents no
     *  longer on the battlefield. */
    hasAttackedThisTurn: (target: TargetSelection) => boolean;
    /** True if the target permanent is summoning-sick (CR 302.6 — entered under
     *  its controller's control after their most recent turn began). Used to
     *  identify creatures that "couldn't attack" this turn (Season of the
     *  Witch). False for players / permanents off the battlefield. */
    isSummoningSick: (target: TargetSelection) => boolean;
    /** True if the target permanent's printed `staticAbilities` include
     *  `ability` (CR 702). Used to identify keyword-bearing creatures inside a
     *  resolve body (Season of the Witch's "couldn't attack" defender check).
     *  False for players / permanents off the battlefield. */
    hasStaticAbility: (target: TargetSelection, ability: string) => boolean;
    /** The target permanent's effective keyword static abilities at read time
     *  (CR 702), including ones granted by continuous effects or until-end-of-
     *  turn grants (everything spliced into `staticAbilities`). Parametric
     *  keywords carry their value (e.g. `"rampage 2"`), so a "does it already
     *  have rampage" check is `.some(a => a.startsWith("rampage"))`. Returns an
     *  empty array for players / permanents off the battlefield. Used by Rapid
     *  Fire's conditional rampage grant. */
    getStaticAbilities: (target: TargetSelection) => string[];
    /** Prevents all combat damage for the remainder of this turn (CR 615,
     *  Fog). Cleared at CLEANUP. Non-combat damage is unaffected. */
    preventAllCombatDamage: () => void;
    /** CR 601.3a — marks `playerId` unable to cast spells for the remainder of
     *  this turn (Xantid Swarm's "defending player can't cast spells this
     *  turn"; Abeyance passes `cardTypes: ["Instant", "Sorcery"]` to narrow the
     *  lock to those types instead of every spell). A turn-scoped per-player
     *  restriction, cleared at CLEANUP (CR 514.2); unlike a permanent-sourced
     *  `cast-restriction` static it does not revert when a source leaves play.
     *  Enforced by the shared cast gate `castProhibitionReason` (read by the
     *  GRE and the client alike). */
    restrictSpellCasting: (playerId: string, cardTypes?: CardType[]) => void;
    /** CR 602.1 / 605.1a — marks `playerId` unable to activate abilities that
     *  aren't mana abilities for the remainder of this turn (Abeyance). A
     *  turn-scoped per-player restriction, cleared at CLEANUP (CR 514.2).
     *  Enforced directly in the `activateAbility` mutation (`convex/game.ts`),
     *  which only ever handles non-mana (`useStack: true`) abilities — mana
     *  abilities go through `tapUntap` and are structurally unaffected. */
    restrictAbilityActivation: (playerId: string) => void;
    /** Replaces the mana produced by `playerId`'s LANDS with {U} until end of
     *  turn (CR 614 — Deep Water: "if you tap a land you control for mana, it
     *  produces {U} instead of any other type"). The same total quantity of mana
     *  is produced, only the type changes; non-land mana sources are unaffected.
     *  Idempotent (stacking Deep Water activations don't compound). Cleared at
     *  CLEANUP. */
    replaceLandManaWithBlue: (playerId: string) => void;
    /** Arms a FEM High Tide rider for `playerId` until end of turn: each time
     *  that player taps an Island for mana, they add an additional {U} on top of
     *  the Island's normal output (CR 614-style additive replacement). Unlike
     *  `replaceLandManaWithBlue`, this is additive AND stacks — two High Tides
     *  give two extra {U} per Island tap. Cleared at CLEANUP. */
    addHighTide: (playerId: string) => void;
    /** Arms a turn-scoped, parametrized land-mana rider until end of turn
     *  (CR 614 / 514.2). The generalized form of `addHighTide`: when ANY player
     *  taps a land of the named `subtype` for mana this turn,
     *  - `mode: "additional"` adds one more `color` on top of normal output
     *    (Chaos Moon odd — Mountain adds an additional {R}); stacks per arm.
     *  - `mode: "override"` rewrites the land's whole output to that total
     *    quantity of `color` (Chaos Moon even — Mountain produces {C} instead).
     *  Cleared at CLEANUP. */
    addLandManaRider: (rider: {
        subtype: string;
        color: Color;
        mode: "additional" | "override";
    }) => void;
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
    /** Marks the resolving ability's source permanent (`sourceInstanceId`) so
     *  it can't be regenerated for the rest of the turn (CR 701.15c). Suppresses
     *  both regeneration shields and the continuous `"auto-regenerate"`
     *  replacement on that permanent. Cleared at CLEANUP. No-op if the source is
     *  no longer on the battlefield. Used by Clergy of the Holy Nimbus's "{1}:
     *  This creature can't be regenerated this turn." */
    setSourceCantBeRegeneratedThisTurn: () => void;
    /** Marks a TARGET creature so it can't be regenerated for the rest of the
     *  turn (CR 701.15c — the target-scoped twin of
     *  `setSourceCantBeRegeneratedThisTurn`). Sets the same per-instance
     *  `cantBeRegeneratedThisTurn` flag, so it suppresses both regeneration
     *  shields and the continuous `"auto-regenerate"` replacement on that
     *  creature. Cleared at CLEANUP (CR 514.2). No-op if the target is not a
     *  creature on the battlefield. Used by Incinerate ("A creature dealt damage
     *  this way can't be regenerated this turn"), Orcish Healer, and Word of
     *  Blasting. */
    setTargetCantBeRegeneratedThisTurn: (target: TargetSelection) => void;
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
    /** Swaps the block assignments of two blocking creatures (CR 509.1 /
     *  506.4 — Sorrow's Path). Reads each blocker's currently-assigned attacker
     *  set and, IFF each blocker could legally block every attacker the other
     *  is blocking (full declare-blockers legality: evasion, "can't be blocked
     *  by", protection, pile restrictions — CR 509.1b/c), removes both from
     *  combat and re-blocks each onto the other's former attacker set. Returns
     *  `true` when the swap happened. Returns `false` (no-op) when either
     *  creature is missing / not blocking, the two ids are equal, or any leg of
     *  the legality gate fails — matching the card's "if each ... could block
     *  all creatures the other is blocking" hard condition. The attackers stay
     *  blocked throughout (`blockedAttackerIds` is untouched). Orthogonal combat
     *  operation, reusable by any future block-swap effect. */
    reassignBlocks: (blockerAId: string, blockerBId: string) => boolean;
    /** Attacker-side dual of {@link reassignBlocks} (CR 509.1 — General
     *  Jarkeld). Given two BLOCKED attacking creatures X and Y, IFF each could
     *  legally be blocked by every creature the other is currently blocked by
     *  (full declare-blockers legality: evasion, "can't be blocked by",
     *  protection — CR 509.1b/c), every creature blocking exactly one of X / Y
     *  stops blocking it and instead blocks the other (a creature blocking both,
     *  or neither, is unchanged; other attackers in a multi-block set are
     *  untouched). Returns `true` when the reassignment happened, `false`
     *  (no-op) when either attacker is missing / not a blocked attacker, the two
     *  ids are equal, or any leg of the legality gate fails — matching the
     *  card's "if each ... could be blocked by all creatures the other is
     *  blocked by" hard condition. Both attackers stay blocked throughout
     *  (`blockedAttackerIds` is untouched). Orthogonal combat operation. */
    reassignAttackerBlockers: (
        attackerXId: string,
        attackerYId: string
    ) => boolean;
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
    /** Marks a target permanent as unable to attack this turn (CR 508.1a,
     *  ADR 0053 pile division). The attack-side twin of `setCantBlockThisTurn`.
     *  Cleared at CLEANUP. Used by Fight or Flight's unchosen pile. No-op if
     *  target is not a permanent on the battlefield. */
    setCantAttackThisTurn: (target: TargetSelection) => void;
    /** Marks a target permanent (an attacker) as unable to be blocked this
     *  turn (CR 509.1b). Read on the attacker side by combat block-validation;
     *  cleared at CLEANUP (CR 514.2). No-op if target is not a permanent on the
     *  battlefield. Used by Tawnos's Wand ("target creature with power 2 or
     *  less can't be blocked this turn"). */
    setCantBeBlockedThisTurn: (target: TargetSelection) => void;
    /** Marks a target permanent (an attacker) as unable to be blocked this turn
     *  by creatures whose subtypes include `subtype` (CR 509.1b). Read on the
     *  attacker side by combat block-validation; cleared at CLEANUP (CR 514.2).
     *  No-op if target is not a permanent on the battlefield. Used by Tower of
     *  Coireall ("target creature can't be blocked by Walls this turn"). */
    setCantBeBlockedBySubtypeThisTurn: (
        target: TargetSelection,
        subtype: string
    ) => void;
    /** Flips a coin (CR 705) using the game's seeded PRNG, so flips are
     *  replay-safe and reproducible given the seed. Returns true on "heads"
     *  (the flipping player wins the flip), false on "tails". Available where
     *  triggered and activated abilities resolve. Used by Bottle of Suleiman,
     *  Mijae Djinn, and Ydwen Efreet. */
    flipCoin: () => boolean;
    /** Sets colorOverride on a target permanent or spell (CR 305.7, layer 5).
     *  Replaces all color derivation — the target "becomes" the given colors.
     *  Used by lace instants. No-op if target has left play / stack.
     *
     *  `duration` (issue #1065, generalizing `setSubtypesUntil`'s pattern) is
     *  for the PERMANENT-target case only: a temporary override that reverts
     *  to whatever colorOverride the target carried before ("becomes the
     *  color of your choice UNTIL END OF TURN", Kavu Chameleon), rather than
     *  lasting indefinitely (Dream Coat / Shyft omit it). The phase-boundary
     *  purge (`tickAllDurations`) restores the prior value when the duration
     *  expires. Omitted = indefinite, the original behavior. Ignored for
     *  spell targets (a spell resolves/leaves the stack well before any
     *  phase boundary, so a duration is meaningless there). */
    setColorOverride: (
        target: TargetSelection,
        colors: Color[],
        duration?: DurationSpec
    ) => void;
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
    /** Camouflage (CR 509 variant — the random twin of Raging River, ADR 0012).
     *  Replaces the defending player's declare-blockers step for THIS combat:
     *  `piles` is the defender's division of any number of their creatures into
     *  buckets (piles can be empty; the count is at most the number of
     *  attackers). The engine assigns each pile to a DIFFERENT attacker at
     *  random via the seeded PRNG (deterministic for replay), then each creature
     *  in a pile that can legally block its assigned attacker is forced to do so
     *  — the blocks are written straight into `combat.blockerAssignments`. Sets
     *  `state.camouflageCombat` so the DECLARE_BLOCKERS step auto-confirms with
     *  no blocking priority. No-op if there is no active combat. */
    applyCamouflagePileBlocks: (defenderId: string, piles: string[][]) => void;
    /** Melee (CR 509.1 variant — attacker-driven block override, #669). Sets
     *  `state.meleeCombat` so that, for THIS combat, the ATTACKING (active)
     *  player declares blocks instead of the defending player: the
     *  block-selection mutations route to the active player, with the same
     *  `validateBlockerEligibility` legality gating every assignment (only LEGAL
     *  blocks can be forced). Distinct from `applyCamouflagePileBlocks`, which
     *  assigns the defender's piles at random — Melee hands the live choice to
     *  the attacker. No-op if there is no active combat. */
    enableAttackerChoosesBlocks: () => void;
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
    /** Copies the CURRENTLY-RESOLVING spell itself — "copy this spell"
     *  (CR 707.12, Chain Lightning). Clones the resolving stack item, inserts
     *  the copy directly above it (so the copy resolves next), and returns the
     *  copy's new stack id — or `null` if the resolving item isn't an
     *  instant/sorcery spell. The copy starts a fresh resolution from step 0
     *  (its own may-pay / choice steps re-run), is controlled by this spell's
     *  controller, and ceases to exist after resolving instead of going to a
     *  graveyard (CR 707.12/112.5). Pair with `requestCopyRetarget` to let the
     *  copy's controller choose new targets for it. Distinct from
     *  `copyStackItem`, which copies a DIFFERENT spell still on the stack.
     *
     *  `modifications.controllerId` reassigns the copy's controller when the
     *  effect names a specific copier other than this spell's controller (Chain
     *  Lightning: the player who paid {R}{R} controls and retargets the copy,
     *  CR 707.12b). Defaults to this spell's controller. */
    copyResolvingSpell: (modifications?: {
        colorOverride?: Color[];
        controllerId?: string;
    }) => string | null;
    /** Offers this spell's controller the chance to choose new targets for a
     *  copy created by `copyStackItem` (CR 707.10b — Fork's "you may choose
     *  new targets for the copy"). Enters a `copy-retarget` target-selection
     *  phase when the copied spell has a `targetRequirement` that needs at
     *  least one target; otherwise a no-op. Declining the selection
     *  (`cancelTarget`) keeps the copy's inherited targets. No-op if the copy
     *  is no longer on the stack. */
    requestCopyRetarget: (copyStackItemId: string) => void;
    /** Changes the target of a spell ALREADY on the stack — the ORIGINAL stack
     *  object, not a copy (CR 114.6 — "change the target(s) of a spell"). Enters
     *  a `retarget` target-selection phase against the given requirement; the
     *  chosen target(s) are written onto the original stack item in place. Used
     *  by Reflecting Mirror ("change the target of target spell … the new target
     *  must be a player"). No-op if the spell has left the stack. The new
     *  target's legality (e.g. "must be a player") is governed by `requirement`
     *  and re-validated at selection. */
    requestRetarget: (
        spellStackItemId: string,
        requirement: TargetRequirement
    ) => void;

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
        // "divide-piles" (ADR 0053, pile division) reuses this exact
        // zone-pick shape for the divider's total 2-way partition (the
        // submitted subset is pile A; the zone-minus-submission remainder is
        // pile B) — no bespoke primitive needed, "generalize don't add".
        kind: ZonePickKind | "divide-piles";
        zone: "battlefield" | "hand" | "library" | "graveyard";
        filter?: PermanentFilter;
        count: number | { min: number; max: number };
        prompt: string;
        /** Owner of the zone being picked from. Defaults to `playerId` (the
         *  chooser picks from their own zone). Set when the chooser picks
         *  items from another player's zone (e.g. Demonic Hordes: opponent
         *  picks a Land from controller's battlefield). */
        zoneOwnerId?: string;
        /** Acting Player (ADR 0037): when the prompted player (`playerId`) is
         *  acting on behalf of another player's decision (Word of Command — the
         *  controller picks a card from the controlled opponent's hand), set
         *  this to the acting player. Recorded on the PendingChoice only when it
         *  differs from `playerId`. Defaults to `playerId` (normal choices). */
        actingPlayerId?: string;
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
        /** For `kind: "order-top"` only — the second zone the un-kept looked-at
         *  cards go to (`library-bottom` scry / `graveyard` surveil / `none`
         *  order-only). Prefer the higher-level {@link SpellContext.orderTop},
         *  which raises this choice and applies the split for you. */
        destination?: LibraryDestination;
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
        /** The cost paid on accept. A bare `ManaCost` (mana-only, the historical
         *  shape) or the `{ mana?, life?, sacrifice? }` union (CR 702.24 — pay
         *  life, sacrifice, or a mix; ADR 0042). Omit for a cost-less yes/no. */
        cost?: MayPayCost;
        prompt: string;
        /** Spend restriction the mana leg may additionally draw on (CR 106.6,
         *  ADR 0022 / 0042). When set, the cost's mana leg may be paid from the
         *  player's restricted mana carrying this restriction in addition to the
         *  fungible pool. Set to `"cumulative-upkeep"` by the cumulative-upkeep
         *  trigger so Adarkar Unicorn / Snowfall mana pays the upkeep. */
        manaRestriction?: ManaRestriction;
    }) => boolean | undefined;

    /** Records the per-permanent billing list for a "pay-or-penalty over a mass
     *  effect" rider (CR 608.2 — Stench of Evil). Pass one entry per permanent
     *  actually affected (typically the controller id of each destroyed
     *  permanent — repeated when a player controlled several). Persisted on the
     *  stack item so it survives the irreversible mass effect and any
     *  suspension on a later may-pay. Read back with `getMassRiderTargets`. */
    noteMassRiderTargets: (playerIds: string[]) => void;
    /** Returns the billing list recorded by `noteMassRiderTargets` (empty if
     *  none). The rider loop walks this list, issuing one may-pay / penalty per
     *  entry. */
    getMassRiderTargets: () => string[];

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
        /** Acting Player (ADR 0037): set when the prompted `playerId` is acting
         *  on another player's behalf (Word of Command — the controller picks X
         *  / the mode for the controlled opponent's spell). Recorded on the
         *  PendingChoice only when it differs from `playerId`. */
        actingPlayerId?: string;
    }) => string | undefined;

    /** Step 2 of the pile-division divide-then-choose family (ADR 0053): the
     *  CHOOSER picks pile "A" or "B" once the divider's `divide-piles`
     *  `requestChoice` (step 1) has already committed the partition. Mirrors
     *  `requestOptionChoice`'s suspend/replay contract, with the completed
     *  `pileA`/`pileB` id lists carried on the entry (instead of `options`) so
     *  the chooser's client can render pile contents before deciding. On
     *  first call, enqueues a `pick-pile` `PendingChoice` and returns
     *  `undefined` — the caller must return early to suspend. On resume the
     *  call returns the chosen pile label. */
    requestPickPile: (req: {
        playerId: string;
        choiceId: string;
        pileA: string[];
        pileB: string[];
        prompt: string;
        actingPlayerId?: string;
    }) => "A" | "B" | undefined;

    /** Requests a player name ANY card (CR 202.3 / 701.x "chooses a card
     *  name"). On first call, enqueues a `name-card` `PendingChoice` and
     *  returns `undefined` — the caller MUST return early to suspend. On resume
     *  (after the chooser submits via `submitNameCard`) the call returns the
     *  chosen card name string. The candidate set is the whole card registry —
     *  there is no zone or `options` allow-list; the name is validated
     *  server-side against the registry (an unregistered name is rejected).
     *  `choiceId` disambiguates multiple name choices within a step and must be
     *  stable across replays. Used by Petra Sphinx ("Target player chooses a
     *  card name, then reveals the top card of their library …"). */
    requestNameCard: (req: {
        playerId: string;
        choiceId: string;
        prompt: string;
    }) => string | undefined;

    /** The card name of an instance in any zone, read from the card registry
     *  (CR 108.1 / 201.1). Resolves the instance's definition id to its printed
     *  name. Returns undefined if the id isn't on any player's
     *  library/hand/graveyard/exile/battlefield or its definition is unknown.
     *  Used to compare a revealed card against a named card (Petra Sphinx). */
    getCardName: (cardInstanceId: string) => string | undefined;

    /** Reveals ONE card chosen uniformly at random from `playerId`'s hand
     *  (CR 701.20a reveal), using the game's seeded PRNG so replays reproduce
     *  the same pick, exactly like `flipCoin` / `discardAtRandom`. The picked
     *  card is stamped known-to-all (`markKnownToAll`) so the wire projection
     *  shows the real card, and a one-shot reveal notification is enqueued for
     *  both players. Returns the revealed instance id (compare its name with
     *  `getCardName`), or undefined when the hand is empty (CR 608.2b — nothing
     *  is revealed). MUST be called only in the final, non-suspending segment
     *  of a resolution (draw the bit exactly once): call it AFTER any
     *  `requestNameCard` / `requestChoice` suspension so the random draw is not
     *  re-rolled on the replayed step. Used by Cursed Scroll ("reveal a card at
     *  random from your hand"). */
    revealRandomHandCard: (playerId: string) => string | undefined;

    /** Reads back an answer collected by an EARLIER resolution step of the same
     *  stack item (CR 608.2 stepped resolution). `requestChoice` /
     *  `requestMayPay` key their answers under `${step}:${choiceId}`, so a later
     *  step cannot re-read a prior step's pick by calling the request again
     *  (that would re-prompt under a new key). This scans `collectedChoices` for
     *  any step's entry matching `choiceId` and returns the stored value array
     *  (a single-option pick is `[optionId]`, a may-pay is `["yes"]`/`["no"]`).
     *  Returns undefined if no earlier step recorded that choiceId. Choice ids
     *  must be unique within a resolution for this to be unambiguous. Sylvan
     *  Library uses it to carry the "did I draw?" and "which two cards" answers
     *  forward to the per-card pay-or-topdeck steps. */
    recallChoice: (choiceId: string) => string[] | undefined;

    /** Persists a value computed in the CURRENT resolution step so a LATER step
     *  can read it back with `recallChoice` (CR 608.2h last-known information).
     *  Use when a step must reference an object BEFORE an irreversible operation
     *  later in the same resolution destroys it — e.g. Chain Lightning captures
     *  the targeted permanent's controller before dealing lethal damage, then
     *  recalls it in the may-pay step once the permanent may already be gone.
     *  Keyed under the current step like `requestChoice` / `requestMayPay`, so
     *  the `choiceId` must be unique within the resolution. Stored in
     *  `collectedChoices` (serialized across suspend/replay, cleared on
     *  completion). */
    noteChoice: (choiceId: string, values: string[]) => void;

    // --- Effect Script interpreter plumbing (ADR 0045, issue #805) ---
    // NOT for card authors: these three manipulate the stack item's
    // `resolutionStep` — the SAME resume checkpoint `resolveSteps` use — so
    // the Effect Script interpreter can suspend at a `choice` Op and resume
    // at that exact Op index (earlier Ops never re-run, CR 608.3). Imperative
    // cards must never call them: the engine owns the checkpoint for
    // `resolveSteps`, and a `resolve()` body has no Op indexes.

    /** The interpreter's resume checkpoint: the Op index execution restarts
     *  from, or undefined on a fresh (non-resumed) resolution. Reads
     *  `StackItem.resolutionStep`. */
    getScriptCheckpoint: () => number | undefined;
    /** Checkpoints the CURRENT Op index before executing it, so a suspension
     *  inside the Op resumes at the same index and `requestChoice` /
     *  `noteChoice` key their `collectedChoices` entries under it. */
    setScriptCheckpoint: (opIndex: number) => void;
    /** Clears the checkpoint when the script has run to completion, so the
     *  card instance carries no stale `resolutionStep` into its next zone
     *  (a recast would otherwise skip the target-legality gate, CR 608.2b). */
    clearScriptCheckpoint: () => void;

    /** Flips a coin and PAUSES resolution to reveal the outcome before the
     *  consequence is applied (CR 705.2, ADR 0023). Unlike `flipCoin` (which
     *  draws a bit synchronously and returns immediately), this enqueues a
     *  `random-reveal` pending choice carrying the realized outcome and
     *  suspends the step — both clients animate the coin landing on a WIN/LOSE
     *  face, then the chooser's client auto-acknowledges
     *  (`submitRandomRevealAck`) and the engine resumes.
     *
     *  On the first call in a step it draws the bit via `flipCoin()` EXACTLY
     *  ONCE, persists it, and returns `undefined` — the caller MUST return
     *  early so the engine suspends before applying the consequence. On resume
     *  the persisted outcome short-circuits the re-run and returns the boolean
     *  (no re-roll): `true` when the flipping player wins (heads), `false` on
     *  tails. `choiceId` disambiguates multiple flips within a step and must be
     *  stable across replays.
     *
     *  `heads`/`tails` each carry a `consequence` one-liner shown as the
     *  overlay preview ("Create a 5/5 Djinn"). The landed `face` defaults to
     *  `WIN` (heads) / `LOSE` (tails); pass `face` to override for a future
     *  non-win/lose flip (Puppet's Verdict-style HEADS/TAILS). A thin wrapper
     *  over the generic `random-reveal` envelope a future `requestDieRoll`
     *  reuses. Used by Bottle of Suleiman. */
    requestCoinFlip: (req: {
        playerId: string;
        choiceId: string;
        heads: { consequence: string; face?: string };
        tails: { consequence: string; face?: string };
    }) => boolean | undefined;

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

    /** Effective colors of a battlefield permanent target (CR 202.2 / 105),
     *  honoring any layer-5 color override. Empty for player / stack-spell
     *  targets or ids not on the battlefield. Used by resolve closures that
     *  branch on a chosen target's color (Elvish Healer's "if it's a green
     *  creature"). */
    getColors: (target: TargetSelection) => Color[];

    /** Ids of cards in `playerId`'s hand. */
    getHandIds: (playerId: string) => string[];

    /** Instance ids of the cards `playerId` has drawn so far this turn, in draw
     *  order (CR 121.1). Tracked by every draw path and reset at turn start.
     *  Includes cards that have since left the hand — callers that need "drawn
     *  this turn AND still in hand" must intersect with `getHandIds`. Sylvan
     *  Library reads this to scope its "choose two cards in your hand drawn this
     *  turn" pick. */
    getDrawnThisTurnIds: (playerId: string) => string[];

    /** Sacrifices a permanent controlled by its current controller (CR 701.16).
     *  No-op if the id is not on the battlefield. */
    sacrifice: (cardInstanceId: string) => void;
    /** CR 702.30a — Echo: clears the resolving trigger source's `echoPending`
     *  flag once its echo cost has been paid, so the echo trigger's
     *  intervening-if never fires again on a later upkeep. No-op if the source
     *  has left the battlefield. Called only by the echo trigger template
     *  (`abilities/echo.ts`). */
    markEchoPaid: () => void;

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

    /** Moves a card from `playerId`'s hand to the TOP of their library (CR
     *  121.1 — top is the next card drawn). Returns false if the card isn't in
     *  hand. Sylvan Library's "put the card on top of your library" uses this. */
    moveHandCardToLibraryTop: (
        playerId: string,
        cardInstanceId: string
    ) => boolean;
    /** Reorders the top cards of `playerId`'s library so they match the order
     *  given by `orderedIds` (CR 401). All ids must already be in the top N. */
    reorderLibraryTop: (playerId: string, orderedIds: string[]) => void;

    /** CR 401.4 "put it on top of your library" (issue #1125) — the
     *  tutor-to-top template: relocates specific card(s), by id, from
     *  ANYWHERE in `playerId`'s library onto the top, preserving `orderedIds`'
     *  order (index 0 ends up the very top). Unlike `reorderLibraryTop`, the
     *  ids need NOT already sit within a known top-N window — a search
     *  `choice` can pick a card from the whole library, and the shuffle that
     *  precedes this call (Vampiric Tutor's "then shuffle") can leave it
     *  anywhere. An id no longer present is silently skipped (CR 608.2b). The
     *  moved cards are marked known to `playerId` (ADR 0026 — the searcher
     *  placed them there), mirroring `orderTop`'s "kept cards stay known". */
    putLibraryCardsOnTop: (playerId: string, orderedIds: string[]) => void;

    /** The reusable ordered-top primitive behind the drag picker — Scry
     *  (CR 701.22), Surveil (CR 701.44) and order-only "put them back in any
     *  order" (Ponder / Index). Looks at the top `n` cards and raises an
     *  `order-top` `PendingChoice` (projected face-up as `libraryPeek`); on
     *  resume it puts the KEPT cards back on top in the player's chosen order and
     *  sends the rest to `destination` (`library-bottom` / `graveyard` / `none`),
     *  marking the kept cards known to the controller (ADR 0026). Suspend-aware
     *  like `requestChoice`: returns `false` while waiting for the choice (the
     *  caller must `return`) and `true` once applied so resolution continues
     *  (e.g. Preordain's "then draw a card"). Pass a distinct `choiceId` if a
     *  single step raises more than one. */
    orderTop: (
        playerId: string,
        n: number,
        opts: {
            destination: LibraryDestination;
            prompt?: string;
            choiceId?: string;
        }
    ) => boolean;

    /** Reads back the SECOND ordered list of an `order-top` / `look-distribute`
     *  choice at the current resolution step (the `secondZoneIds` the player
     *  submitted, stored under the `${step}:${choiceId}:second` key). Returns an
     *  empty array when the choice carried no second list (e.g. a bot/auto path
     *  that submitted only the primary picks). Pair with `requestChoice` for the
     *  primary list: `digToHand` reads the hand picks via `requestChoice` and
     *  the ordered-bottom cards via this. */
    readOrderedSecond: (choiceId: string) => string[];

    /** Grants persistent card knowledge (ADR 0026, PRD #338): adds `knowerId`
     *  to the `knownTo` set of each library/hand card in `cardInstanceIds`
     *  owned by `zoneOwnerId`. A _look_ effect passes a single looker; a
     *  _reveal_ effect calls this once per player. The knowledge persists on
     *  the instance until a `clearKnowledge` event (shuffle, etc.). No-op for
     *  ids not currently in that owner's library or hand. */
    markKnown: (
        zoneOwnerId: string,
        cardInstanceIds: string[],
        knowerId: string
    ) => void;

    /** Reveals cards to ALL players (ADR 0026, PRD #338 — slice 2). Adds every
     *  player in the game to the `knownTo` set of each library/hand card in
     *  `cardInstanceIds` owned by `zoneOwnerId`. This is the _reveal_ class of
     *  knowledge (vs `markKnown`, the _look_ class which grants to one player):
     *  a revealed card is face-up to everyone and stays so until an uncertainty
     *  event clears it (e.g. a library shuffle, CR 701.20). Idempotent; no-op
     *  for ids not currently in that owner's library or hand. */
    markKnownToAll: (zoneOwnerId: string, cardInstanceIds: string[]) => void;

    /** Reveal dialog — enqueue a one-shot notification that shows `cards` to the
     *  players in `audience` in a transient client dialog (10s / manual close).
     *  Separate from the persistent `markKnown` / `markKnownToAll` knowledge
     *  grant (which the caller still performs): this only drives the momentary
     *  "here is what was revealed" popup. Opt-in for pure look/peek/reveal cards
     *  (Mishra's Bauble, Gitaxian Probe) so scry / surveil / impulse-exile never
     *  pop a dialog. `kind` is `"look"` for a private look (audience = one
     *  player) or `"reveal"` for a public reveal (audience = all). No-op for an
     *  empty audience or an empty/unresolvable card set. */
    notifyReveal: (
        audience: string[],
        cardInstanceIds: string[],
        source: string,
        kind: "look" | "reveal"
    ) => void;

    /** Impulse-draw (ADR 0026, PRD #338 — slice 6). Exiles `cardInstanceId`
     *  (owned by `ownerId`) FACE DOWN from `from`, granting knowledge to
     *  `knowerId` alone (the controller of the effect). The card moves to its
     *  owner's exile pile but its identity stays secret to everyone except
     *  `knowerId`: opponents see a face-down card (CR 406.3 — a card exiled
     *  face down is hidden from all players an effect doesn't let look at it).
     *  Reuses the `knownTo` mechanism, NOT `faceDownOf` (which stays scoped to
     *  battlefield morphs, CR 708). The projection re-derives the per-viewer
     *  gate from `knownTo`. No-op for an id not currently in `from`. */
    exileFaceDown: (
        ownerId: string,
        cardInstanceId: string,
        from: "library" | "hand" | "graveyard",
        knowerId: string
    ) => void;

    /** Reveals `targetPlayerId`'s hand to the controller via a display-only
     *  pending choice (CR 401.4 — "look at"). Returns the revealed card ids
     *  on acknowledgement, `undefined` while suspended waiting for the
     *  controller to dismiss. */
    revealHand: (targetPlayerId: string) => string[] | undefined;

    /** Characteristics of every card in `playerId`'s hand, read from the card
     *  registry (CR 108.1). Used to compute eligibility for effects that
     *  inspect hand cards (Illusionary Mask: "a creature card whose mana cost
     *  could be paid by the {X} spent"). `manaValue` folds X to 0 (CR 202.3b).
     *  `colors` are the card's mana-cost-derived colors (CR 202.2) — read by
     *  hand-inspecting effects that count by color (Inquisition: "white cards
     *  in their hand"). Empty for an empty hand. */
    getHandCards: (playerId: string) => Array<{
        id: string;
        name: string;
        types: CardType[];
        subtypes: string[];
        supertypes: CardSupertype[];
        manaValue: number;
        colors: Color[];
    }>;

    /** Characteristics of every card in `playerId`'s library, read from the
     *  card registry (CR 108.1). Mirrors `getHandCards`; used to precompute the
     *  `candidateIds` allow-list of a filtered `search-library` choice (CR
     *  701.19 — "search your library for a [type] card"), since the submit
     *  validator enforces `candidateIds` on library picks but does not apply a
     *  `PermanentFilter` to hidden library cards. `manaValue` folds X to 0 (CR
     *  202.3b). `supertypes` (issue #677) is the card's printed supertypes
     *  (CR 205.4a) — read by a `choice(zone: "library")` Op's `filter.supertype`
     *  for a "search for a BASIC land card" restriction (Fabled Passage,
     *  Prismatic Vista). `colors` (issue #677) are mana-cost-derived (CR 202.2)
     *  — read by `filter.color` for a "search for a green creature card"
     *  restriction (Natural Order). Empty for an empty library. Used by
     *  Transmute Artifact. */
    getLibraryCards: (playerId: string) => Array<{
        id: string;
        name: string;
        types: CardType[];
        subtypes: string[];
        supertypes: CardSupertype[];
        colors: Color[];
        manaValue: number;
    }>;

    /** Characteristics of every card in `playerId`'s graveyard, read from the
     *  card registry (CR 108.1). Mirrors `getHandCards`; used by effects that
     *  count graveyard cards by type/colour (Nameless Race: "white cards in
     *  their graveyards"). `colors` are mana-cost-derived (CR 202.2); empty for
     *  an empty graveyard. */
    getGraveyardCards: (playerId: string) => Array<{
        id: string;
        name: string;
        types: CardType[];
        subtypes: string[];
        manaValue: number;
        colors: Color[];
    }>;
    /** CR 404 / 400.7 — owner of the graveyard currently holding `id`, or
     *  undefined when the card isn't in any graveyard. Lets the interpreter
     *  resolve a graveyard-source `$source` (Ashen Ghoul's self-reanimation)
     *  to a `graveyard-card` selection without a battlefield presence check. */
    getGraveyardCardOwner: (id: string) => string | undefined;

    /** Revolt (CR 702.RV): true when a permanent the given player controlled
     *  left the battlefield this turn. Read by cards with the Revolt ability
     *  word (Fatal Push). */
    hasRevolt: (playerId: string) => boolean;

    /** Casts a card from the caster's hand face down as a 2/2 colourless
     *  creature spell paying no mana cost (CR 708.2 / 707; Illusionary Mask).
     *  The card is moved hand → stack, turned face down (its real id retained
     *  in `faceDownOf` for the turn-up), and pushed on top of the stack — it
     *  resolves next into a face-down permanent. No-op if the id isn't in the
     *  caster's hand. */
    castFaceDown: (cardInstanceId: string) => void;
    /** Controlled cast (ADR 0037, CR 601) — Word of Command's spell branch.
     *  Casts a card from `controllerId`'s hand as a real spell while another
     *  player makes its decisions:
     *   - the resulting `StackItem` has `castById = controllerId` (the chosen
     *     spell is the controlled opponent's spell, CR 601) and
     *     `actingPlayerId = actingPlayerId` (the Word of Command controller, who
     *     answers any choice routed during the cast/resolution);
     *   - mana is auto-tapped ONLY from lands `controllerId` controls (the
     *     oracle's "mana abilities only from lands that player controls"); the
     *     controller's other resources are untouched;
     *   - if the cost cannot be paid from those lands the card is NOT played
     *     ("if able", CR 608.2 / 117.3) — returns false, nothing changes.
     *  The spell is inserted directly below the resolving item so it becomes the
     *  new top of the stack and resolves next (CR 608.2f). On success the card
     *  has left the hand for the (public) stack. Returns true if it was cast,
     *  false if not played. No-op (false) if the id isn't in `controllerId`'s
     *  hand.
     *
     *  For a TARGETED spell (CR 601.2c) the Acting Player's chosen targets are
     *  passed in via `opts.targets` and written onto the resulting `StackItem`;
     *  the caller is responsible for choosing them from `getLegalTargetsForCard`
     *  (Word of Command — the controller aims the opponent's spell).
     *
     *  X / modal / additional-cost casts (CR 107.3 / 700.2c / 117.9, #579) ride
     *  on the same `opts`, all decided by the Acting Player from the controlled
     *  opponent's resources:
     *   - `chosenX` — the value of X (CR 107.3); folded into the generic cost
     *     (honoring `xFactor`) and snapshotted on the stack item for `getX()`.
     *   - `chosenModeId` — the chosen mode (CR 700.2c); written onto the stack
     *     item so the mode's `resolve` runs and its `staticEffects` apply.
     *   - `additionalSacrificeId` — a permanent on the CONTROLLED OPPONENT's
     *     battlefield to sacrifice as an additional cost (CR 117.9). It is
     *     sacrificed on commit and its pre-sacrifice mana value snapshotted for
     *     `getAdditionalSacrificeMv()`. The caller must validate it matches the
     *     card's `additionalCosts.sacrificeFilter`; a missing/illegal pick
     *     means the cost is unmeetable → the spell is NOT played ("if able").
     *  Any of these unpayable/unmeetable from the opponent's resources →
     *  returns false, nothing changes. */
    castChosenSpell: (
        controllerId: string,
        cardInstanceId: string,
        actingPlayerId: string,
        opts?: {
            targets?: TargetSelection[];
            chosenX?: number;
            chosenModeId?: string;
            additionalSacrificeId?: string;
        }
    ) => boolean;
    /** ADR 0037 / CR 700.2 — the modes of a card in `casterId`'s hand, read
     *  from the registry (CR 108.1), or `[]` for a non-modal card. Lets a
     *  controlled cast (Word of Command) prompt the Acting Player to choose a
     *  mode (CR 700.2c) and then drive targeting/resolution from it. */
    getCardModes: (
        casterId: string,
        cardInstanceId: string
    ) => { id: string; label: string }[];
    /** ADR 0037 / CR 700.2d — the target requirement of a specific mode of a
     *  modal card in `casterId`'s hand, or `undefined` if the mode has none /
     *  the card isn't modal. Drives the Acting Player's target pick for a
     *  controlled modal cast (Word of Command). */
    getCardModeTargetRequirement: (
        casterId: string,
        cardInstanceId: string,
        modeId: string
    ) => TargetRequirement | undefined;
    /** ADR 0037 / CR 107.3 — true when a card in `casterId`'s hand has a
     *  variable {X} in its mana cost (a string-valued `X`). Lets a controlled
     *  cast (Word of Command) know it must ask the Acting Player for X. */
    cardHasXCost: (casterId: string, cardInstanceId: string) => boolean;
    /** ADR 0037 / CR 117.9 — the `additionalCosts.sacrificeFilter` of a card in
     *  `casterId`'s hand, or `undefined` if it has no sacrifice additional
     *  cost. Lets a controlled cast (Word of Command) enumerate the controlled
     *  opponent's matching permanents for the Acting Player to choose from. */
    getCardSacrificeFilter: (
        casterId: string,
        cardInstanceId: string
    ) => PermanentFilter | undefined;
    /** ADR 0037 / CR 107.3 — the highest value of X payable for a card in
     *  `controllerId`'s hand SOLELY from lands `controllerId` controls (Word of
     *  Command's mana restriction). Computed by auto-tapping the controlled
     *  opponent's battlefield + floating pool against the cost at each candidate
     *  X. Returns 0 when even X=0 is unpayable (the caller treats that as "not
     *  played", "if able"). `chosenModeId` is accepted for symmetry but does not
     *  currently change the mana cost (modal X spells are not in the pool). */
    getMaxAffordableX: (
        controllerId: string,
        cardInstanceId: string,
        chosenModeId?: string
    ) => number;
    /** ADR 0037 / CR 601.2c — enumerate the legal targets for a card in
     *  `casterId`'s hand if it were cast as their spell, reusing the exact
     *  `getLegalTargets` candidate set a normal cast uses. Relationship filters
     *  ("opponent"/"you") resolve against `casterId` (the controlled opponent
     *  whose spell it is, CR 601), so an "any target" spell places no
     *  restriction — Word of Command's controller may aim the opponent's
     *  Lightning Bolt at the opponent themselves. Returns the flat candidate
     *  list (empty when there are no legal targets → the controlled cast is not
     *  played, "if able"). Returns `[]` for a card with no `targetRequirement`. */
    getLegalTargetsForCard: (
        casterId: string,
        cardInstanceId: string,
        requirement: TargetRequirement
    ) => TargetSelection[];
    /** CR 601.2c — the `targetRequirement` of a card in `casterId`'s hand, read
     *  from the registry (CR 108.1), or `undefined` for a non-targeted card.
     *  Lets a controlled cast (Word of Command) decide whether the chosen
     *  spell needs the Acting Player to choose targets before casting it. */
    getCardTargetRequirement: (
        casterId: string,
        cardInstanceId: string
    ) => TargetRequirement | undefined;
    /** CR 608.2 — the resolving spell exiles itself as the last thing it does
     *  ("Exile <this spell>", e.g. Recall). Flags the stack item so
     *  `finalizeSpellResolution` routes the card to exile instead of the
     *  graveyard when resolution completes. No-op on a stack item that is a
     *  copy (a copy ceases to exist anyway, CR 707.10) or an ability. */
    exileSelf: () => void;
    /** CR 608.2 / 701.24 (issue #898) — the resolving spell shuffles ITSELF into
     *  its owner's library as the last thing it does ("Shuffle ~ into its
     *  owner's library", Green Sun's Zenith), instead of going to the graveyard
     *  (CR 608.2m). Mirrors `exileSelf` exactly but redirects to the library
     *  (shuffled, ADR 0026 — clears persistent knowledge like any other
     *  shuffle) rather than exile. No-op on a stack item that is a copy (a copy
     *  ceases to exist anyway, CR 707.10) or an ability. */
    shuffleSelfIntoLibrary: () => void;
    /** CR 702.34 — grant Flashback to a target instant/sorcery card in a
     *  graveyard until end of turn (Snapcaster Mage). The `target` is a chosen
     *  `graveyard-card` selection; its flashback cost is set on the card
     *  instance (`grantedFlashback`) so it becomes castable from the graveyard,
     *  and expires at the cleanup step (CR 514.2). When `cost` is omitted the
     *  grant uses the card's own mana cost ("The flashback cost is equal to its
     *  mana cost"). No-op if the target card isn't in a graveyard. */
    grantFlashback: (target: TargetSelection, cost?: ManaCost) => void;
    /** CR 702.34 — true iff the currently-resolving spell was cast from a
     *  graveyard via Flashback. Read by "if this spell was cast from a
     *  graveyard, ..." resolution clauses (Sevinne's Reclamation). False for a
     *  normal hand/exile cast and for abilities. */
    wasCastFromGraveyard: () => boolean;
}

/** When a delayed triggered ability fires (CR 603.7). Shared by the legacy
 *  `DelayedTriggerDef` template path and the `delayedTrigger` Effect Script
 *  Op's inline-body path (ADR 0048). */
export type DelayedTriggerTiming =
    | "next-end-step"
    | "next-end-of-combat"
    | "next-draw-step"
    | "next-main-phase"
    | "next-upkeep"
    /** CR 603.7a / 603.10 — an INSTANCE-scoped, this-turn-bounded leave-watch:
     *  "When that creature leaves the battlefield this turn, …" (Kjeldoran
     *  Elite Guard, Kjeldoran Guard, Phantasmal Mount). Unlike the
     *  phase-boundary timings it fires on a `PERMANENT_LEFT` event for one
     *  specific watched instance (`DelayedTriggerInstance.watchInstanceId`),
     *  not at a step boundary; any instance still pending expires unfired at
     *  CLEANUP (the "this turn" bound, CR 514.2). */
    | "leaves-battlefield"
    /** CR 603.7d / 603.10 (issue #884) — a REPEATING, this-turn-bounded,
     *  combat-event watch: "Whenever a creature blocks this turn, …" (Battle
     *  Cry). Unlike every other timing (single-shot: fires once, then the
     *  instance is dequeued) this one stays queued and fires ONCE PER
     *  `BLOCKERS_CONFIRMED` event for the rest of the turn — every creature
     *  that blocks, not one watched instance. Because the firing event is
     *  still live at fire time (`collectTriggers`, triggers.ts, threads it
     *  onto the built StackItem exactly like a normal triggered ability), the
     *  body may read `$event.blockerId` directly — no `capture` needed. Purged
     *  unconditionally at CLEANUP regardless of how many times it fired (the
     *  "this turn" bound, CR 514.2, phases.ts's CLEANUP delayed-trigger sweep).
     *  Rejects `targetPlayer` / `watch` like the phase-boundary timings
     *  (validate.ts). */
    | "this-turn-creature-blocks";

/** ADR 0048 — the inline body of an Effect-Script-scheduled delayed trigger
 *  (CR 603.7a): a pure-JSON Op list persisted ON the `DelayedTriggerInstance`
 *  (the fired trigger is self-contained in game state — no card-def lookup at
 *  fire time), plus the oracle text shown when it fires. */
export interface DelayedTriggerInlineBody {
    oracleText: string;
    effects: EffectOp[];
}

/** Delayed triggered ability template (CR 603.7a). Declared on the
 *  scheduling card's definition; the engine looks it up by id at fire time
 *  and calls `resolve` with the payload captured at scheduling. Legacy seam
 *  for `resolve()` cards — the DSL path persists an inline body on the
 *  instance instead (`delayedTrigger` Op, ADR 0048). */
export interface DelayedTriggerDef {
    /** Local id on `CardDefinition.delayedTriggers`. */
    id: string;
    /** Oracle text shown on the stack when the trigger fires. */
    oracleText: string;
    /** When the trigger should fire. */
    timing: DelayedTriggerTiming;
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
    /** Ordered pair of basic land types chosen as this permanent entered
     *  (CR 603.6b), stored for the rest of the game. Read by a `subtype-set`
     *  static's `subtypesFor` callback to drive a computed layer-4 subtype swap
     *  (Illusionary Terrain, ADR 0050). The static apply loop passes the raw
     *  `CardInstanceState` as `source`, so this is populated. */
    chosenSubtypes?: string[];
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
    /** True if this creature attacked during its controller's MOST RECENT
     *  PRIOR turn (CR 508.1 / 514.2). Snapshotted at the controller's CLEANUP
     *  so it survives into the next turn. Read by the self attack-restriction
     *  predicate for "can't attack if it attacked during your last turn"
     *  (Giant Turtle, LEG). */
    attackedDuringLastTurn?: boolean;
    /** True if this permanent has dealt damage to an opponent (a player other
     *  than its controller) this turn (CR 120.3). Read by end-step triggers
     *  like Whirling Dervish's "if this creature dealt damage to an opponent
     *  this turn". Cleared at CLEANUP. */
    dealtDamageToOpponentThisTurn?: boolean;
    /** True if this permanent was untapped when its controller's untap step
     *  began this turn (CR 502.1). Read by upkeep triggers phrased "if ~
     *  started the turn untapped" (Rasputin Dreamweaver). */
    startedTurnUntapped?: boolean;
    /** True while the creature still has summoning sickness (CR 302.6) — it
     *  entered the battlefield or came under its current controller's control
     *  since their most recent turn began, and is cleared at that controller's
     *  untap step. Exposed so end-step / upkeep triggers can implement the
     *  "unless it came under your control this turn" exemption (Erg Raiders).
     *  The trigger system passes the raw `CardInstanceState` as `self`, so this
     *  flag is populated for trigger predicates. */
    isSummoningSick?: boolean;
    /** CR 702.30a — Echo: true while this permanent still owes its echo cost
     *  (it came under its controller's control and has not yet had its first
     *  upkeep under that control). Read by the echo trigger's CR 603.4d
     *  intervening-if; the trigger system passes the raw `CardInstanceState`
     *  as `self`, so this flag is populated for trigger predicates. */
    echoPending?: boolean;
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
    /** Per-turn activation tally keyed by ability id (CR 602.5). Mirrors
     *  `CardInstanceState.activationsThisTurn`; the activation validator passes
     *  the raw `CardInstanceState` as `source` to `canActivate`, so this is
     *  populated there. Exposed read-only so a `canActivate` predicate can
     *  enforce a hard per-turn cap (Soul Kiss — "activate no more than three
     *  times each turn"). Reset at turn start. */
    activationsThisTurn?: Readonly<Record<string, number>>;
    /** True for tokens (CR 111). Predicates that scope to "nontoken
     *  permanents" (Jihad's chosen-color clause) read this; populated from the
     *  raw `CardInstanceState` the engine passes through as the view. */
    isToken?: boolean;
    /** Copy-token leave-linkage anchor (CR 603.10). Instance id of the token
     *  this permanent is bound to (Dance of Many). Mirrors the
     *  `CardInstanceState` field; read by the "when the token leaves, sacrifice
     *  this" trigger condition to identify the exact token by id. */
    linkedTokenId?: string;
    /** Cast-time modal choice (CR 700.2c). Present on modal permanents so
     *  static-effect and trigger predicates can read the chosen mode (Jihad's
     *  chosen colour). Mirrors the `CardInstanceState` field. */
    chosenModeId?: string;
    /** Supertypes added to this permanent by a continuous `supertype-set`
     *  static effect or an indefinite `setSupertype` mutation (CR 205.4a).
     *  Each entry is source-keyed (`"indefinite"` for non-source-bound
     *  mutations) so unapply restores the printed supertypes. Read by
     *  `hasSupertype` so the live (mutated) snow status is observed. */
    grantedSupertypes?: ReadonlyArray<{ supertype: string; sourceId: string }>;
    /** Supertypes removed from this permanent by a continuous `supertype-set`
     *  static effect or an indefinite `setSupertype` mutation (Melting /
     *  Arcum's Weathervane — CR 205.4a). Source-keyed like `grantedSupertypes`. */
    removedSupertypes?: ReadonlyArray<{ supertype: string; sourceId: string }>;
    /** CR 702.74a — true iff this permanent was cast for its Evoke cost (set
     *  on the stack item at cast commit when the chosen alternative cost ===
     *  `CardDefinition.evoke`; rides onto the entering permanent for free, the
     *  `escaped` precedent). Read by the `evokeTrigger` template's `condition`
     *  ("if its evoke cost was paid, its controller sacrifices it") — a
     *  check-time (CR 603.4) predicate, not an intervening-if: the flag cannot
     *  change between the ETB event firing and this trigger resolving, so no
     *  resolve-time re-check plumbing is needed. */
    evoked?: boolean;
    /** CR 106.4 / 202.3 — per-colour mana spent to CAST this permanent,
     *  snapshotted from the originating stack item's `notedManaSpent`
     *  (`StackItem`, populated when `CardDefinition.noteManaSpent` is set) the
     *  instant it enters the battlefield (`resolveTopOfStack`). Distinct from
     *  `notedManaSpent` (ephemeral, read via `ctx.getNotedManaSpent()` during
     *  THIS resolution only): this field is a PERSISTENT record on the
     *  permanent, readable by a LATER triggered ability's `condition` (CR
     *  603.4 check-time predicate) — e.g. "when this enters, if {R}{R} was
     *  spent to cast it, ..." (Vibrance/Deceit/Wistfulness, ECL; blocked from
     *  shipping only by missing hybrid `ManaCost` pip representation, issue
     *  #782 — this field is the tracking half of #900 and is otherwise ready
     *  for them). Undefined when the card doesn't opt into `noteManaSpent`. */
    notedManaSpentOnCast?: Record<string, number>;
    /** Raw card definition reference — predicates read manaCost for color, etc. */
    card: Record<string, unknown>;
}

/** Minimal read-only view of the battlefield used by characteristic-defining
 *  abilities (CR 604.3) whose value depends on board state — e.g. Nightmare's
 *  "P/T equal to Swamps you control". Intentionally a subset of the engine's
 *  full GameState so layer computation stays pure. */
export interface StaticEffectStateView {
    players: ReadonlyArray<{
        battlefield: ReadonlyArray<PermanentView>;
        /** Cards in this player's graveyard, exposed for graveyard-counting
         *  characteristic-defining abilities (CR 604.3) — e.g. Lhurgoyf, whose
         *  power equals "the number of creature cards in all graveyards".
         *  Only `types` is needed by current CDAs; the array survives the wire
         *  projection (`PublicGameState.players[].graveyard` keeps `.types`,
         *  stripping only `.card`), so the count is identical server-side and
         *  after `projectPublicState`. */
        graveyard: ReadonlyArray<{ readonly types: readonly CardType[] }>;
    }>;
    /** The player whose turn it currently is (CR 102.1). Optional because the
     *  layer system reads it best-effort: it is a top-level `GameState` field
     *  that survives the wire projection (`PublicGameState` keeps every
     *  GameState key except `players`/`stack`), so turn-conditional
     *  characteristic-defining abilities — e.g. Angry Mob, whose P/T is
     *  "2 plus opponents' Swamps during your turn, 2 otherwise" — can read it
     *  identically server-side and after `projectPublicState`. */
    activePlayerId?: string;
}

/** Read-only board snapshot for a `CardDefinition.entersTappedUnless`
 *  predicate (CR 614.1c) — deliberately narrower than `GameState`, mirroring
 *  `StaticEffectStateView` / `TriggerStateView`, so the same predicate stays
 *  frontend-safe (a client-side "will this enter tapped?" hint reads the
 *  identical shape the server evaluates). `turn` is `GameState.turn`, the
 *  global per-player-turn counter (turn 1 = player one's first turn, turn 2 =
 *  player two's first turn, …) — Starting Town's "first, second, or third
 *  turn of the game" reads it directly. */
export interface LandEntryStateView {
    players: ReadonlyArray<{
        id: string;
        battlefield: ReadonlyArray<PermanentView>;
    }>;
    turn: number;
}

export interface StaticEffectContext {
    /** Colors of a card derived from its mana cost (CR 202.2). Returns W/U/B/R/G subset. */
    getColors: (card: PermanentView) => Color[];
    /** True if card has type "Creature" (CR 208.2). */
    isCreature: (card: PermanentView) => boolean;
    /** True if card has the given subtype. */
    hasSubtype: (card: PermanentView, subtype: string) => boolean;
    /** True if card has the given supertype (CR 205.4 — Legendary, World, Snow,
     *  Basic). Read from the (possibly copied / tokenized) card definition. Used
     *  by predicates that filter on a supertype the live `types`/`subtypes`
     *  arrays don't carry — e.g. the LEG bands-with-other grant-lands' "legendary
     *  creatures you control". */
    hasSupertype: (card: PermanentView, supertype: string) => boolean;
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
    /** Card name (CR 201.2), read from the (possibly copied / tokenized) card
     *  definition. Used by predicates that filter "creatures named X" — e.g.
     *  Akron Legionnaire's "Except for creatures named Akron Legionnaire ...".
     *  Returns `""` when the card id is unknown. */
    getName: (card: PermanentView) => string;
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
    /** When true, the restriction is scoped to the permanent this source is
     *  ATTACHED to (CR 303.4 — an Aura's host), not to a board-wide filter.
     *  The engine synthesizes an instance-id filter for `source.attachedTo`
     *  at untap-collection time (FEM Merseine: "Enchanted creature doesn't
     *  untap ..."). `filter` is ignored when this is set. */
    appliesToHost?: boolean;
    /** Optional source-level gate (CR 611.2c). Evaluated once per source: when
     *  present and false, the restriction contributes nothing this untap step.
     *  Reads the source permanent's live view — Merseine gates on "if this Aura
     *  has a net counter on it" (`source.counters.net > 0`). */
    condition?: (source: PermanentView) => boolean;
    /** Per-candidate refinement resolved at untap-collection time (CR 502.1).
     *  When present, `collectUntapRestrictions` tests every battlefield
     *  permanent that already passes `filter` against this predicate — which
     *  may read the permanent's card DEFINITION (e.g. its `activatedAbilities`)
     *  in addition to its live view — and synthesizes an `instanceIds` filter
     *  from the matches. Needed for restrictions whose target set depends on
     *  characteristics `PermanentFilter` doesn't carry: Tsabo's Web — "Each
     *  land with an activated ability that isn't a mana ability doesn't untap"
     *  (a non-mana ability is `useStack: true`, CR 605.1a; "{T} in its cost" is
     *  `cost.tap`). Mutually exclusive with `appliesToHost`; `filter` still
     *  pre-filters the candidate pool cheaply (Tsabo's Web scopes to
     *  `types: "Land"`) before the predicate refines it. */
    dynamicMatch?: (candidate: PermanentView, def: CardDefinition) => boolean;
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
    /** Optional mana cost that lets the controller BYPASS this restriction
     *  (CR 509.1b — a cost to declare the block). When present, a block that
     *  the `predicate` rejects is still legal provided the blocker's controller
     *  pays this cost as the block is declared. The engine charges it once per
     *  qualifying block at block confirmation (auto-tapping the controller's
     *  mana sources, generic-only — colored bypass costs are not modelled).
     *  Hipparion ("can't block creatures with power 3 or greater unless you
     *  pay {1}") uses this. */
    bypassCost?: ManaCost;
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

/** Card-level attack restriction whose legality depends on the COMPLETE set of
 *  creatures declared as attackers this combat (CR 508.1c, 508.1d). Unlike
 *  `StaticAttackRestriction` — whose predicate sees only the attacking creature
 *  and the defender's battlefield, and is evaluated one creature at a time as
 *  each attacker is selected — this kind can only be judged once every attacker
 *  is known, so the engine evaluates it at attacker CONFIRMATION over the whole
 *  declared set. The mirror of `validateMinimumBlockers` for the attack side.
 *
 *  Collected from the creature's own definition AND from auras attached to it
 *  (CR 303.4), so "enchanted creature can only attack alone" (Errantry) lives on
 *  the Aura and is applied to its host. Orcish Conscripts ("can't attack unless
 *  at least two other creatures attack") carries it on its own definition. */
export interface StaticDeclaredAttackRestriction {
    kind: "declared-attack-restriction";
    id: string;
    /** Returns `true` when the attack is LEGAL, `false` to reject.
     *  `self` = the creature whose attack is being validated.
     *  `declaredAttackers` = every creature declared as an attacker this
     *  combat, INCLUDING `self`. */
    predicate: (
        self: PermanentView,
        declaredAttackers: readonly PermanentView[]
    ) => boolean;
    /** Oracle text displayed as the rejection reason. */
    oracleText: string;
}

/** Card-level block restriction whose legality depends on the COMPLETE set of
 *  creatures declared as blockers this combat (CR 509.1b). The block-side twin
 *  of `StaticDeclaredAttackRestriction`: evaluated at block CONFIRMATION over
 *  the whole declared-blocker set rather than pairwise per assignment. Orcish
 *  Conscripts ("can't block unless at least two other creatures block") uses
 *  it. Collected from the creature's own definition and from attached auras. */
export interface StaticDeclaredBlockRestriction {
    kind: "declared-block-restriction";
    id: string;
    /** Returns `true` when the block is LEGAL, `false` to reject.
     *  `self` = the creature whose block is being validated.
     *  `declaredBlockers` = every creature declared as a blocker this combat
     *  (each blocking at least one attacker), INCLUDING `self`. */
    predicate: (
        self: PermanentView,
        declaredBlockers: readonly PermanentView[]
    ) => boolean;
    /** Oracle text displayed as the rejection reason. */
    oracleText: string;
}

/** Battlefield-scanned, player-scoped enters-tapped replacement (CR 614.1c +
 *  110.5b). Unlike the self-only `entersTapped` card flag (which taps only the
 *  card that carries it as it enters), this kind is scanned across EVERY
 *  permanent on the battlefield and can force OTHER players' permanents to enter
 *  tapped — the symmetric analogue of how Crusade-style anthems (`pt-buff`)
 *  scan all permanents and buff a filtered set, and of
 *  `StaticGlobalAttackRestriction`. Kismet ("Artifacts, creatures, and lands
 *  your opponents control enter tapped") is expressed with this kind.
 *
 *  As a replacement effect (CR 614) it modifies the entering-the-battlefield
 *  event before the permanent is on the battlefield, so the engine evaluates
 *  it at every ETB site against the would-be permanent and its prospective
 *  controller. */
export interface StaticEntersTappedRestriction {
    kind: "enters-tapped-restriction";
    id: string;
    /** Returns `true` when `entering` (a permanent about to enter under
     *  `entering.controllerId`) must enter tapped because of `source`.
     *  `source` = the permanent carrying this effect (Kismet). */
    forcesTapped: (
        entering: PermanentView,
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Oracle text, surfaced for debugging / UI tooltips. */
    oracleText: string;
}

/** Battlefield-scanned, global attack restriction (CR 508.1c). Unlike
 *  `StaticAttackRestriction`, whose predicate reads only the ATTACKING
 *  creature's own static effects (so a creature can restrict only itself),
 *  this kind is scanned across EVERY permanent on the battlefield and can
 *  forbid attacks by creatures OTHER than its source — the symmetric analogue
 *  of how Crusade-style anthems (`pt-buff`) scan all permanents and buff a
 *  filtered set. Moat ("Creatures without flying can't attack") and Akron
 *  Legionnaire ("Except for creatures named Akron Legionnaire and artifact
 *  creatures, creatures you control can't attack") are expressed with this kind.
 *
 *  The predicate receives the candidate attacker, the source permanent
 *  carrying this effect, the live board view, and the static-effect context
 *  helpers. It returns `true` when the attacker is FORBIDDEN by this source
 *  (note the inverted polarity relative to `StaticAttackRestriction`, whose
 *  predicate returns `true` when the attack is LEGAL — here the source is
 *  asserting a prohibition, so `true` means "blocked"). */
export interface StaticGlobalAttackRestriction {
    kind: "global-attack-restriction";
    id: string;
    /** Returns `true` when `attacker` is FORBIDDEN from attacking by `source`.
     *  `attacker` = the creature attempting to attack.
     *  `source` = the permanent carrying this effect (Moat / Akron). */
    forbids: (
        attacker: PermanentView,
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Oracle text displayed as the rejection reason. */
    oracleText: string;
}

/** Battlefield-scanned per-attacker sacrifice-a-land attack tax (CR 508.1c/1g).
 *  Unlike `global-attack-restriction` — a binary forbid/allow prohibition — this
 *  kind expresses a SCALING COST paid as attackers are declared: a taxed
 *  creature CAN attack, but its controller must sacrifice one land for each such
 *  attacker. Flooded Woodlands ("Green creatures can't attack unless their
 *  controller sacrifices a land … for each green creature they control that's
 *  attacking") and its twin Reclamation (black creatures) are expressed with
 *  this kind. Scanned across EVERY permanent on the battlefield (the tax source
 *  is a separate enchantment, not the attacker), mirroring the
 *  `global-attack-restriction` scan.
 *
 *  The engine collects the tax at declare-attackers confirmation
 *  (`collectAttackSacrificeTax`) and charges it there (`convex/gre/combat.ts`),
 *  the attack-side analogue of the Hipparion pay-to-block bypass charge.
 *
 *  SIMPLIFICATION (documented): the CR grants the controller a choice of WHICH
 *  lands to sacrifice. The engine auto-selects the lands (mirroring the
 *  block-bypass mana auto-tap, which likewise does not let the player pick the
 *  mana sources), rather than opening a mid-declaration interactive choice — the
 *  pending-choice pipeline is stack-resolution-bound and the issue (#733)
 *  forbids building a parallel choice mechanism. */
export interface StaticAttackSacrificeTax {
    kind: "attack-sacrifice-tax";
    id: string;
    /** Returns `true` when `attacker` is subject to this tax (Flooded
     *  Woodlands: green creatures; Reclamation: black creatures). Each matching
     *  attacker its controller declares forces one land sacrifice. */
    taxes: (
        attacker: PermanentView,
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Oracle text surfaced as the rejection reason when the controller has
     *  too few lands to pay the tax for every taxed attacker declared. */
    oracleText: string;
}

/** Battlefield-scanned per-attacker MANA attack tax directed at the host's
 *  controller (CR 508.1c/1g — Propaganda / Ghostly Prison / Windborn Muse /
 *  Elephant Grass). The mana analogue of `attack-sacrifice-tax` (#733): a taxed
 *  creature CAN attack the source's controller, but its own controller must pay
 *  `costPerAttacker` for EACH such attacker they declare against that player.
 *  Unlike `attack-sacrifice-tax` (a global "can't attack" that fires regardless
 *  of who is being attacked), this kind is DIRECTED — it only taxes attacks
 *  whose defending player is the source's controller ("can't attack YOU"). The
 *  engine enforces the direction at the collector (`collectAttackManaTax`,
 *  `convex/gre/combat.ts`) by scanning only sources controlled by the player
 *  being attacked.
 *
 *  Charged at declare-attackers confirmation (`confirmAttackers`) via the same
 *  auto-tap mana path as the Hipparion pay-to-block `bypassCost` — the cost is
 *  generic/fungible, auto-tapped from the payer's mana sources; if it cannot be
 *  paid the whole attack declaration is rejected (CR 508.1c — the declaration
 *  is illegal, so the player must re-declare). */
export interface StaticAttackManaTax {
    kind: "attack-mana-tax";
    id: string;
    /** Returns `true` when `attacker` is subject to this tax (Propaganda: every
     *  creature; Elephant Grass clause 3: nonblack creatures). Each matching
     *  attacker its controller declares against the source's controller forces
     *  one `costPerAttacker` payment. */
    taxes: (
        attacker: PermanentView,
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Mana cost charged once per taxed attacker (Propaganda / Ghostly Prison:
     *  {2}; Windborn Muse: {2}). Either a FIXED `ManaCost`, or a function
     *  evaluated once per source AT COMBAT TIME (issue #1066 — "generalize,
     *  don't special-case", `.claude/rules/gre-development.md` § Primitive
     *  reuse): `(source, state, ctx) => ManaCost` reads the live board through
     *  the SAME `StaticEffectStateView`/`StaticEffectContext` every other
     *  static-effect predicate uses. Collective Restraint's tax is `{X}` where
     *  X is the enchantment'S CONTROLLER's Domain — `costPerAttacker: (source,
     *  state) => ({ X: countDomain(state, source.controllerId) })`. Also
     *  unlocks a future Sphere-of-Safety-style "X = your enchantments" tax
     *  without a second special case. */
    costPerAttacker:
        | ManaCost
        | ((
              source: PermanentView,
              state: StaticEffectStateView,
              ctx: StaticEffectContext
          ) => ManaCost);
    /** Oracle text surfaced as the rejection reason when the controller cannot
     *  pay the tax for every taxed attacker declared. */
    oracleText: string;
}

/** Battlefield-scanned landwalk-negation static (CR 509.1b / 702.13). The
 *  source permanent declares that one or more named landwalk keywords can be
 *  blocked "as though the attacker didn't have it" — i.e. the matching
 *  landwalk no longer makes a creature unblockable just because the defending
 *  player controls a land of that subtype. Great Wall (plainswalk), Undertow
 *  (islandwalk), and the suppression statics on Gosta Dirk / Lord Magnus /
 *  Ur-Drago are all expressed with this one parametric kind.
 *
 *  It is the symmetric analogue of `global-attack-restriction`: scanned across
 *  EVERY permanent on the battlefield, it negates evasion granted by OTHER
 *  creatures' landwalk. The negation lives with whoever controls the source —
 *  in practice the defending player, whose battlefield the landwalk evasion
 *  rule already scans — so wiring it into the keyword-evasion pass is enough.
 *
 *  `subtypes` lists the land subtypes whose corresponding landwalk this source
 *  negates (e.g. `["Plains"]` for Great Wall, `["Island"]` for Undertow). A
 *  creature's landwalk keyword is mapped to its land subtype via
 *  `LANDWALK_KEYWORDS`; a match here suppresses that keyword's evasion. */
export interface StaticLandwalkNegation {
    kind: "landwalk-negation";
    id: string;
    /** Land subtypes whose landwalk evasion this source negates. */
    subtypes: string[];
    /** Oracle text (informational; the rule needs no rejection reason since it
     *  ENABLES blocks rather than forbidding them). */
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
    /** Fixed-output form (Blood Moon): the static replaces every matching
     *  target's subtypes with `subtypes`. Provide `applies` + `subtypes`
     *  together. Mutually exclusive with `subtypesFor`. */
    applies?: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    subtypes?: string[];
    /** Computed-output form (Illusionary Terrain, ADR 0050): subsumes both
     *  `applies` and `subtypes`. Returns the replacement subtypes for `target`,
     *  or `null` to leave the target untouched. Reads per-source stored state
     *  (e.g. `source.chosenSubtypes`) so the layer-4 swap is driven by an
     *  on-entry choice rather than a literal. Mutually exclusive with the
     *  fixed form. */
    subtypesFor?: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => string[] | null;
}

/** Layer 4 subtype ADDITION (CR 305.7, 611 — "each land is a Swamp IN ADDITION
 *  TO its other land types"). The additive sibling of `StaticTypeAdd` (which
 *  adds card TYPES): pushes subtypes onto the target's existing `subtypes[]`
 *  instead of replacing them like `StaticSubtypeSet` does — Urborg, Tomb of
 *  Yawgmoth turns Tropical Island into "Island Forest Swamp", not just
 *  "Swamp". Tracked per-`(auraId, subtype)` pair on the target's
 *  `grantedSubtypesAdd` so multiple concurrent sources don't double-add and
 *  removing one source only strips a subtype when no other source still
 *  grants it AND it wasn't printed — the exact `grantedTypes` bookkeeping
 *  shape, mirrored for subtypes. */
export interface StaticSubtypeAdd {
    kind: "subtype-add";
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    subtypes: string[];
}

/** Continuous supertype-mutation static effect (CR 205.4a, 611 — a layer-4-
 *  adjacent supertype-setting effect). Adds and/or removes supertypes on every
 *  permanent for which `applies` returns true while the source stays in play.
 *  Tracked per-source on the affected permanent's `grantedSupertypes` /
 *  `removedSupertypes` so `hasSupertype` reads the live (mutated) status and
 *  unapply restores the printed supertypes when the source leaves.
 *
 *  Used by Melting ("All lands are no longer snow." — a board-wide
 *  `remove: ["Snow"]` whose `applies` matches every Land). Per-target,
 *  indefinite mutations that are NOT tied to a source staying in play
 *  (Arcum's Weathervane) use the imperative `SpellContext.setSupertype`
 *  primitive instead, which writes the same instance markers with an
 *  `"indefinite"` sentinel source. */
export interface StaticSupertypeSet {
    kind: "supertype-set";
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Supertypes added to the target (CR 205.4a). */
    add?: CardSupertype[];
    /** Supertypes removed from the target (CR 205.4a). */
    remove?: CardSupertype[];
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

/** Board-wide static NON-mana additional cost (CR 601.2f / 118.5). Unlike
 *  `StaticCostModifier` (which only adds or removes MANA), this imposes a
 *  per-mana-symbol "sacrifice a permanent matching <filter>" additional cost
 *  on matching spells and/or activated abilities of EVERY player: for each
 *  `perPipColor` mana symbol in the announced object's PRINTED mana cost, one
 *  such sacrifice is required (Drought — "Spells cost an additional 'Sacrifice
 *  a Swamp' to cast for each black mana symbol in their mana costs"). If the
 *  announcing player controls too few matching permanents to pay, the
 *  cast/activation is illegal. Scanned at announcement (affordability gate) and
 *  paid at commit, alongside the mana cost.
 *
 *  Like `StaticCostModifier`, the `appliesTo*` predicates receive the
 *  announced spell/ability (`card`/`source`) plus the carrier permanent
 *  (`effectSource`); Drought is board-wide so it ignores `effectSource` and
 *  matches every spell/ability. The sacrifice victims are auto-chosen (board
 *  order) — a deliberate simplification vs. strict "the player chooses which
 *  to sacrifice", tactically irrelevant for the fungible-land case. */
export interface StaticAdditionalCost {
    kind: "additional-cost";
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
    /** The mana color whose printed symbols drive the sacrifice count. */
    perPipColor: Color;
    /** Each required sacrifice removes one permanent matching this filter from
     *  the announcing player's battlefield (Drought: `{ subtypes: ["Swamp"] }`). */
    sacrificeFilter: PermanentFilter;
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
    /** Narrows `cantBeTargeted` to sources whose SUBTYPES intersect this list
     *  (CR 109.5). Used by "can't be the target of Aura spells" (filter
     *  `["Aura"]`, Bartel Runeaxe / Tetsuo Umezawa). When omitted, the guard
     *  doesn't filter on subtype. Evaluated at the targeting gates, which pass
     *  the source's subtypes. */
    targetSourceSubtypeFilter?: string[];
    /** When true, `cantBeTargeted` blocks SPELLS only, not activated/triggered
     *  abilities (CR 113.3 — "can't be the target of spells", Anti-Magic Aura).
     *  When omitted/false the guard blocks both spells and abilities (Guardian
     *  Beast / shroud). Evaluated at the targeting gates, which pass whether the
     *  source is a spell. */
    targetSourceMustBeSpell?: boolean;
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

/** Continuous PLAYER-scoped shroud static effect (CR 702.18 applied to a
 *  player via CR 115.4 — "You have shroud" / "can't be the target of spells
 *  or abilities"). `StaticPermanentGuard` is per-permanent (`applies(target,
 *  source, ctx)` re-evaluated against every candidate); a player has no
 *  `staticAbilities` array to carry a keyword and no per-object identity to
 *  match against, so this kind is player-scoped instead — mirroring how
 *  `StaticHandSizeOverride` is player-scoped rather than per-permanent. The
 *  reader, `playerHasShroud` (`convex/gre/permanentGuard.ts`), walks every
 *  battlefield (the guard can be granted by a permanent EITHER player
 *  controls) looking for a `player-guard` effect whose `appliesTo` resolves
 *  to the queried player id, evaluated live (CR 611.2) — no per-instance
 *  apply/unapply bookkeeping, the same live-query model `isGuardedAgainst`
 *  uses for permanents.
 *
 *  First consumer: Solitary Confinement ("You have shroud") — the blocked-by
 *  child of issue #1058 / #1128. No shipped card declares this kind yet. */
export interface StaticPlayerGuard {
    kind: "player-guard";
    /** Stable id (for debugging / oracle tracing). */
    id: string;
    /** CR 702.18 shroud / CR 115.4 — "can't be the target of spells or
     *  abilities". Kept as an explicit boolean (not inferred from `kind`),
     *  mirroring `StaticPermanentGuard`'s clause-per-boolean shape, so a
     *  future player-scoped guard clause can be added without a breaking
     *  shape change. Unlike hexproof (CR 702.11b, controller-relative),
     *  shroud has no source-controller exception — it bars EVERY source,
     *  including the guarded player's own spells/abilities. */
    cantBeTargeted?: boolean;
    /** Whose shroud this is. Defaults to `"controller"` (the source
     *  permanent's controller — "You have shroud", read directly off the
     *  card that grants it). `"chosen-player"` mirrors
     *  `StaticHandSizeOverride`'s Cursed-Rack-style shape for a future card
     *  that grants shroud to a player OTHER than its own controller
     *  (resolved via the source instance's stored `chosenPlayerId`); no
     *  shipped card uses this branch yet. */
    appliesTo?: "controller" | "chosen-player";
}

/** Read-only board + combat view passed to a `combat-damage-prevention`
 *  predicate. Extends the layer-system `StaticEffectStateView` (so the
 *  predicate can scan every battlefield for an Aura attached to the damage
 *  source — Enchanted Being) with the live block graph (so it can ask "is the
 *  damage source a creature `self` is currently blocking?" — Wall of Vapor).
 *  Both the fat `GameState` and the projected public state satisfy it. */
export interface CombatPreventionStateView extends StaticEffectStateView {
    /** Live block graph (CR 509.1): blockerId → the attackers it is blocking.
     *  Present only during the combat phase; absent (undefined) outside combat,
     *  where no source-is-blocked relationship can exist. */
    combat?: {
        blockerAssignments: Record<string, readonly string[]>;
    };
}

/** Continuous, source-filtered combat-damage prevention static (CR 615, CR 611
 *  continuous effect — evaluated LIVE at each combat-damage step, never
 *  timestamp-applied or consumed once). The carrier creature prevents all
 *  combat damage that would be dealt TO IT by any source matching `prevents`.
 *
 *  Distinct from the TURN-SCOPED prevention shields (`combatDamageImmunity`,
 *  `preventAllCombatDamageThisTurn`, the per-player source-matched
 *  `playerDamagePrevention`): those are one-shot / single-turn entries written
 *  into game state and purged at a duration boundary. This kind is a property
 *  of the creature's card definition, re-queried at the moment damage is about
 *  to be applied, so it re-applies automatically every combat for as long as
 *  the creature is on the battlefield ("for as long as", CR 611.2).
 *
 *  Mirrors the live-query model of `StaticPermanentGuard` / `isCombatDamageImmune`:
 *  the predicate observes current board/combat state, so e.g. Wall of Vapor's
 *  "creatures it's blocking" reads the live block graph with no per-instance
 *  flag. Two LEG users:
 *    - Enchanted Being — `damageSource` is enchanted by any Aura.
 *    - Wall of Vapor — `damageSource` is a creature `self` is currently
 *      blocking. */
export interface StaticCombatDamagePrevention {
    kind: "combat-damage-prevention";
    /** Stable id (for debugging / oracle tracing). */
    id: string;
    /** Returns `true` when combat damage from `damageSource` to `self` (the
     *  permanent carrying this effect) must be prevented.
     *  `self` = the prevention's owner (the creature taking damage).
     *  `damageSource` = the creature about to deal the combat damage.
     *  `state` = live board + block graph.
     *  `ctx` = static-effect helpers (colors, types, subtypes, ...). */
    prevents: (
        self: PermanentView,
        damageSource: PermanentView,
        state: CombatPreventionStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Oracle text, surfaced for debugging / UI tooltips. */
    oracleText: string;
}

/** Battlefield-scanned, PLAYER-scoped casting restriction (CR 601.3a / 601.2 —
 *  a continuous effect that forbids a player from CASTING a class of spell).
 *  Unlike every other `StaticEffect`, this kind does NOT mutate any permanent —
 *  it is a read-time gate evaluated when the engine lists a player's legal hand
 *  actions (`getLegalActions`) and again server-side at the cast mutation. The
 *  scan mirrors `StaticGlobalAttackRestriction`: any permanent on either
 *  battlefield can forbid casting, so the predicate receives the candidate
 *  caster, the spell about to be cast, the source carrying the effect, and the
 *  live board view.
 *
 *  Brand of Ill Omen ("Enchanted creature's controller can't cast creature
 *  spells") is expressed with this kind: the source is the Aura, and `forbids`
 *  returns true when `caster` controls the Aura's host and the spell is a
 *  creature spell. */
export interface StaticCastRestriction {
    kind: "cast-restriction";
    id: string;
    /** Returns `true` when `caster` is FORBIDDEN from casting `spell` by
     *  `source` (note the inverted polarity, like
     *  `StaticGlobalAttackRestriction.forbids`).
     *  `caster` = id of the player attempting to cast.
     *  `spell` = the card about to be cast (its live `types` are authoritative).
     *  `source` = the permanent carrying this effect (the Aura). */
    forbids: (
        caster: string,
        spell: PermanentView,
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Oracle text displayed as the rejection reason. */
    oracleText: string;
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
    | StaticSubtypeAdd
    | StaticSupertypeSet
    | StaticColorGrant
    | StaticUntapRestriction
    | StaticBlockRestriction
    | StaticAttackRestriction
    | StaticDeclaredAttackRestriction
    | StaticDeclaredBlockRestriction
    | StaticGlobalAttackRestriction
    | StaticAttackSacrificeTax
    | StaticAttackManaTax
    | StaticLandwalkNegation
    | StaticEntersTappedRestriction
    | StaticAttackRequirement
    | StaticBlockRequirement
    | StaticHandSizeOverride
    | StaticCostModifier
    | StaticAdditionalCost
    | StaticManaSubstitution
    | StaticPermanentGuard
    | StaticPlayerGuard
    | StaticCombatDamagePrevention
    | StaticKeywordRemove
    | StaticAbilityLoss
    | StaticCastRestriction;

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

/** The five basic land types (CR 305.6), in WUBRG order. Canonical home for a
 *  constant several cards had duplicated locally (subtype-matters filters and
 *  choose-a-basic-type modes — Magical Hack, Illusionary Terrain, Reclamation,
 *  Erode/Path). Lives here in the card type module (not `gre/constants.ts`,
 *  which imports the card registry and would form a load-order cycle for early
 *  set files). Import from `../../types` rather than re-declaring. */
export const BASIC_LAND_SUBTYPES: readonly string[] = [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
];

/** Domain (CR 702 preamble ability word, issue #1066) — counts the DISTINCT
 *  basic land subtypes among lands `controllerId` controls (0–5, CR 305.6). A
 *  dual land (two basic subtypes) contributes both; scanned by CONTROLLER, not
 *  owner (CR 110.4 — a stolen land still counts for its controller). Shared by
 *  `SpellContext.getDomain` (the `{ domain: { of } }` EffectValue member) and
 *  every Domain-scaled `StaticPTCDA.compute` closure (Kavu Scout, Wayfaring
 *  Giant, Exotic Curse, Strength of Unity) and the Collective Restraint
 *  dynamic `costPerAttacker` — ONE execution path, no duplicated scan.
 *  Deliberately reads the RAW `PermanentView.subtypes` (mirroring every other
 *  `StaticEffectContext`-scoped predicate in this codebase, e.g.
 *  `STATIC_EFFECT_CTX.hasSubtype`) rather than the text-change-aware
 *  `applySubstitution` helper `gre/constants.ts`'s `getBasicLandMana` uses —
 *  no shipped INV card needs a text-changed land to count for Domain, and
 *  `StaticEffectStateView` carries plain `PermanentView`s, not the raw
 *  `CardInstanceState` `applySubstitution` reads. */
export function countDomain(
    state: StaticEffectStateView,
    controllerId: string
): number {
    const found = new Set<string>();
    for (const player of state.players) {
        for (const permanent of player.battlefield) {
            if (permanent.controllerId !== controllerId) continue;
            if (!permanent.types.includes("Land")) continue;
            for (const subtype of permanent.subtypes) {
                if (BASIC_LAND_SUBTYPES.includes(subtype)) {
                    found.add(subtype);
                }
            }
        }
    }
    return found.size;
}

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
    | "PERMANENT_UNTAPPED"
    | "ABILITY_ACTIVATED"
    | "STATE_CHECK"
    | "TRIGGER_FIZZLED"
    | "ATTACKERS_DECLARED"
    | "BLOCKERS_CONFIRMED"
    | "ATTACKER_UNBLOCKED"
    | "CARD_DRAWN"
    | "CARD_DISCARDED"
    | "CARD_MILLED"
    | "LIFE_LOST"
    | "LIFE_GAINED"
    | "COUNTER_REMOVED";

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
     *  only when the permanent was sacrificed (CR 701.16); `"destroy"` (issue
     *  #1054) is set only when the permanent was destroyed via
     *  `SpellContext.destroy` / `destroyAll` (CR 701.8) — the replacement-aware
     *  path in `destroyWithReplacements`/`regenerateOrDestroy`. Every other
     *  exit (lethal-damage SBA outside a resolving spell/ability, bounce, mill,
     *  exile) is left undefined. Read by leave-the-battlefield triggers that
     *  must distinguish sacrifice/destruction from other departures (Urza's
     *  Miter — "Whenever an artifact you control is put into a graveyard, if it
     *  wasn't sacrificed, ..."; Karmic Justice — "... a spell or ability an
     *  opponent controls DESTROYS a noncreature permanent you control ..."). */
    cause?: "sacrifice" | "destroy";
    /** Controller of the spell or ability that directly caused this departure
     *  (issue #1054), when the departure was driven by a resolving spell/
     *  ability's `SpellContext.destroy` / `destroyAll` / `sacrifice` call.
     *  Undefined for departures with no such causer — an automatic SBA sweep
     *  (lethal combat damage, the legend/world rule), a bounce/mill effect that
     *  doesn't route through those primitives, or any exit not driven by a
     *  currently-resolving spell/ability. Read by "caused by an opponent"-style
     *  conditions (Karmic Justice, Sacred Ground) via `causedByOpponent` in
     *  `abilities/triggers/leftTrigger.ts` — never a controller-agnostic
     *  reader. */
    causerControllerId?: string;
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
    /** Storm (CR 702.40a, ADR 0052) — tally of spells cast by any player
     *  BEFORE this one this turn (`GameState.spellsCastThisTurn` read prior
     *  to increment). Fixes storm's copy count at the moment of casting: a
     *  spell cast later (while priority is held, before the storm trigger
     *  resolves) is not included, because it is not yet reflected when this
     *  event is emitted. Optional (defaults to 0 where read) so the many
     *  pre-existing hand-built `SpellCastEvent` test fixtures that predate
     *  storm stay valid — the real production emitter (`emitSpellCastEvent`,
     *  gre/state.ts) always sets it. */
    priorSpellCount?: number;
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
    /** CR 605.4 — set once this tap's triggered MANA abilities (Wild Growth,
     *  Mana Flare, Gauntlet of Might) have already been resolved off-stack. The
     *  cost-payment tap path (`tapSourceIntoPayment` → `realizeManaAbilityTapBonus`)
     *  resolves them eagerly so the bonus is in the pool for the affordability
     *  check, but keeps the event queued so the tap's NON-mana triggers still
     *  fire (deferred to cast commit) and an undo (`untapForPayment`) can still
     *  discard it. This flag stops the later commit-time trigger flush from
     *  re-resolving the mana bonus a second time (double-mana). */
    manaTriggersResolved?: boolean;
}

/** Emitted when a permanent transitions tapped → untapped (CR 701.20b "becomes
 *  untapped"). Fired by every untap site that flips `isTapped` from true to
 *  false: the untap step (CR 502.2) and untap effects (Twiddle). NOT fired for
 *  a permanent that was already untapped (no transition). Carries the source's
 *  controller/types/subtypes (last-known information) so `matches()` can filter
 *  without re-reading the registry, mirroring `PermanentTappedEvent`. Used by
 *  the exile-and-return mechanism (Tawnos's Coffin, ADR 0028). */
export interface PermanentUntappedEvent {
    type: "PERMANENT_UNTAPPED";
    permanentId: string;
    controllerId: string;
    permanentTypes: ReadonlyArray<CardType>;
    permanentSubtypes: ReadonlyArray<string>;
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
    /** Effective toughness of the attacker at block confirmation (CR 613,
     *  including counters and continuous effects). Read by toughness-gated
     *  combat-pairing triggers — Infinite Authority ("a creature with
     *  toughness 3 or less"), Infernal Medusa. Optional only so synthetic
     *  test events can omit it; the engine always populates it. */
    attackerToughness?: number;
    blockerId: string;
    blockerControllerId: string;
    blockerTypes: ReadonlyArray<CardType>;
    blockerSubtypes: ReadonlyArray<string>;
    /** Effective toughness of the blocker at block confirmation (CR 613).
     *  Twin of `attackerToughness` for the becomes-blocked direction. */
    blockerToughness?: number;
}

/** CR 509.1h — an attacker that remained UNBLOCKED after blocks were
 *  declared. Emitted once per unblocked attacker alongside the per-pair
 *  BLOCKERS_CONFIRMED events, so "whenever this creature attacks and isn't
 *  blocked" triggers (Murk Dwellers, Merchant Ship) can fire exactly once at
 *  the same point the block graph is finalized. */
export interface AttackerUnblockedEvent {
    type: "ATTACKER_UNBLOCKED";
    attackerId: string;
    attackerControllerId: string;
    attackerTypes: ReadonlyArray<CardType>;
    attackerSubtypes: ReadonlyArray<string>;
}

/** Emitted whenever a player draws one or more cards (CR 121.1 — "draws a
 *  card"). One event per draw batch carries the drawing player's id and the
 *  count of cards actually moved from library to hand (an empty library draws
 *  fewer than requested). Used by "when you draw a card" triggers (Fasting).
 *  The natural turn-based draw, draw-look replacements (Aladdin's Lamp), and
 *  effect-driven draws (`drawCards`) all emit it through the same choke point. */
export interface CardDrawnEvent {
    type: "CARD_DRAWN";
    /** Player who drew the card(s). */
    playerId: string;
    /** Number of cards actually drawn (>= 1; library exhaustion may make this
     *  fewer than the requested amount). */
    count: number;
}

/** Emitted whenever a card is discarded — moved from a player's hand to their
 *  graveyard by a discard (CR 701.8). One event per card, emitted AFTER the
 *  card has landed in the graveyard (and after CR 614 discard replacements such
 *  as Library of Leng have had their chance) so "whenever you discard a card"
 *  triggers (Necropotence — "exile that card from your graveyard") can find the
 *  card in its destination zone. NOT emitted when a discard replacement
 *  consumed the event and routed the card elsewhere (the card was not
 *  discarded). Every discard path — the cleanup-step max-hand-size discard
 *  (CR 514.1), effect-driven discards (`discardCard` / `discardAtRandom`), and
 *  discard activation costs (Jandor's Ring, Coral Helm) — flows through the
 *  single `discardToGraveyard` choke point that emits this. */
export interface CardDiscardedEvent {
    type: "CARD_DISCARDED";
    /** Player who discarded the card (its owner — CR 701.8). */
    playerId: string;
    /** Instance id of the discarded card, now in `playerId`'s graveyard. */
    cardInstanceId: string;
    /** Card definition id of the discarded card, so type-based filters can run
     *  without re-reading the graveyard. */
    cardId?: string;
}

/** Emitted whenever a card is put into its owner's graveyard from their
 *  library by a mill (CR 701.17). One event per card, emitted AFTER the card
 *  has landed in the graveyard so "when this card is put into your graveyard
 *  from your library" self-triggers (Gaea's Blessing) can locate the card in
 *  its destination zone — the same emit-after-move discipline as
 *  `CardDiscardedEvent`. Every mill path flows through the single `millCards`
 *  choke point (the `mill` Op's only primitive) that emits this. */
export interface CardMilledEvent {
    type: "CARD_MILLED";
    /** Owner of the milled card, whose library it came from and whose graveyard
     *  it now sits in (CR 701.17 — a mill always moves a card from a player's
     *  own library to their own graveyard). */
    ownerId: string;
    /** Instance id of the milled card, now in `ownerId`'s graveyard. */
    cardInstanceId: string;
    /** Card definition id of the milled card, so type-based filters can run
     *  without re-reading the graveyard. */
    cardId?: string;
    /** Card types snapshotted at the moment of the mill (CR 603.10 last-known
     *  information), for "whenever a creature card is milled"-style filters. */
    types?: ReadonlyArray<CardType>;
}

/** Emitted whenever a player loses life (CR 119.3 — a player's life total
 *  decreasing, whether from a "lose life" effect, a paid life cost, or damage
 *  dealt to that player). One event per life-loss, emitted AFTER the life total
 *  has actually dropped (and after any CR 614 lifeloss replacement such as
 *  Lich), carrying the ACTUAL amount lost (post-replacement, post-prevention).
 *  Used by "whenever you lose life" triggers (Oath of Lim-Dûl — "for each 1
 *  life you lost, ..."). Every life-loss path — the `loseLife` primitive, paid
 *  life costs (CR 118.4), and all damage-to-player sinks (CR 119.3 — combat,
 *  noncombat, reflected) — flows through the single `loseLifeEmitting` choke
 *  point (or, for damage, calls `emitLifeLost` after the prevention/replacement
 *  chain) so the event fires off EVERY path. NOT emitted for a zero-amount loss
 *  (fully prevented / replaced away to 0). */
export interface LifeLostEvent {
    type: "LIFE_LOST";
    /** Player whose life total decreased. */
    playerId: string;
    /** Amount of life actually lost (>= 1, post-replacement, post-prevention). */
    amount: number;
    /** Whether the loss came from damage (CR 119.3). Lets "whenever you lose
     *  life" triggers that care about the source distinguish damage from a
     *  direct life payment; Oath of Lim-Dûl treats both identically. */
    fromDamage: boolean;
}

/** Emitted whenever a player gains life (CR 119.3 — a player's life total
 *  increasing from a "gain life" effect or the CR 702.15b lifelink life gain
 *  that accompanies damage dealt by a lifelink source). One event per life
 *  gain, emitted AFTER the life total has actually risen (and after any CR 614
 *  lifegain replacement such as Lich's "if you would gain life, draw instead"),
 *  carrying the ACTUAL amount gained (post-replacement). The symmetric
 *  counterpart of `LifeLostEvent`: every life-gain path — the `gainLife`
 *  primitive and lifelink (CR 702.15b) — flows through the single
 *  `gainLifeEmitting` choke point so "whenever you gain life" triggers fire off
 *  EVERY path. NOT emitted for a zero-amount gain (fully replaced away to 0). */
export interface LifeGainedEvent {
    type: "LIFE_GAINED";
    /** Player whose life total increased. */
    playerId: string;
    /** Amount of life actually gained (>= 1, post-replacement). */
    amount: number;
}

/** Counter-removal event emitted whenever counters are removed from a
 *  permanent via `SpellContext.removeCounter` (CR 122.6). Carries the counter
 *  type, how many were removed, and how many of that type remain afterwards.
 *  A general primitive: Vanishing (CR 702.63d) listens for `counterType:
 *  "time"` reaching `remaining: 0` to fire its sacrifice; future "whenever a
 *  counter is removed" cards reuse it. Emitted from the SpellContext primitive
 *  only — the `payRemoveCounterCost` activation-cost path is stateless and does
 *  not emit (no card removes a `time` counter as a cost today). */
export interface CounterRemovedEvent {
    type: "COUNTER_REMOVED";
    /** Instance id of the permanent the counters were removed from. */
    instanceId: string;
    /** Controller of that permanent at the moment of removal. */
    controllerId: string;
    /** Kind of counter removed (e.g. "time", "fade", "+1/+1"). */
    counterType: string;
    /** How many counters were actually removed (clamped to the prior count). */
    removed: number;
    /** How many counters of `counterType` remain after the removal. */
    remaining: number;
}

export type GameEvent =
    | DamageDealtEvent
    | PhaseBeginEvent
    | CreatureDiedEvent
    | PermanentEnteredEvent
    | PermanentLeftEvent
    | SpellCastEvent
    | PermanentTappedEvent
    | PermanentUntappedEvent
    | AbilityActivatedEvent
    | StateCheckEvent
    | TriggerFizzledEvent
    | AttackersDeclaredEvent
    | BlockersConfirmedEvent
    | AttackerUnblockedEvent
    | CardDrawnEvent
    | CardDiscardedEvent
    | CardMilledEvent
    | LifeLostEvent
    | LifeGainedEvent
    | CounterRemovedEvent;

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
            power?: number;
            toughness?: number;
            /** True for tokens (CR 111). Exposed so state-trigger conditions
             *  can scope to "nontoken permanents" — Jihad's self-sacrifice
             *  clause. Populated from the raw `CardInstanceState`. */
            isToken?: boolean;
            /** Raw card definition reference — condition predicates read
             *  `manaCost` to derive color (CR 202.2). Populated from the raw
             *  `CardInstanceState` the engine passes through as the view. */
            card?: Record<string, unknown>;
            /** Tap state (CR 701.20a). Exposed so a frontend affordability hint
             *  for a `tapOtherFilter` activation cost (Hand of Justice) can
             *  count untapped matching permanents the controller controls. */
            isTapped?: boolean;
            /** Layer-5 colour override / printed colours, when derivable
             *  (CR 202.2 / 613.1d). Populated by the engine where available so a
             *  `tapOtherFilter` colour clause ("white creatures") reads the same
             *  colour the rest of the engine sees. */
            colors?: ReadonlyArray<Color>;
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
    /** Count of creatures that have died this turn (CR 700.4 die tally,
     *  maintained in `removePermanentTo` and reset at turn start). Exposed so a
     *  CR 603.4 / 603.4d condition can gate on "if a creature died this turn"
     *  without waiting for resolve — Osai Vultures' end-step intervening-if
     *  reads it. Mirrors `GameState.deathsThisTurn`; undefined defaults to 0. */
    deathsThisTurn?: number;
    /** Player ids under Abeyance's turn-scoped "can't activate abilities that
     *  aren't mana abilities" lock (CR 602.1 / 605.1a, issue #1124). Mirrors
     *  `GameState.cannotActivateAbilitiesThisTurn`; exposed so `getStackAbilities`
     *  (`src/lib/card-utils.ts`) can hide a controller's non-mana abilities as a
     *  UI hint — the `activateAbility` mutation is the authoritative gate. */
    cannotActivateAbilitiesThisTurn?: ReadonlyArray<string>;
    /** Source ids that currently hold an armed exile-and-return bundle
     *  (ADR 0028). The bundle's existence is the "delayed trigger is armed"
     *  flag: a return trigger (Tawnos's Coffin's leaves/untaps) gates its
     *  `condition` on membership so an untap of a coffin holding nothing does
     *  not push a do-nothing trigger. Populated from `GameState.exileHeld`. */
    exileHeld?: ReadonlyArray<{ sourceId: string }>;
    /** Read-only view of the live combat state (CR 509). Exposed so a
     *  combat-keyed triggered ability can inspect the block graph at
     *  trigger-check time — Rampage N (CR 702.23) reads `blockerAssignments`
     *  to dedupe the per-pair BLOCKERS_CONFIRMED emission down to one fire per
     *  becoming-blocked. Mirrors the corresponding `GameState.combat` fields;
     *  undefined when no combat is in progress (and in synthetic test events). */
    combat?: {
        readonly attackerIds: ReadonlyArray<string>;
        /** blockerId → attackerIds it is blocking (CR 509.2). Not pruned when a
         *  blocker leaves the battlefield (CR 509.1h); consumers that need the
         *  live count must re-check battlefield presence. */
        readonly blockerAssignments: Readonly<Record<string, string[]>>;
        /** Ids of attackers that became blocked this combat (CR 509.1h). */
        readonly blockedAttackerIds?: ReadonlyArray<string>;
    };
    /** Controllers with an active Gaze of Pain rider this turn (ICE). Exposed
     *  so Gaze of Pain's graveyard-zone trigger can gate on "until end of turn"
     *  membership. Mirrors `GameState.gazeOfPainActiveThisTurn`. */
    gazeOfPainActiveThisTurn?: ReadonlyArray<string>;
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
    /** CR 603.3b — for "whenever one or more X happen(s), ..." wording: when
     *  a single game action emits several events of `event`'s type that all
     *  `matches` this ability in the SAME `collectTriggers` batch (e.g. a
     *  board wipe emitting one `PERMANENT_LEFT` per dying permanent), the
     *  ability still triggers only ONCE for that batch — not once per event.
     *  Opt-in and rare: plain "whenever a permanent enters/dies" triggers
     *  (Soul Warden) must keep firing once per event, so this defaults to
     *  false. Moonshadow (ecl/black.ts, issue #684/#928) is the first
     *  consumer. */
    oncePerEventBatch?: boolean;
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
    /** Effect run when the trigger resolves from the stack. Optional when
     *  `resolveSteps` is supplied instead. */
    resolve?: (ctx: SpellContext, event: GameEvent) => void;
    /** Effect Script (ADR 0045, issue #803) — this triggered ability's effect
     *  as declarative, JSON-pure data, executed by the interpreter
     *  (`convex/gre/effects/interpreter.ts`) through the SAME shared code path
     *  as spell-site scripts, with the trigger's controller and source
     *  permanent bound (`$source`, `ctx.controller`). The firing event is not
     *  threaded into a script (an Effect Script reads the resolution context,
     *  not the event) — a trigger whose effect must inspect the event stays
     *  imperative. Mutually exclusive with `resolve` / `resolveSteps` on this
     *  ability — combining them throws at the `getAbilityEffectFn` seam and
     *  fails the catalogue-wide validation sweep. */
    effects?: EffectOp[];
    /** Multi-step resolution (CR 608.2), mirror of `CardDefinition.resolveSteps`
     *  and `ActivatedAbility.resolveSteps`. The engine runs the step closures in
     *  order, checkpointing `resolutionStep` so a `requestChoice` suspension
     *  resumes the SAME step and never re-runs completed steps. Use when a
     *  trigger commits an irreversible action (a draw) BEFORE a later choice
     *  that can suspend — a single `resolve` would re-run the action on every
     *  resume (the Bazaar of Baghdad re-draw class of bug). Sylvan Library's
     *  draw-step "draw two, then pay-or-topdeck each" is the first consumer.
     *  Steps receive only `ctx`; read the trigger scope via `ctx.controller`. */
    resolveSteps?: ((ctx: SpellContext) => void)[];
    /** Retained when this permanent becomes a copy of another (CR 707.9d —
     *  "except it has this ability"). Vesuvan Doppelganger's upkeep re-copy
     *  trigger sets this so it keeps functioning after the copy overwrites the
     *  presented characteristics. Ignored for non-copies. */
    retainedThroughCopy?: boolean;
    /** CR 605.1b / 605.4 — this triggered ability is a MANA ABILITY: it has no
     *  target, triggers from an activated mana ability resolving (or mana being
     *  added), and could add mana when it resolves (Wild Growth, Mana Flare,
     *  Gauntlet of Might, Snowfall). A triggered mana ability does NOT use the
     *  stack: the engine resolves it immediately, in the same game action that
     *  fired it, before any player receives priority (`processPendingActionTriggers`).
     *  This is what makes the extra mana available WITHIN the same cost payment /
     *  cumulative-upkeep step that tapped the land, with no intervening priority
     *  pass. A trigger that adds no mana (Manabarbs' damage) must NOT set this —
     *  it is a normal stack trigger. */
    manaAbility?: boolean;
    /** CR 605.4 — a DECLARATIVE descriptor of the guaranteed additional mana a
     *  triggered mana ability contributes on a for-mana tap of a matching land
     *  (Wild Growth {G}, Gauntlet of Might {R}, Mana Flare produced-colour,
     *  Fertile Ground any-colour). The `resolve` closure that actually adds the
     *  mana is opaque, so the PREDICTIVE potential-mana calculators — the
     *  castability gate (`canPotentiallyPayCost`, rules.ts) and the human
     *  auto-tap solver (`buildAutoTapSources`, autoTap.ts) — can't see the bonus
     *  without this. Absent → the bonus is invisible to prediction, which is
     *  CORRECT for a RESTRICTED-mana bonus (Snowfall's cumulative-upkeep {U}
     *  can't pay a spell cost, so it must not inflate castability). Set this only
     *  when the added mana is freely spendable. Read by `getActiveTapManaBonuses`
     *  (`gre/tapManaBonus.ts`); does NOT affect how the ability resolves. */
    manaBonusForPotential?: TapManaBonusForPotential;
}

/** Descriptor for {@link TriggeredAbility.manaBonusForPotential} — the extra
 *  mana a Wild-Growth-style triggered mana ability guarantees on a for-mana tap
 *  of a matching land, and which lands it applies to. Consumed by the predictive
 *  potential-mana models only (CR 605.4). */
export interface TapManaBonusForPotential {
    /** Which tapped lands grant the bonus. `"host"` = the aura's enchanted land
     *  (`source.attachedTo`, Wild Growth / Fertile Ground); a `filter` = any
     *  land the source's global rider matches (Gauntlet of Might → Mountain,
     *  Mana Flare → any Land). */
    appliesTo: "host" | { filter: PermanentFilter };
    /** The extra mana produced on a matching for-mana tap:
     *  - `fixed` — a constant contribution (Wild Growth {G}, Gauntlet {R}).
     *  - `anyColor` — `count` mana of any one colour, freely chosen at resolve
     *    (Fertile Ground). Modelled as fully flexible (errs toward affordable).
     *  - `perProducedColor` — `count` mana matching a colour the tapped land
     *    itself produced (Mana Flare "one mana of any type that land produced"). */
    amount:
        | { kind: "fixed"; mana: Partial<Record<Color, number>> }
        | { kind: "anyColor"; count: number }
        | { kind: "perProducedColor"; count: number };
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
    | "destroy"
    | "graveyard-bound";

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
    /** CR 104 reason. "life-zero" (CR 704.5a) and "poison" (CR 704.5c) are the
     *  loss conditions routed through this replacement framework in-engine. */
    reason: "life-zero" | "poison";
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

/** Graveyard-bound event: a card about to be put into a graveyard FROM
 *  ANYWHERE (CR 400.7) — a permanent dying/being sacrificed/destroyed off
 *  the battlefield, a hand card being discarded, a milled library card, a
 *  spell finishing resolution or being countered. Distinct from `"discard"`
 *  (hand→graveyard only, intercepts the discard action itself, e.g. Library
 *  of Leng redirecting to library top) and `"destroy"` (battlefield-only
 *  pre-image of one graveyard-bound path). This is the general chokepoint
 *  for "if a card would be put into a graveyard, exile it instead"-style
 *  effects (Yawgmoth's Will, Dauthi Voidwalker — issue #1145). Engine
 *  callers consult `applyGraveyardBoundReplacements` (`gre/replacements.ts`)
 *  BEFORE committing the move so a matching replacement can redirect the
 *  card before it ever touches the graveyard array. */
export interface GraveyardBoundReplacementEvent {
    kind: "graveyard-bound";
    /** Instance id of the card about to enter a graveyard. */
    cardInstanceId: string;
    /** The card's owner (CR 400.7 — a card always goes to ITS OWNER's
     *  graveyard, regardless of who controlled it). Replacements filter on
     *  this to scope "your graveyard" (Yawgmoth's Will) vs "an opponent's
     *  graveyard" (Dauthi Voidwalker). */
    ownerId: string;
    /** Zone the card is leaving. Read by source-filtering replacements that
     *  care where the card came from (none shipped yet, but the field is
     *  carried for parity with `DiscardReplacementEvent`/`DestroyReplacementEvent`
     *  and future cards). */
    fromZone: Exclude<Zone, "graveyard">;
    /** Mutable: the zone the card actually lands in once the replacement
     *  loop settles. Starts as `"graveyard"`; a matching replacement
     *  rewrites this to `"exile"` to redirect the card (CR 614.1a). Unlike
     *  `"destroy"`, this event never fully cancels (`{kind:"consumed"}`) —
     *  the card always ends up SOMEWHERE, so redirection is expressed as a
     *  `"modified"` rewrite of `destination`, not a null result. */
    destination: "graveyard" | "exile";
    /** Counters to stamp on the card once it lands in `destination` (Dauthi
     *  Voidwalker's void counter). Only meaningful when `destination !==
     *  "graveyard"` — a card that lands in the graveyard normally is never
     *  tagged. */
    tagCounters?: Record<string, number>;
}

export type ReplacementEvent =
    | DamageReplacementEvent
    | LifeChangeReplacementEvent
    | DiscardReplacementEvent
    | LoseGameReplacementEvent
    | TapReplacementEvent
    | DestroyReplacementEvent
    | GraveyardBoundReplacementEvent;

/** Side-effect mutators handed to a `ReplacementEffect.replace` body. Lets
 *  the effect issue follow-up actions ("draw N cards instead", "sacrifice
 *  these permanents", "move this card to library top") without coupling
 *  card definitions to the full engine surface. */
export interface ReplacementApplyContext {
    /** Player ids in active-then-non-active order (CR 101.4). */
    apNapOrder: () => string[];
    drawCards: (playerId: string, amount: number) => void;
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

// --- Effect Script (ADR 0045 / ADR 0046) ---
//
// A declarative, JSON-pure card effect: an ordered, flat list of Ops executed
// top to bottom by the interpreter (`convex/gre/effects/interpreter.ts`),
// each Op calling an existing SpellContext primitive — one execution path, no
// parallel engine. This slice (issue #800) is the FLAT-SEQUENCE CORE: the
// four frozen structural constructs (bind/ref/if/forEach, ADR 0045) land in
// follow-up slices and are intentionally absent here.
//
// Every shape below MUST stay pure JSON (no functions, no RegExp, no
// undefined-carrying holes) — a DSL-only card is a DB row waiting to happen
// (ADR 0046). The catalogue-wide purity guard test enforces this.

/** Player selector for player-scoped Ops, resolved by the interpreter at
 *  execution time:
 *  - `"controller"` — the resolving spell/ability's controller (CR 109.5).
 *  - `"opponent"` — the controller's opponent (two-player games, CR 102.2).
 *  - `{ target: n }` — the spell's n-th announced target (CR 601.2c order),
 *    which must have been chosen as a player target; if the announced target
 *    is missing or is not a player, the Op is skipped (CR 608.2b — the spell
 *    does as much as it can).
 *  - `{ ref: "$x.controller" }` — the controller of a bound object snapshot
 *    (ADR 0045 ref construct). Used by "its controller gains…" (Swords to
 *    Plowshares) — snapshot semantics let the controller survive the object
 *    changing zone (CR 608.2h last-known information).
 *  - `{ ref: "$x.owner" }` — the OWNER of a bound object snapshot (issue
 *    #1106, CR 108.3 — immutable, distinct from `.controller`). Used by
 *    "return it to its owner's hand, then that player discards" (Recoil):
 *    a control-magic effect (Spinal Embrace) can make owner and controller
 *    diverge, and CR 400.7 names the OWNER, not whoever currently controls
 *    the stolen permanent. */
export type EffectPlayerRef =
    | "controller"
    | "opponent"
    | { target: number }
    /** The controller of the object in an announced target slot (CR 109.5 —
     *  "its controller"). Resolves through `SpellContext.getController`, which
     *  reads a spell's caster or a permanent's controller — so this is the
     *  "its controller pays" selector (Force Spike, issue #806). Skipped when
     *  the slot is missing at resolution (CR 608.2b). */
    | { controllerOf: EffectTargetRef }
    | EffectRef;

/** Object selector for object-scoped Ops: the spell's n-th announced target
 *  (CR 601.2c order). If the announced target no longer exists at resolution,
 *  the Op is skipped (CR 608.2b). */
export type EffectTargetRef = { target: number };

/** Object selector accepted by object-acting Ops (destroy / exile /
 *  dealDamage): an announced target slot, OR — inside a `forEach` over
 *  permanents (issue #807) — the bare `{ ref: "$each" }` naming the current
 *  iteration member. The bare ref carries the member's instance id (captured
 *  in the per-iteration snapshot); when the member has left the battlefield
 *  before its iteration the Op is skipped (CR 608.2b — the spell does as much
 *  as it can). */
export type EffectObjectSelector = EffectTargetRef | EffectRef;

/** Destination zone for the `moveZone` Op (ADR 0045, issue #839). A card can
 *  be moved to any of the five game zones a one-shot effect addresses
 *  (CR 400.7). `battlefield` is only reachable from a graveyard card (the
 *  reanimation half — Resurrection); the other four are plain zone changes. */
export type EffectMoveZone =
    | "hand"
    | "library"
    | "graveyard"
    | "exile"
    | "battlefield";

// --- Structural constructs: ref + count (ADR 0045, issue #802) ---
//
// The Effect Script grammar is FROZEN at four structural constructs
// (bind/ref/if/forEach). This slice adds two of them — `bind` (a field on an
// Op that names its result) and the value-reading constructs `ref` and
// `count`. There are NO expressions: an Op parameter that carries a runtime
// number is exactly one of a literal, a ref, or a count — nothing composes.

/** ref — reads a single property off a bound object snapshot (ADR 0045). The
 *  string is `"$binding.property"`; `$binding` MUST be named by an earlier
 *  Op's `bind`, and `property` is `power` / `toughness` / `manaValue`
 *  (numeric contexts) or `controller` (player contexts). `manaValue` (issue
 *  #680) is CR 202.3's printed mana value, read the same way for a
 *  battlefield permanent OR a graveyard-card snapshot (`moveZone`'s
 *  reanimation `bind` — Reanimate's "lose life equal to that card's mana
 *  value"); a snapshot's `power`/`toughness` stay 0 for a graveyard-card
 *  binding (CR 208.2 — a card not on the battlefield has no power/toughness).
 *  The snapshot is captured when the binding Op ran (CR 608.2h / 603.10
 *  last-known information), so a ref still reads the right value after the
 *  object has changed zone — e.g. Swords to Plowshares reads the exiled
 *  creature's power. `validateEffectScript` statically rejects an undefined
 *  binding or an unknown property path. */
export type EffectRef = { ref: string };

/** count — the size of a declaratively-selected set of cards (ADR 0045),
 *  the "for each …" numeric construct (CR 122 counting). No object handles
 *  escape: only the cardinality is produced. */
export type EffectCount = { count: EffectCountSpec };

/** A declarative card-set selector for the `count` construct. Counts the cards
 *  in one zone controlled/owned by a player, optionally filtered. */
export interface EffectCountSpec {
    /** The zone whose cards are counted. `battlefield` counts permanents the
     *  player controls (CR 110); `graveyard` counts cards in the player's
     *  graveyard (CR 404). */
    zone: "battlefield" | "graveyard";
    /** Whose zone (CR 109.5 relative selectors). Required UNLESS
     *  `acrossAllPlayers` is set, in which case it is omitted (the count spans
     *  every player's zone, not one player's). */
    controller?: EffectPlayerRef;
    /** Count across ALL players' zones (CR 122 counting — the "in all
     *  graveyards" scope of Accumulated Knowledge, issue #985), summing each
     *  player's matching cards. Mutually exclusive with `controller`. */
    acrossAllPlayers?: boolean;
    /** Optional card filter (AND of the listed fields). Omitted = count all. */
    filter?: EffectCardFilter;
    /** Fixed integer multiplier applied to the counted cardinality (CR 122 —
     *  "TWICE the number of nonbasic lands", Price of Progress, issue #999).
     *  A literal scaling factor baked into the `count` construct, NOT arithmetic
     *  composition of two values (the frozen-grammar defence, ADR 0045 — nothing
     *  else composes it). Defaults to 1 (plain "the number of …"); `times: 2` is
     *  "twice the number of …". Must be a positive integer. */
    times?: number;
    /** Count distinct card types among cards in the graveyard instead of total
     *  cards (CR 205 — card types are Artifact, Battle, Creature, Enchantment,
     *  Land, Kindred, Planeswalker, Sorcery, and Instant). Meaningful only for
     *  `zone: "graveyard"`; ignored for `zone: "battlefield"`. Used by
     *  Delirium: "four or more card types among cards in your graveyard". */
    countTypes?: boolean;
}

/** Minimal JSON-pure card filter for `count` sets and a `choice` Op's
 *  zone-"library" search restriction — a card type, subtype, supertype,
 *  color and/or mana value ceiling (CR 205 / 205.4a / 202.2 / 202.3). All
 *  fields present are ANDed; an array-valued `type`/`subtype`/`color` is an OR
 *  WITHIN that field (CR 205 "an artifact creature" needs both dimensions
 *  true, but a fetchland's "a Forest or Island card" is one dimension with
 *  two acceptable values — mirrors `PermanentFilter.subtypes`' OR-of-array
 *  semantics). `supertype` (issue #677) is the "search your library for a
 *  BASIC land card" restriction (Fabled Passage, Prismatic Vista) — a printed
 *  supertype, not a type/subtype. `color` (issue #677) is the mana-cost-
 *  derived color restriction (Natural Order's "a green creature card").
 *  `manaValueAtMost` (issue #677) is a mana-value ceiling: a FIXED literal
 *  (Spellseeker's "mana value 2 or less", Brightglass Gearhulk's "mana value 1
 *  or less") OR a DYNAMIC `{ X: true }` (issue #898, Green Sun's Zenith's
 *  "mana value X or less" — the caster's chosen {X}, read at resolution via
 *  `ctx.getX()`, same as every other `EffectXValue` site). Deliberately small:
 *  it answers "how many X" / "search for an X card", not arbitrary predicates. `isToken` (issue #920) restricts a
 *  `zone: "battlefield"` pick to tokens (`true`, Sheoldred's Edict's "a
 *  creature TOKEN") or nontoken permanents (`false`, Sheoldred's Edict's "a
 *  NONTOKEN creature") — a direct passthrough of the `PermanentFilter.isToken`
 *  field `matchesPermanentFilter` already checks (`convex/cards/filters.ts`),
 *  just exposed to the DSL (ADR 0045 "generalize, don't add"). Meaningful only
 *  for `zone: "battlefield"`: a hidden-zone pick (hand/library/graveyard) has
 *  no engine-tracked `isToken` on its card-shape reader, and tokens don't
 *  meaningfully persist off the battlefield anyway (CR 111.7). `excludeType`
 *  (issue #682) is the negative of `type` — mirrors the ALREADY-EXISTING
 *  `TargetRequirement.excludeTypes` field (Terror's "target nonartifact,
 *  nonblack creature") exactly, just exposed on the hand/library/graveyard
 *  filter shape too (ADR 0045 "generalize, don't add" — a symmetric field on
 *  an existing primitive, not a new one). A card matches only if it has NONE
 *  of the listed types: Thoughtseize / Inquisition of Kozilek / Grief's
 *  "nonland card" is `excludeType: "Land"`; Duress's "noncreature, nonland
 *  card" is `excludeType: ["Land", "Creature"]`. AND with `type` when both are
 *  present (an unlikely but not-forbidden combination). */
export interface EffectCardFilter {
    type?: CardType | CardType[];
    subtype?: string | string[];
    supertype?: CardSupertype;
    /** Negative of `supertype` (CR 205.4a) — a card matches only if it has
     *  NONE of the listed supertypes. Mirrors `TargetRequirement.excludeSupertypes`
     *  (Wasteland's "target nonbasic land") and `excludeType`, just exposed on
     *  the `count` filter shape (ADR 0045 "generalize, don't add" — a symmetric
     *  field on an existing primitive). `excludeSupertype: "Basic"` is the
     *  "nonbasic land" selector (Price of Progress, issue #999). A single value
     *  is shorthand for one supertype; AND with every other field. Read against
     *  the LIVE supertype set (snow-aware) for battlefield counts. */
    excludeSupertype?: CardSupertype | CardSupertype[];
    color?: Color | Color[];
    manaValueAtMost?: number | EffectXValue;
    isToken?: boolean;
    excludeType?: CardType | CardType[];
    /** Match cards by exact printed name (CR 201.2 — "each other card named
     *  Accumulated Knowledge", Relentless Rats' "cards named ~", issue #985). A
     *  single card name; matched case-sensitively against the registry name,
     *  ANDed with every other field. */
    name?: string;
    /** OR ACROSS filter dimensions (issue #897) — a disjunctive clause list.
     *  Every other field on this interface is ANDed together (and each of
     *  `type`/`subtype`/`color` is itself an OR-WITHIN-that-field array,
     *  issue #677) — neither expresses "type X OR subtype Y" (Magda, Brazen
     *  Outlaw's "an artifact or Dragon card": `type: "Artifact"` OR
     *  `subtype: "Dragon"`, two DIFFERENT fields, not one array on either).
     *  `any` is a non-empty array of full `EffectCardFilter` clauses (each
     *  itself the existing AND-of-fields shape); the containing filter
     *  matches a card if the card matches AT LEAST ONE clause in `any`,
     *  ANDed with every other top-level field present alongside `any` (there
     *  usually are none — Magda's filter is just `{ any: [{ type:
     *  "Artifact" }, { subtype: "Dragon" }] }`). Deliberately the ONE
     *  disjunctive clause this issue asks for — not a general boolean filter
     *  grammar (no `all`/`not` siblings; scope note in #897). */
    any?: EffectCardFilter[];
}

/** X — the chosen-cost value (CR 107.3, 601.2b), a thin JSON-pure skin over
 *  `SpellContext.getX()` (the value announced for {X} in the spell/ability's
 *  cost at cast/activation time, snapshotted on the stack item as `chosenX`).
 *  A fifth `EffectValue` grammar member (issue #852, PRD #826), NOT an Op and
 *  NOT a new structural construct — it does not reopen ADR 0045 (only a fifth
 *  bind/ref/if/forEach-style construct would). Unblocks Earthquake / Stream of
 *  Life / Fireball-style scripts whose amount is exactly `ctx.getX()`. There is
 *  still no arithmetic: `X` reads back the one chosen number, nothing composes
 *  it (a card like Braingeyser drawing `X` cards, Drain Life dealing `X`). */
export type EffectXValue = { X: true };

/** counters — the number of counters of a given `type` on a selected object
 *  (CR 122.6), a thin JSON-pure skin over `SpellContext.getCounterCount`
 *  (issue #1015). A SIXTH `EffectValue` grammar member; like `X` (issue #852)
 *  it is NOT an Op and NOT a new STRUCTURAL construct — it does not reopen
 *  ADR 0045 (only a fifth bind/ref/if/forEach-style construct would). `of` is
 *  an object selector resolved through the SAME `resolveObjectRef` path every
 *  object-acting Op uses — an announced target slot (`{ target: N }`), the
 *  resolving source at an ability site (`{ ref: "$source" }`), or the current
 *  `forEach` member (`{ ref: "$each" }`); `type` is the counter kind ("fuse",
 *  "+1/+1", "charge", …). Reads the LIVE count on the battlefield permanent
 *  (0 when the object has left play — CR 608.2b). Unblocks the "value equal to
 *  the number of <type> counters on it" class (Powder Keg's MV-matched sweep,
 *  issue #997; damage / pump / draw scaled by counters). Still no arithmetic:
 *  it reads back one count, nothing composes it. */
export type EffectCountersValue = {
    counters: { of: EffectObjectSelector; type: string };
};

/** kickerCount — how many times the resolving spell's Kicker cost was paid as
 *  it was cast (CR 702.33 / 702.33e), a thin JSON-pure skin over
 *  `SpellContext.getKickerCount`. A seventh `EffectValue` grammar member; like
 *  `X` (issue #852) and `counters` (issue #1015) it is NOT an Op and NOT a new
 *  STRUCTURAL construct — it does not reopen ADR 0045 (only a fifth
 *  bind/ref/if/forEach-style construct would). Reads back one number (0 = not
 *  kicked), nothing composes it. `> 0` is the "if this spell was kicked" test
 *  (Overload, Burst Lightning, Bloodchief's Thirst, Tear Asunder, Consult the
 *  Star Charts); the raw count drives "a charge counter for each time it was
 *  kicked" (Everflowing Chalice, expressed via `entersWith.counters` count
 *  `"kicker"`, not this value). */
export type EffectKickerCountValue = { kickerCount: true };

/** manaValue — the mana value (CR 202.3) of a selected object, a thin JSON-pure
 *  skin over `SpellContext.getManaValue`. An eighth `EffectValue` grammar
 *  member; like `counters` (issue #1015) it is NOT an Op and NOT a new
 *  STRUCTURAL construct. `of` is an object selector resolved through the SAME
 *  `resolveObjectRef` path every object-acting Op uses — an announced target
 *  slot (`{ target: N }`), the resolving source (`{ ref: "$source" }`), or the
 *  current `forEach` member (`{ ref: "$each" }`). Reads the LIVE printed mana
 *  value of the battlefield permanent (0 when the object has left play,
 *  CR 608.2b). Unblocks the "destroy target … if its mana value is N or less"
 *  class (Overload). Still no arithmetic: it reads back one number, nothing
 *  composes it. */
export type EffectManaValueValue = {
    manaValue: { of: EffectObjectSelector };
};

/** domain — the Domain ability word (CR 702 preamble, italic, no independent
 *  rules meaning): the number of basic land types among lands a PLAYER
 *  controls (0–5, CR 305.6), a thin JSON-pure skin over
 *  `SpellContext.getDomain` / the shared `countDomain` helper (this module).
 *  A NINTH `EffectValue` grammar member (issue #1066); like `manaValue` it is
 *  NOT an Op and NOT a new STRUCTURAL construct — it does not reopen ADR 0045.
 *  Unlike every other value member's object-scoped `of` (`counters`,
 *  `manaValue` — "of THIS permanent"), Domain's `of` is a PLAYER selector
 *  (`EffectPlayerRef`): Domain is a per-player scalar, not a per-object one,
 *  and some cards read a player OTHER than the resolving controller
 *  (Collapsing Borders' "that player gains life equal to THEIR OWN Domain" —
 *  the firing upkeep's player, not the enchantment's owner). Composes with
 *  every amount-taking Op (`dealDamage` — Tribal Flames, `gainLife` —
 *  Wandering Stream, `createToken`'s `count` — Ordered Migration, `pump`'s
 *  `power`/`toughness` — Power Armor). `times` (Wandering Stream's "gain TWO
 *  life for each basic land type") is a FIXED integer scaling factor baked
 *  into the construct, defaulting to 1 — mirrors `EffectCountSpec.times`
 *  (issue #999) exactly, NOT arithmetic composition of two values (the
 *  frozen-grammar defence, ADR 0045 — nothing else composes it). Beyond that
 *  one literal multiplier there is still no arithmetic: it reads back one
 *  count, nothing else composes it. */
export type EffectDomainValue = {
    domain: { of: EffectPlayerRef; times?: number };
};

/** A runtime numeric parameter of an Op (ADR 0045): a literal count, a `ref`
 *  reading a bound object's numeric property, a `count` of a selected set, the
 *  chosen-cost `X` (issue #852), a `counters` count on a selected object
 *  (issue #1015), a selected object's `manaValue` (issue #680), or a player's
 *  `domain` (issue #1066). The value grammar is capped at these — no
 *  arithmetic, no expressions (the frozen-grammar defence, ADR 0045). */
export type EffectValue =
    | number
    | EffectRef
    | EffectCount
    | EffectXValue
    | EffectCountersValue
    | EffectKickerCountValue
    | EffectManaValueValue
    | EffectDomainValue
    | EffectEscapedValue;

/** CR 702.138e — resolves to 1 if the referenced permanent ESCAPED (was cast
 *  from a graveyard via Escape, `CardInstanceState.escaped`), else 0. Powers the
 *  "sacrifice it unless it escaped" branch as a numeric comparison
 *  (`{ left: { escaped: { ref: "$source" } }, op: "eq", right: 0 }` → true when
 *  NOT escaped). `of` resolves through the same object-ref path every
 *  object-acting Op uses ($source / an announced slot / $each); an unresolvable
 *  object yields 0 (CR 608.2b — the effect treats a gone permanent as
 *  not-escaped). */
export interface EffectEscapedValue {
    escaped: { of: EffectObjectSelector };
}

/** negate — wraps any plain `EffectValue` and flips its resolved sign at read
 *  time (issue #926, blocking Toxic Deluge's "-X/-X"). NOT a tenth `EffectValue`
 *  grammar member and NOT a new Op or structural construct (ADR 0045 stays
 *  closed — one unary negation, no arithmetic, no composition: nesting
 *  (`{ negate: { negate: X } }`) is grammatically impossible because `negate`
 *  wraps `EffectValue` itself, which does not include `negate`).
 *
 *  Scope: every OTHER `EffectValue` member (`X`, `counters`, `kickerCount`,
 *  `manaValue`, `domain`) reads back a quantity that is non-negative BY
 *  NATURE (CR 107.3 chosen X ≥ 0, CR 122.6 counter count ≥ 0, …) — there was
 *  no way to express "the negative of the chosen X" before this. A literal
 *  integer can already be negative directly (`power: -3`, Weakness) — `negate`
 *  is for wrapping the non-literal members.
 *
 *  Deliberately scoped to the SIGNED value grammar (`EffectSignedValue`,
 *  today only `pump`'s `power`/`toughness`, issue #840) rather than the
 *  general `EffectValue` grammar `dealDamage`/`loseLife`/`draw`/`gainLife`
 *  etc. use: a negative damage/life-loss/draw amount has no CR meaning at
 *  those sites. Widen `isEffectValue` (`convex/gre/effects/validate.ts`) to
 *  admit `negate` at a specific Op slot only when a real card needs it there
 *  — do not assume it is already legal. */
export interface EffectNegatedValue {
    negate: EffectValue;
}

/** A SIGNED runtime numeric parameter (issue #926): a plain `EffectValue`, or
 *  its `negate`-wrapped opposite. The pump Op's `power`/`toughness` (CR 613.4c,
 *  issue #840) are the only site today — a shrink (Weakness) or a chosen-cost
 *  driven "-X/-X" (Toxic Deluge). */
export type EffectSignedValue = EffectValue | EffectNegatedValue;

/** JSON-pure mana specification for the `addMana` Op (CR 106.1, issue #850) —
 *  a per-colour amount map. Only fixed coloured / colorless pips: no variable
 *  `{X}`, generic, or "mana of any colour" (a runtime colour choice, not a
 *  static amount). At least one positive entry is expected; non-positive
 *  amounts are ignored by the mana-add primitives (CR 106.1). */
export interface EffectManaPool {
    W?: number;
    U?: number;
    B?: number;
    R?: number;
    G?: number;
    C?: number;
}

/** One branch of a `coinFlip` Op (CR 705, issue #851): the nested Effect Script
 *  run for one outcome of the flip, plus the one-liner shown on the reveal
 *  overlay while the coin lands (ADR 0023 — `requestCoinFlip` pauses resolution
 *  to animate the outcome). `effects` is a non-empty Op list, run through the
 *  SAME `runOpList` path an `if` branch / `optionChoice` mode uses, so it
 *  composes bind / ref / if / forEach and even a further suspending Op. */
export interface EffectCoinFlipBranch {
    /** One-liner previewed on the WIN/LOSE reveal overlay ("Create a 5/5
     *  Djinn"). Required — `requestCoinFlip` shows it as the landed face's
     *  consequence. */
    consequence: string;
    /** Ops run when the flip lands on this branch's outcome. */
    effects: EffectOp[];
}

/** A LIST-valued capture source of a `delayedTrigger` Op (ADR 0049, issue
 *  #866): resolves to N serializable instance ids at SCHEDULING (cast) time,
 *  frozen into the payload and read in the body as a `string[]` list binding.
 *  Restricted to the capture-source position for now (no general forEach
 *  `combatPartners` selector until a card needs it).
 *
 *  v1 has one member: `{ set: "combatPartners", of: { target: n } }` — the
 *  creatures that BLOCKED OR WERE BLOCKED BY the announced target this turn
 *  (CR 509.1h, bidirectional). Scanned from the live block graph at cast time
 *  (freeze-at-cast, ADR 0049): combat state is live-only, so a fire-time scan
 *  would return empty once the target itself died. The selector vocabulary may
 *  grow like the Op vocabulary — one member + validator/interpreter arm per
 *  set — without reopening ADR 0045. */
export type EffectListSelector = {
    set: "combatPartners";
    of: EffectTargetRef;
};

/** One captured value of a `delayedTrigger` Op (ADR 0048): what crosses the
 *  scheduling-time → fire-time boundary. A SINGLE-VALUE source resolves to ONE
 *  serializable string at scheduling:
 *  - `{ target: n }` — the announced target slot's object/player id;
 *  - `{ ref: "$x" }` — a bound snapshot's instance id (or a players-set
 *    `$each`'s player id);
 *  - `{ ref: "$x.controller" }` — the bound snapshot's controller player id;
 *  - `{ ref: "$event.<field>" }` — a firing-event field id (ADR 0049, #865);
 *  - a literal string — stored as-is.
 *  A LIST source — `{ select: EffectListSelector }` (ADR 0049, #866) — resolves
 *  to N ids frozen into the payload as a `string[]`.
 *  At fire time each captured value is re-bound as the body's initial binding
 *  environment: a live battlefield permanent id becomes a FRESH snapshot (the
 *  body acts on the object's current state, CR 603.7a), a player id becomes a
 *  player binding, a `string[]` becomes a list binding a `forEach` iterates,
 *  and anything else stays uncaptured so body Ops reading it skip (CR 608.2b —
 *  the object left before the trigger fired). */
export type EffectCaptureSource =
    | EffectTargetRef
    | EffectRef
    | string
    | { select: EffectListSelector };

// --- Structural construct: forEach (ADR 0045, issue #807) ---
//
// The LAST of the four frozen structural constructs (bind/ref/if/forEach):
// iterate a sub-list of Ops over a declaratively-selected set, with `$each`
// bound per iteration. This closes the grammar — it never grows again; only
// the Op vocabulary does (reopening ADR 0045 is the only path to a fifth
// construct).

/** The declarative set selector of a `forEach` construct (issue #807). The
 *  set is determined ONCE, at construct entry (CR 608.2i — information from
 *  the game is determined only once, as the effect is applied), then frozen:
 *  members that leave their zone mid-iteration are skipped when their turn
 *  comes (CR 608.2b — the spell does as much as it can), and objects that
 *  enter after the selection are never iterated.
 *
 *  - `{ set: "players" }` — every player, iterated in APNAP order
 *    (CR 101.4: active player first, then each other player in turn order).
 *    `$each` is the current player, read with a bare `{ ref: "$each" }` in a
 *    player position ("each player sacrifices…", Innocent Blood).
 *  - `{ set: "permanents", … }` — battlefield permanents (CR 110), optionally
 *    scoped to one controller (omitted = every player's battlefield — the
 *    sweep default, "destroy all creatures") and filtered by type/subtype
 *    (CR 205). `$each` is the current permanent: object positions take the
 *    bare `{ ref: "$each" }`; `$each.power` / `$each.toughness` /
 *    `$each.controller` read its snapshot (CR 608.2h last-known information,
 *    captured at iteration entry).
 *
 *  - `{ set: "bound", ref: "$partners" }` — iterate a `string[]` LIST binding
 *    (ADR 0049, issue #866), in stored order. The ref MUST name a list binding
 *    (a `delayedTrigger` list-valued capture); `$each` is the current member's
 *    snapshot (object positions take the bare `{ ref: "$each" }`), a member
 *    that has left the battlefield is skipped (CR 608.2b). Only iterable — no
 *    controller/filter (the list is already frozen at capture).
 *
 *  Like the Op vocabulary — and unlike the construct list — the selector
 *  shapes may grow (new zones, new scopes) without reopening ADR 0045. */
export type EffectForEachSelector =
    | { set: "players" }
    | {
          set: "permanents";
          /** Permanents only exist on the battlefield (CR 110.1); the field
           *  is explicit so future card-set selectors (graveyard sweeps) can
           *  join without a shape change. */
          zone: "battlefield";
          /** Whose battlefield (CR 109.5 relative selectors). Omitted =
           *  every player's (mass sweeps). */
          controller?: EffectPlayerRef;
          /** Optional type/subtype filter (AND, CR 205). Omitted = all. */
          filter?: EffectCardFilter;
      }
    | {
          /** A bulk graveyard-set sweep (issue #1056, CR 404) — iterate ALL
           *  cards matching a filter in one or more graveyards, with no
           *  per-card choice. Each member `$each` binds as a graveyard-card
           *  snapshot the body acts on (a `moveZone { target: { ref: "$each" },
           *  to: "battlefield" }` reanimates it — Replenish; a mass reanimation
           *  like Living Death iterates every player's graveyard). The frozen
           *  member set is snapshotted once at construct entry (CR 608.2i), so a
           *  card leaving mid-iteration is skipped (CR 608.2b), not re-selected. */
          set: "graveyard";
          /** Whose graveyard (CR 109.5 relative selectors). Omitted = every
           *  player's, in APNAP order (mass reanimation — Living Death). */
          controller?: EffectPlayerRef;
          /** Optional card filter (AND, CR 205). Omitted = all cards. */
          filter?: EffectCardFilter;
      }
    | { set: "bound"; ref: string };

/** The declarative object-set selector for `divideIntoPiles` (ADR 0053, pile
 *  division). Deliberately its OWN small type rather than reusing
 *  `EffectForEachSelector` — the pile-division object set is always a
 *  SINGLE-OWNER zone (the divide-piles pending choice is zone + candidateIds
 *  validated against exactly one `zoneOwnerId`, mirroring `partition`/
 *  Camouflage's per-pile picks), so the "players" / "bound" forEach variants
 *  don't apply here and `controller`/`player` are REQUIRED (not optional —
 *  every one of the six INV pile cards resolves to exactly one owner, even
 *  Bend or Break's "each player divides their OWN lands", which is expressed
 *  as two sibling `divideIntoPiles` Ops — one per player — rather than a
 *  `{ set: "players" }` wrapper, CR 102.2 2-player-only simplification).
 *  - `permanents` — battlefield permanents controlled by one player
 *    (Do or Die's "creatures target player controls", Bend or Break's
 *    "nontoken lands they control").
 *  - `library-top` — the top `count` cards of one player's library, REVEALED
 *    to all players (CR 701.16) as the selector resolves (Fact or Fiction).
 *  - `graveyard` — cards in one player's graveyard, optionally filtered
 *    (Death or Glory's "creature cards in your graveyard"). The graveyard is
 *    already public (CR 400.2), so no reveal step is needed. */
export type EffectPileObjectSelector =
    | {
          set: "permanents";
          zone: "battlefield";
          controller: EffectPlayerRef;
          filter?: EffectCardFilter;
      }
    | { set: "library-top"; player: EffectPlayerRef; count: EffectValue }
    | {
          set: "graveyard";
          controller: EffectPlayerRef;
          filter?: EffectCardFilter;
      };

/** The Pending Choice kinds a `choice` Op may request (issue #805). A strict
 *  subset of the existing `ZonePickKind` taxonomy — the Op maps 1:1 onto
 *  `SpellContext.requestChoice`, reusing the whole Pending Choice pipeline
 *  (enqueue → generic prompt UI → `submitResolutionChoice` → resume): no new
 *  choice infrastructure, no new UI (ADR 0045 "choice suspension"). Only the
 *  MID-RESOLUTION card-semantic kinds are scriptable; the phase-/SBA-level
 *  kinds (`untap-pick`, `mulligan-bottom`, `legend-keep`, `draw-look-keep`,
 *  cleanup `discard-hand`) are raised by the engine, never by a card script.
 *  Grows freely — one union member + the validator allow-list per kind. */
export type EffectChoiceKind =
    | "choose-permanents"
    | "sacrifice-permanents"
    | "discard-hand"
    | "search-library"
    | "choose-hand-card"
    | "choose-graveyard-card";

/** One mode of an `optionChoice` Op (ADR 0045, issue #849) — a labelled
 *  sub-effect-list. The chooser picks one mode; the interpreter then runs that
 *  mode's `effects` as a nested Op list (the same `runOpList` path an `if`
 *  branch uses, so nested binds / refs / suspensions compose). `label` is the
 *  human-readable mode text shown in the choice UI ("Prevent the next 3 damage
 *  …", "Gain 3 life"). A modal spell's modes are the bullet clauses of its
 *  "Choose one —" text (CR 700.2 / 601.2b). `id` (optional) is the stable
 *  option identifier the choice pipeline stores and the UI submits — supply it
 *  to give a mode a semantic id ("tap" / "untap" / "Swamp"); when omitted the
 *  interpreter derives it from the mode's position (`String(index)`). */
export interface EffectMode {
    label: string;
    effects: EffectOp[];
    id?: string;
}

/** One step of an Effect Script. Ops are small, orthogonal and composable
 *  (target scale ~80k cards) — each maps 1:1 onto a SpellContext primitive.
 *  The Op vocabulary grows freely; the grammar never does (ADR 0045). Op
 *  names are governed by `EFFECT_OP_REGISTRY` in
 *  `convex/cards/mechanicsRegistry.ts` — a script using an unregistered Op
 *  name fails the catalogue-wide validation sweep. An Op may carry a `bind`
 *  naming a snapshot of the object it acts on, for a later Op's `ref`. */
export type EffectOp =
    /** CR 120 — deal `amount` damage to an announced target (player,
     *  creature, planeswalker or battle — whatever the target requirement
     *  legalised), to the current `forEach` member (`{ ref: "$each" }`,
     *  issue #807), or to a player picked relative to the controller. */
    | {
          op: "dealDamage";
          amount: EffectValue;
          to: EffectObjectSelector | { player: EffectPlayerRef };
          /** CR 615 — when true, the damage skips prevention shields (Urza's
           *  Rage's kicked mode: "the damage can't be prevented"). Omitted/false
           *  is the default preventable path every other `dealDamage` card
           *  uses. See `SpellContext.dealDamage`'s doc comment for exactly
           *  which CR 615 checks this suppresses (CR 614 replacement and CR
           *  702.16 protection are unaffected). */
          unpreventable?: boolean;
      }
    /** CR 121.1 — `player` draws `count` cards. */
    | { op: "draw"; player: EffectPlayerRef; count: EffectValue }
    /** CR 119.3a — `player` gains `amount` life. */
    | { op: "gainLife"; player: EffectPlayerRef; amount: EffectValue }
    /** CR 122.1 — "you get {E}": `player` gets `amount` energy counters. A thin
     *  declarative skin over `SpellContext.addEnergy` (mirroring `gainLife`),
     *  one execution path (ADR 0045). Energy is a player-owned resource counter
     *  (not on an object), so `player` is a player ref — never an object slot.
     *  Skipped when the player cannot be resolved (CR 608.2b). */
    | { op: "getEnergy"; player: EffectPlayerRef; amount: EffectValue }
    /** CR 119.3b — `player` loses `amount` life (not damage — no
     *  damage-replacement interaction). */
    | { op: "loseLife"; player: EffectPlayerRef; amount: EffectValue }
    /** CR 500.7 (issue #686) — schedule `player` to take an extra turn after
     *  the current one (Time Warp: "Target player takes an extra turn after
     *  this one"). A thin declarative skin over `SpellContext.takeExtraTurn`
     *  — the SAME primitive Time Walk's imperative `resolve()` already calls,
     *  which pushes onto the LIFO `state.extraTurns` queue `advanceTurn`
     *  (phases.ts) pops at each turn boundary (CR 500.7) — one execution
     *  path (ADR 0045). `player` is an announced target slot (Time Warp
     *  targets a player), the resolving controller, or a relative player.
     *  Skipped when the player cannot be resolved (CR 608.2b). */
    | { op: "extraTurn"; player: EffectPlayerRef }
    /** CR 601.3a (issue #1057) — impose a turn-scoped "can't cast spells this
     *  turn" restriction on `player` (Xantid Swarm's attack trigger targets the
     *  defending player via `player: "opponent"`). A thin declarative skin over
     *  `SpellContext.restrictSpellCasting`, one execution path (ADR 0045): the
     *  player's id is added to `state.cannotCastSpellsThisTurn`, checked by the
     *  shared cast gate `castProhibitionReason` and cleared at CLEANUP
     *  (CR 514.2). Skipped when the player cannot be resolved (CR 608.2b).
     *  `cardTypes` (issue #1124, Abeyance: "can't cast instant or sorcery
     *  spells") optionally narrows the lock to the listed card types; omitted
     *  forbids every spell (the original Xantid Swarm shape). */
    | {
          op: "restrictCasting";
          player: EffectPlayerRef;
          cardTypes?: CardType[];
      }
    /** CR 602.1 / 605.1a (issue #1124) — impose a turn-scoped "can't activate
     *  abilities that aren't mana abilities" restriction on `player` (Abeyance).
     *  A thin declarative skin over `SpellContext.restrictAbilityActivation`,
     *  one execution path (ADR 0045): the player's id is added to
     *  `state.cannotActivateAbilitiesThisTurn`, enforced directly by the
     *  `activateAbility` mutation (`convex/game.ts`) — which only ever handles
     *  non-mana abilities, so mana abilities need no separate exemption check —
     *  and cleared at CLEANUP (CR 514.2). Skipped when the player cannot be
     *  resolved (CR 608.2b). */
    | { op: "restrictActivation"; player: EffectPlayerRef }
    /** CR 106.1 (issue #850) — add mana to a player's mana pool (a one-shot
     *  effect that produces mana: a ritual like Dark Ritual "Add {B}{B}{B}").
     *  A thin declarative skin over the SpellContext mana-add primitives
     *  (`addManaTo` / `addMana`), one execution path (ADR 0045). `mana` is a
     *  JSON-pure per-colour amount map (fixed coloured/colorless pips only — no
     *  X, generic, or "any colour"; those are not statically expressible).
     *  `player` names whose pool receives it — the resolving `"controller"` by
     *  default (a ritual adds to its caster's pool, CR 106.4). Skipped when the
     *  player cannot be resolved (CR 608.2b). */
    | { op: "addMana"; mana: EffectManaPool; player?: EffectPlayerRef }
    /** CR 701.8 — destroy the announced target permanent, or the current
     *  `forEach` member (`{ ref: "$each" }`, issue #807). Routes through
     *  `SpellContext.destroy`, so regeneration / indestructible / destroy
     *  replacements (ADR 0020) apply exactly as for imperative cards.
     *  `bind` snapshots the permanent's power/toughness/controller/owner
     *  (issue #1106) BEFORE it leaves the battlefield (CR 608.2h). `cantBeRegenerated` (ADR 0053,
     *  Do or Die's "They can't be regenerated") is a direct passthrough of
     *  `SpellContext.destroy`'s existing `{ cantBeRegenerated }` option
     *  (Terror, Disintegrate already use it imperatively) — suppresses the
     *  regeneration-shield replacement (CR 701.15c) while indestructible
     *  still protects. Omitted/false is the default preventable-by-regen path
     *  every other `destroy` card uses. */
    | {
          op: "destroy";
          target: EffectObjectSelector;
          bind?: string;
          cantBeRegenerated?: boolean;
      }
    /** CR 701.13 — exile the announced target permanent (or the current
     *  `forEach` member, issue #807) to its owner's exile zone (CR 406).
     *  `bind` snapshots the permanent's power/toughness/controller/owner
     *  (issue #1106) BEFORE it leaves the battlefield, so a later `ref` reads
     *  its last-known values (Swords to Plowshares, CR 608.2h). */
    | { op: "exile"; target: EffectObjectSelector; bind?: string }
    /** CR 400.7 — move a card between zones (issue #839). A thin declarative
     *  skin over the SpellContext zone-movement primitives
     *  (`returnToHand` / `moveCardById` / `returnToBattlefield`), one execution
     *  path (ADR 0045). `target` names the object to move: an announced target
     *  slot (a battlefield permanent — Unsummon, Boomerang — or a graveyard
     *  card — Raise Dead, Resurrection) or a bare snapshot ref (`$source` for a
     *  self-bounce, Blinking Spirit). Its CURRENT zone is INFERRED from its kind
     *  (a permanent is on the battlefield; a graveyard-card is in the
     *  graveyard) — the Op carries no `from`. `to` is the destination:
     *  - a permanent → `hand` returns it to its owner's hand (CR 701.10;
     *    battlefield-only state is cleared, CR 400.7);
     *  - a graveyard card → `battlefield` reanimates it under its owner's
     *    control (Resurrection), or → `hand`/`library`/`exile`/`graveyard`
     *    moves it there (Raise Dead, Grave Robbers).
     *  Skipped when the referenced object is gone (CR 608.2b — does as much as
     *  it can), or for a zone pair with no plain-move primitive (e.g. a
     *  battlefield permanent to exile, which needs LTB semantics — use
     *  `exile`). `bind` (issue #680, owner slot added issue #1106) snapshots
     *  the object BEFORE it moves — power/toughness/controller/owner/id for a
     *  permanent, mana value (+ owner/controller both as the card's owner, 0
     *  power/toughness) for a graveyard card — so a later `ref` reads e.g.
     *  the reanimated card's mana value (Reanimate: "You lose life equal to
     *  that card's mana value") or a bounced permanent's OWNER (Recoil:
     *  "return it to its owner's hand, that player discards", CR 400.7 —
     *  distinct from `.controller` when a control-magic effect diverges the
     *  two). `controller` (issue #680,
     *  meaningful only for a graveyard-card reanimation) overrides the
     *  default owner-control (CR 800.4a — Reanimate / Hymn of Rebirth's
     *  "under your control", a cross-graveyard reanimation) by passing
     *  through to `SpellContext.returnToBattlefield`'s existing optional 4th
     *  argument; omitted keeps the default (Resurrection, Hell's Caretaker —
     *  "under the owner's control"). Invalid outside a `to: "battlefield"`
     *  graveyard-card move. */
    | {
          op: "moveZone";
          target: EffectObjectSelector;
          to: EffectMoveZone;
          bind?: string;
          controller?: EffectPlayerRef;
      }
    /** CR 400.7 (issue #677) — the SEARCH half of a tutor/fetch effect: move
     *  the cards a `choice` Op picked (a bare picks ref, e.g.
     *  `{ ref: "$picked" }`) OUT OF `player`'s hidden `from` zone. A thin
     *  declarative skin over the SpellContext primitives `moveCardById`
     *  (library/hand → hand/graveyard/exile — Vampiric Tutor, Entomb),
     *  `putFromLibraryOntoBattlefield` (library → battlefield — a fetchland's
     *  "search … and put it onto the battlefield", Natural Order), and
     *  `putFromHandOntoBattlefield` (hand → battlefield — Stoneforge Mystic's
     *  "you may put an Equipment card from your hand onto the battlefield").
     *  Distinct from the `target`-based shape above because a `choice` Op's
     *  picks are hidden-zone card ids, not an announced target slot (CR
     *  601.2b — a hidden zone can't be targeted) — `resolveObjectRef`'s
     *  snapshot machinery does not apply. Every picked id still in `from` is
     *  moved (in practice a tutor's `choice` asks for exactly one); pair with
     *  a trailing `libraryLook` (shuffle) Op after a `from: "library"` move,
     *  as every real tutor/fetch oracle text does. `tapped` (issue #677,
     *  meaningful only with `to: "battlefield"`) forces the entering
     *  permanent tapped regardless of its own `entersTapped` flag (Fabled
     *  Passage's "put it onto the battlefield tapped") — omitted/false enters
     *  normally. Skipped when the binding was never captured (the choice
     *  found no candidates, CR 608.2b) or the player cannot be resolved.
     *  `from: "graveyard"` (issue #680) is the third source zone: pairs with a
     *  `choice(zone: "graveyard")` Op for a "puts A card from THEIR graveyard"
     *  pick that isn't an announced target (CR 601.2b hidden-zone-adjacent —
     *  a graveyard is public, but the pick is per-player self-selection, not
     *  a spell target — Exhume "each player puts a creature card from their
     *  graveyard", Titania "return target land card from YOUR graveyard" via
     *  the `TriggeredAbility`-has-no-`targetRequirement` choice-as-target
     *  substitute, ADR 0002 precedent: Banishing Light). `to: "battlefield"`
     *  routes through `returnToBattlefield` (owner control, same as the
     *  `target`-shape above); every other destination is the existing generic
     *  `moveCardById` branch (already used with a graveyard source
     *  elsewhere). `to: "library-top"` (issue #1125) is the tutor-to-top
     *  template — "Search your library for a card, then shuffle and put that
     *  card on top" (Vampiric Tutor, Mystical Tutor, Imperial Seal, Sterling
     *  Grove): routes through `SpellContext.putLibraryCardsOnTop`, which
     *  relocates the picked id(s) from ANYWHERE in the library (not just a
     *  known top-N window) onto the top, preserving pick order. Valid ONLY
     *  with `from: "library"` (validator-enforced) — pair with a PRECEDING
     *  `libraryLook`(shuffle) Op, per every real tutor-to-top oracle text's
     *  "then shuffle and put that card on top" ordering: the found card stays
     *  in the library through the shuffle (mathematically equivalent to
     *  setting it aside first, since a full shuffle including it then
     *  relocating it to the front yields the same distribution as shuffling
     *  the remainder and placing it on top), then this Op moves it to the
     *  front. */
    | {
          op: "moveZone";
          cards: EffectRef;
          player: EffectPlayerRef;
          from: "library" | "hand" | "graveyard";
          to: EffectMoveZone | "library-top";
          tapped?: boolean;
      }
    /** CR 613.4c (layer 7c, issue #840) — a temporary P/T modification that
     *  expires at a phase boundary. A thin declarative skin over the
     *  SpellContext primitive `addTemporaryPTBuff`, one execution path
     *  (ADR 0045). `target` names the permanent to pump: an announced target
     *  slot (Giant Growth), the resolving source (`$source` — a self-pump
     *  activated ability, "~ gets +1/+0 until end of turn"), or the current
     *  member of a `forEach` set (`{ ref: "$each" }` — a mass pump). `power`
     *  and `toughness` are SIGNED amounts (`EffectSignedValue`, issue #926):
     *  each may be a negative literal (a shrink, Weakness) or zero (a
     *  one-sided pump, +1/+0), a literal, a bound object's power/toughness
     *  (`ref`), a `count`, or a `negate`-wrapped value member for a
     *  non-negative-by-nature amount driven negative (Toxic Deluge's
     *  "-X/-X", `{ negate: { X: true } }`). `duration` is the phase boundary
     *  at which the buff expires (CR 514.2 end-of-turn cleanup / CR 511.3
     *  end-of-combat). Skipped when the referenced permanent is gone
     *  (CR 608.2b — the spell does as much as it can). */
    | {
          op: "pump";
          target: EffectObjectSelector;
          power: EffectSignedValue;
          toughness: EffectSignedValue;
          duration: DurationSpec;
      }
    /** CR 122 (issue #841) — put or remove counters on a permanent. A thin
     *  declarative skin over the SpellContext primitives `addCounter` /
     *  `removeCounter`, one execution path (ADR 0045). `action` selects the
     *  direction (`"add"` — Sengir Vampire's +1/+1 on kill; `"remove"` — a
     *  counter-shedding effect). `counter` is the free-form counter type
     *  ("+1/+1", "+1/+0", "-1/-1", "charge", "corpse", …; P/T-modifying types
     *  are recognized at stat-read time by layer 7d). `target` names the
     *  permanent: an announced target slot, the resolving source (`$source` —
     *  a permanent putting counters on itself), or the current member of a
     *  `forEach` set (`{ ref: "$each" }`). `count` is the number of counters
     *  (a literal, a bound object's power/toughness `ref`, or a `count`).
     *  Skipped when the referenced permanent is gone (CR 608.2b — the spell
     *  does as much as it can); `removeCounter` additionally clamps to the
     *  counters actually present. */
    | {
          op: "counters";
          action: "add" | "remove";
          counter: string;
          target: EffectObjectSelector;
          count: EffectValue;
      }
    /** CR 701.26 (issue #842) — tap or untap a permanent. A thin declarative
     *  skin over the SpellContext primitives `tap` / `untap`, one execution
     *  path (ADR 0045). `action` selects the direction (`"tap"` — Icy
     *  Manipulator's "tap target artifact, creature, or land"; `"untap"` —
     *  Twiddle's untap mode, a "untap target permanent" effect). `target`
     *  names the permanent: an announced target slot, the resolving source
     *  (`$source` — a permanent tapping itself), or the current member of a
     *  `forEach` set (`{ ref: "$each" }`). Skipped when the referenced
     *  permanent is gone (CR 608.2b — the spell does as much as it can); the
     *  primitives themselves no-op when the permanent is already in the
     *  requested state (CR 701.26a/b). */
    | {
          op: "tapUntap";
          action: "tap" | "untap";
          target: EffectObjectSelector;
      }
    /** CR 611.1b / 613.1f (layer 6, issue #843) — grant an ability to a
     *  permanent for a limited duration. A thin declarative skin over the
     *  SpellContext primitives `grantStaticAbility` / `grantActivatedAbility`,
     *  one execution path (ADR 0045). Exactly one of two payloads:
     *  - `ability` — a keyword static ability ("flying", "trample", "haste",
     *    "banding", …; a free-form keyword read at combat / rules-check time,
     *    Berserk's "target creature gains trample").
     *  - `grantedActivatedId` — the `id` of an activated-ability template on the
     *    RESOLVING source's `grantTemplates[]` (issue #738, Touch of Vitae's
     *    "gains '{0}: Untap this creature. Activate only once.'"). The template
     *    carries its own cost / effects / `oncePerTurn` cap.
     *  `target` names the permanent: an announced target slot, the resolving
     *  source (`$source`), or the current member of a `forEach` set
     *  (`{ ref: "$each" }`). `duration` is the phase boundary at which the grant
     *  expires (CR 611.2 — the phase-boundary purge splices it back out).
     *  Skipped when the referenced permanent is gone (CR 608.2b — the spell does
     *  as much as it can); the primitive is a no-op if the permanent has left
     *  the battlefield. Ability REMOVAL / loss (`removeStaticAbilities`) takes a
     *  predicate closure and stays `resolve()` by design — not a JSON Op. */
    | {
          op: "grantAbility";
          target: EffectObjectSelector;
          duration: DurationSpec;
          ability?: string;
          grantedActivatedId?: string;
      }
    /** CR 701.20 (issue #844) — shuffle a player's library. A thin declarative
     *  skin over the SpellContext primitive `shuffleLibrary`, one execution
     *  path (ADR 0045). `action` is `"shuffle"` — the seeded-PRNG randomization
     *  that also clears every library card's persistent knowledge (ADR 0026, an
     *  unwitnessed reorder). `player` names whose library: the resolving
     *  controller (`"controller"`), an announced target-slot player
     *  (`{ target: N }`), or the current member of a `forEach` set
     *  (`{ ref: "$each" }` — a per-player shuffle). SCOPE (issue #844): only
     *  the `shuffle` primitive is folded — it is the one CR 401 / 701.20 library
     *  primitive expressible as a pure declarative Op (no runtime value read
     *  back into the effect). Looking at / reordering the top (peekLibraryTop /
     *  reorderLibraryTop) stays a `planned` backlog Op (`scryReorder`): every
     *  current caller reads an opaque `choice` result back into the reorder or
     *  drives a mill loop off the live top id — not a pure declarative skin yet. */
    | {
          op: "libraryLook";
          action: "shuffle";
          player: EffectPlayerRef;
      }
    /** CR 608.2 / 701.24 (issue #898) — the resolving spell shuffles ITSELF
     *  into its owner's library, instead of going to the graveyard (CR
     *  608.2m), as the last thing it does ("Shuffle Green Sun's Zenith into
     *  its owner's library"). A thin declarative skin over the SpellContext
     *  primitive `shuffleSelfIntoLibrary`, one execution path (ADR 0045) —
     *  mirrors the `exileSelf` self-redirect design (Recall, `resolve()`) but
     *  targets the library instead of exile, and is exposed as an Op (unlike
     *  `exileSelf`, which has no DSL Op yet) since Green Sun's Zenith is a
     *  DSL-first card. No parameters — it always applies to the currently-
     *  resolving spell card; no-op for an ability or a spell copy (CR 707.10). */
    | { op: "shuffleSelfIntoLibrary" }
    /** CR 401.4 look / CR 701.22 Scry / 701.44 Surveil / order-only (issue
     *  #885) — look at the top `count` cards of a library, then reorder / place
     *  them per `destination`. A thin declarative skin over the single
     *  SpellContext primitive `orderTop` (the reusable drag-picker behind Scry /
     *  Surveil / "put them back in any order"), one execution path (ADR 0045).
     *  Like `choice` / `mayPay` this Op SUSPENDS: the first execution raises the
     *  `order-top` PendingChoice (projected face-up as `libraryPeek`), and on
     *  resume `orderTop` puts the KEPT cards back on top in the chooser's order
     *  and sends the un-kept cards to `destination`, marking the kept cards
     *  known to the controller (ADR 0026). The reorder-FROM-choice construct the
     *  scryReorder backlog Op reserved (Ponder = `"none"`, Preordain = Scry 2 =
     *  `"library-bottom"`, a Surveil = `"graveyard"`). `player` names whose
     *  library (the resolving controller, an announced target slot, or a forEach
     *  `$each`); `count` is how many top cards to look at (a non-positive count
     *  or an empty library is a no-op, CR 608.2b). No `bind` — the pick is
     *  consumed internally by `orderTop`, not read by a later Op. */
    | {
          op: "scryReorder";
          player: EffectPlayerRef;
          count: EffectValue;
          destination: LibraryDestination;
          prompt?: string;
      }
    /** CR 701.17 (issue #885) — mill: move the top `count` cards of a player's
     *  library into their graveyard. A thin declarative skin over the existing
     *  `peekLibraryTop` + `moveCardById` primitives, one execution path (ADR
     *  0045): the mill loop reads the LIVE top id each pass and moves it library
     *  → graveyard, stopping early when the library empties (CR 701.17a — mill
     *  fewer if not enough cards). `player` names whose library is milled (an
     *  announced target slot — "target player mills N", Thought Scour /
     *  Millstone; the resolving controller; or a forEach `$each`); `count` is
     *  how many cards to mill (a non-positive count is a no-op, CR 608.2b).
     *  Deterministic — no player choice, unlike `scryReorder`. */
    | {
          op: "mill";
          player: EffectPlayerRef;
          count: EffectValue;
      }
    /** CR 401.4 look (issue #984) — dig to hand: look at the top `look` cards of
     *  a library, put `take` of them (default 1) into that player's hand, and
     *  put the rest on the BOTTOM of the library. A thin declarative skin
     *  composed of existing SpellContext primitives, one execution path (ADR
     *  0045): `peekLibraryTop(look)` reveals the top cards, a single suspending
     *  `look-top` `requestChoice` over exactly those looked-at ids drives the
     *  kept-card pick (the projection exposes ONLY those cards face-up as
     *  `libraryPeek`, not the whole library — the same shared top-N look path as
     *  Stock Up), the kept cards move library→hand via `moveCardById`, and the
     *  remaining looked-at cards are bottomed via `reorderLibraryTop`. Like
     *  `choice` / `scryReorder` this Op SUSPENDS: the first execution raises the
     *  `look-top` PendingChoice, the resumed execution reads the picks back and
     *  finishes the moves. The bottom order of the un-kept cards is auto-resolved
     *  in look order — Impulse's "in any order" is a formality with no strategic
     *  value (the cards go face-down into the library, unknown; CR 401.4 lets the
     *  owner arrange them but the arrangement is unobservable). `player` names
     *  whose library (the resolving controller, an announced target slot, or a
     *  forEach `$each`); `look` is how many top cards to look at; `take` is how
     *  many to put into hand (default 1, clamped to the number looked at). No
     *  `bind` — the pick is consumed internally, not read by a later Op.
     *  Distinct from an exile-and-may-play "impulse draw" (#791): the chosen card
     *  goes to HAND and the rest to the bottom, no exile / play window. */
    | {
          op: "digToHand";
          player: EffectPlayerRef;
          look: EffectValue;
          take?: EffectValue;
          prompt?: string;
      }
    /** CR 401.4 (issue #1046) — put N cards from a hand on top of a library,
     *  in the player's chosen order ("put N cards from your hand on top of
     *  your library in any order", Brainstorm). A thin declarative skin over
     *  the single SpellContext primitive `moveHandCardToLibraryTop`, one
     *  execution path (ADR 0045): raises a suspending `choose-hand-card`
     *  `requestChoice` over the resolved `player`'s whole hand (`count`
     *  cards, clamped to hand size — CR 608.2b), then moves each picked card
     *  to the library top. `moveHandCardToLibraryTop` unshifts, so the LAST
     *  picked card lands literally on top — the player's pick order IS the
     *  resulting top-to-bottom order (CR 401 "in any order" = the player
     *  controls the sequence). Like `choice` / `scryReorder` / `digToHand`
     *  this Op SUSPENDS: the first execution enqueues the choice and reports
     *  "suspend" (the item stays on the stack, checkpointed at this Op's own
     *  position — CR 608.3, so an EARLIER Op in the same script, e.g. `draw`,
     *  never re-runs on resume); the resumed execution reads the ordered
     *  picks back and applies the moves. The moved cards are marked known to
     *  the controller (ADR 0026 — they chose the cards and their order, so
     *  the top position is certain until a shuffle). Distinct from
     *  `moveZone`'s `to: "library-top"` shape (issue #1125), which only moves
     *  FROM the library (a tutor-to-top); this Op moves a chosen HAND subset
     *  instead — the gap `moveZone` / `scryReorder` / `libraryLook` / `mill`
     *  all left uncovered. `player` names whose hand/library (the resolving
     *  controller, an announced target slot, or a forEach `$each`); `count`
     *  is how many cards to put back. No `bind` — the pick is consumed
     *  internally, not read by a later Op. */
    | {
          op: "putBack";
          player: EffectPlayerRef;
          count: EffectValue;
          prompt?: string;
      }
    /** CR 615 (issue #845) — establish a damage-prevention shield. A thin
     *  declarative skin over three SpellContext prevention primitives, one
     *  execution path per mode (ADR 0045). `mode` selects the shield shape:
     *
     *  - `"next-n"` → `preventNextNDamageToTarget`: a shield on `to` (an
     *    announced target slot, `$source`, a forEach `$each`, or a relative
     *    player via `{ player: … }`) that absorbs up to `amount` total damage
     *    from any source (CR 615.1/615.6) until `duration` expires. Samite
     *    Healer ("prevent the next 1 damage to any target"), Amulet of Kroog,
     *    Conservator.
     *  - `"all-combat"` → `preventAllCombatDamage`: prevents ALL combat damage
     *    for the remainder of the turn (CR 615, Fog). No target, no duration —
     *    it is a turn-scoped global effect cleared at CLEANUP; non-combat
     *    damage is unaffected.
     *  - `"combat-to-and-by"` → `preventAllCombatDamageToAndBy`: a per-instance
     *    two-way shield preventing all combat damage dealt TO and BY `target`
     *    until `duration` expires (CR 615, Maze of Ith / Ebony Horse).
     *
     *  Skipped when the referenced permanent/player is gone (CR 608.2b — the
     *  spell does as much as it can); the `next-n` primitive additionally
     *  no-ops on a non-positive amount. */
    | {
          op: "preventDamage";
          mode: "next-n";
          to: EffectObjectSelector | { player: EffectPlayerRef };
          amount: EffectValue;
          duration: DurationSpec;
      }
    | { op: "preventDamage"; mode: "all-combat" }
    | {
          op: "preventDamage";
          mode: "combat-to-and-by";
          target: EffectObjectSelector;
          duration: DurationSpec;
      }
    /** CR 701.15 (issue #846) — stack a regeneration shield on a permanent. A
     *  thin declarative skin over the single SpellContext primitive
     *  `applyRegenerationShield`, one execution path (ADR 0045). `target` is an
     *  object selector: an announced target slot (`{ target: N }` — Death Ward
     *  / Niall Silvain "Regenerate target creature"), the implicit `$source`
     *  (`{ ref: "$source" }` — a self-regenerate activated ability like Drudge
     *  Skeletons / Sedge Troll / Clay Statue), or a forEach `$each` (a
     *  regenerate-each rider). The shield is consumed by the next destroy event
     *  on that permanent this turn (CR 614.5 / 701.15a), expiring at CLEANUP if
     *  unused (CR 514.2). Skipped when the referenced permanent is gone
     *  (CR 608.2b — the resolver returns undefined; the primitive itself also
     *  no-ops off the battlefield and on a non-permanent selection). */
    | {
          op: "regenerate";
          target: EffectObjectSelector;
      }
    /** CR 111 / 701.7 (issue #847) — create one or more token permanents. A
     *  thin declarative skin over the single SpellContext primitive
     *  `createToken`, one execution path (ADR 0045). `token` is the JSON-pure
     *  token specification (`EffectTokenSpec` — every printed characteristic
     *  the token enters with: name, types, subtypes, supertypes, P/T, colors,
     *  keyword static abilities, token art). `controller` names the player who
     *  gets the tokens: the resolving controller (`"controller"` — the vast
     *  majority: The Hive's Wasp, Master of the Hunt's Wolves, the Saproling /
     *  Thrull / Goblin token engines), an announced target-slot player, or a
     *  forEach `$each` (a per-player token creation). `count` is how many tokens
     *  to create (default 1; a literal, a `ref`, or a `count` — a
     *  count-scaled token creation). SCOPE (issue #847): only the plain
     *  spec-driven `createToken` primitive is folded — the JSON-pure token
     *  spec that carries no closure. `createTokenCopyOf` (create a token that's
     *  a COPY of a target creature — Dance of Many) reads a runtime source
     *  creature and drives the copy machinery, so it is NOT a pure declarative
     *  skin; it stays a `planned` backlog Op (`createTokenCopy`). A token that
     *  needs continuous `staticEffects` (Tetravite's "can't be enchanted", a
     *  predicate closure) is likewise not JSON-expressible and stays resolve().
     *  `token.staticEffects` is intentionally absent from `EffectTokenSpec`. */
    | {
          op: "createToken";
          token: EffectTokenSpec;
          controller: EffectPlayerRef;
          count?: EffectValue;
      }
    /** CR 613.1b (issue #848) — change control of a permanent (layer 2). A thin
     *  declarative skin over the single SpellContext primitive `gainControl`,
     *  one execution path (ADR 0045). `target` names the permanent whose
     *  control changes — an announced target slot (`{ target: N }` — Aladdin /
     *  Old Man of the Sea / Thrull Champion "gain control of target …"), the
     *  resolving source (`$source` — a self-control-change), or a forEach
     *  `$each`. `controller` names the player who gains control (the resolving
     *  `"controller"`; an announced target-slot player; or a relative player).
     *  `duration` is the JSON-pure discriminator for the "for as long as"
     *  condition (CR 611.2b), mapped 1:1 onto `ControlChangeCondition`:
     *  omitted = an INDEFINITE reassignment (no condition, the Ghazbán Ogre
     *  shape — control never reverts on its own); the three named durations
     *  install a conditional-control SBA that reverts the change the moment the
     *  condition lapses. SCOPE (issue #848): only the durations the primitive's
     *  `ControlChangeCondition` supports are expressible — an "until end of
     *  turn" control change (Ray of Command / Magus of the Unseen) has NO
     *  `ControlChangeCondition` variant and additionally wants an EOT tap
     *  rider, so it stays `resolve()` (a distinct capability, issue #730). */
    | {
          op: "gainControl";
          target: EffectObjectSelector;
          controller: EffectPlayerRef;
          duration?: GainControlDuration;
      }
    /** CR 700.2 / 601.2b (issue #849) — a modal "choose one" effect. A thin
     *  declarative skin over the single SpellContext primitive
     *  `requestOptionChoice`, one execution path (ADR 0045): the chooser picks
     *  exactly one of the ordered `modes` (each a labelled nested `EffectOp[]`),
     *  and the interpreter runs the chosen mode's `effects` through the SAME
     *  `runOpList` path an `if` branch uses — so a mode body composes bind / ref
     *  / if / forEach and even a further suspending Op (a nested `choice` /
     *  `mayPay`) exactly like a top-level list. `player` names the chooser (the
     *  resolving `"controller"` by default — the caster of a modal spell chooses
     *  its mode, CR 601.2b; an announced target-slot player or a relative player
     *  otherwise); `prompt` is the choice header. First execution enqueues the
     *  `option-pick` Pending Choice and SUSPENDS; the resumed execution reads
     *  the picked mode index back and descends into it. A single-mode
     *  `optionChoice` auto-resolves (no real choice, Arena-style) — it runs the
     *  one mode without prompting (CR 700.2 requires ≥1 mode). Skipped when the
     *  chooser cannot be resolved (CR 608.2b). */
    | {
          op: "optionChoice";
          modes: EffectMode[];
          player?: EffectPlayerRef;
          prompt: string;
      }
    /** CR 705 (issue #851) — flip a coin, then run one of two nested branches
     *  depending on the outcome. A thin declarative skin over the single
     *  SpellContext primitive `requestCoinFlip` (the suspending reveal flip,
     *  ADR 0023), one execution path (ADR 0045): the flip is drawn once from the
     *  seeded PRNG, PAUSES resolution to animate the coin landing, and on resume
     *  the interpreter runs the `win` (heads — the flipping player wins) or
     *  `loss` (tails) branch's `effects` through the SAME `runOpList` path an
     *  `if` branch / `optionChoice` mode uses — so a branch composes bind / ref
     *  / if / forEach and even a further suspending Op. `player` names the
     *  flipping player (the resolving `"controller"` by default — CR 705.1, the
     *  player performing the effect flips; an announced target-slot / relative
     *  player otherwise). Like `if` / `optionChoice` it is a structural
     *  construct that always re-descends on a re-walk (in the interpreter's
     *  runOpList skip-exception), so a suspension inside the taken branch resumes
     *  correctly and the flip is NOT re-rolled (CR 608.3 — the persisted outcome
     *  short-circuits the re-run). Skipped when the flipper cannot be resolved
     *  (CR 608.2b). */
    | {
          op: "coinFlip";
          win: EffectCoinFlipBranch;
          loss: EffectCoinFlipBranch;
          player?: EffectPlayerRef;
      }
    /** CR 701.20a — reveal `player`'s hand to every player (issue #920, #682).
     *  A thin declarative skin over `SpellContext.markKnownToAll` (ADR 0026):
     *  every card currently in `player`'s hand is stamped with every player in
     *  `knownTo`, so the wire projection (`convex/gameProjections.ts`) shows
     *  the real card to everyone instead of nulling the slot — CR 701.20a
     *  reveal is public knowledge, unlike a private "look" (Word of Command's
     *  `ctx.markKnown`, a single knower, stays `resolve()` — a different,
     *  narrower primitive). Distinct from a `choice` Op reading someone else's
     *  zone (`zoneOwnerId`): `reveal` grants NO chooser action by itself, it
     *  only makes an otherwise-hidden zone visible — pair it with a following
     *  `choice(zone: "hand", zoneOwnerId: <same player>)` for the
     *  Thoughtseize/Duress/Inquisition-of-Kozilek template ("target player
     *  reveals their hand, you choose a card from it"). No-op on an empty
     *  hand (CR 608.2b — nothing to reveal).
     *
     *  Two shapes, exactly one of `zone` / `cards` (mutually exclusive):
     *   - `zone: "hand"` — the ALL-PLAYERS hand reveal above
     *     (Thoughtseize/Duress/Inquisition of Kozilek/Grief).
     *   - `cards: EffectRef` (issue #945) — reveal the SPECIFIC cards a
     *     preceding `choice` (search-library) Op bound (a bare picks ref,
     *     e.g. `{ ref: "$picked" }`), owned by `player`. This is the "search
     *     …, reveal it, put it into your hand, then shuffle" tutor clause (CR
     *     701.20 — a reveal makes the found card known to every player):
     *     Spellseeker, Stoneforge Mystic, Brightglass Gearhulk, Expedition
     *     Map. Same `markKnownToAll` primitive, arbitrary instance ids. Place
     *     it BEFORE the `moveZone`/shuffle: the picked card is still in the
     *     library when stamped, keeps its all-players `knownTo` through the
     *     move to hand, and the trailing shuffle only clears knowledge of
     *     cards still in the library (CR 701.20). No-op when the choice found
     *     nothing (the binding was never captured, CR 608.2b).
     *
     *  A library-top reveal (Caustic Bronco-class) is a distinct
     *  positional-order case left for a future Op (`EFFECT_OP_BACKLOG`'s
     *  broader "reveal" note, `mechanicsRegistry.ts`). */
    | { op: "reveal"; player: EffectPlayerRef; zone: "hand" }
    | { op: "reveal"; player: EffectPlayerRef; cards: EffectRef }
    /** CR 608.2 / 101.4 — a mid-resolution player choice (issue #805). Maps
     *  1:1 onto `SpellContext.requestChoice`: the interpreter enqueues a
     *  Pending Choice of the given `kind` and SUSPENDS the script (the stack
     *  item stays on the stack, `resolutionStep` checkpoints the Op index);
     *  when the chooser submits through the generic `submitResolutionChoice`
     *  mutation the script resumes AT THIS OP, which now reads the picks back
     *  and records them under `bind` for later Ops (a picks binding, read
     *  with a bare `{ ref: "$name" }`). `count` is clamped to the candidates
     *  actually available (CR 608.2b — do as much as possible); when zero
     *  candidates exist the choice is skipped entirely and the binding stays
     *  uncaptured, so consuming Ops skip too. `filter` is meaningful for
     *  `zone: "battlefield"` (the submit validator and the UI apply it
     *  directly to public permanents) or `zone: "library"` (issue #677 — a
     *  hidden zone, so the interpreter precomputes an explicit `candidateIds`
     *  allow-list from the filter instead, "search your library for a [type]
     *  card" — Mystical Tutor, Green Sun's Zenith, a fetchland); the
     *  validator rejects it for `"hand"`/`"graveyard"`. */
    | {
          op: "choice";
          kind: EffectChoiceKind;
          /** The chooser. Defaults to also being the owner of the zone picked
           *  from (Mind Rot, Innocent Blood — the common case). */
          player: EffectPlayerRef;
          zone: "battlefield" | "hand" | "library" | "graveyard";
          /** Owner of the zone picked from, when it differs from the chooser
           *  (issue #920 generalization). Maps 1:1 onto the `zoneOwnerId`
           *  parameter `SpellContext.requestChoice` already accepts and
           *  production `resolve()` cards already pass (Leshrac's Sigil:
           *  the Sigil's controller chooses from the OPPONENT's hand; Demonic
           *  Hordes: the opponent chooses from the CONTROLLER's battlefield)
           *  — this just exposes that existing capability to the DSL, no new
           *  primitive (ADR 0045 "generalize, don't add"). The
           *  Thoughtseize/Duress/Inquisition-of-Kozilek "target player
           *  reveals their hand, you choose a card from it" template is the
           *  canonical case: `player: "controller"`, `zoneOwnerId: { target:
           *  0 }`. Omitted = the chooser's own zone (unchanged default
           *  behaviour for every pre-existing `choice` Op card). Skipped
           *  entirely if this player ref cannot be resolved (CR 608.2b). */
          zoneOwnerId?: EffectPlayerRef;
          filter?: EffectCardFilter;
          /** Pick count, clamped to availability (CR 608.2b). A plain number
           *  is an EXACT count (the chooser must pick that many, down to
           *  however many exist). `{ min, max }` (issue #677) is an OPTIONAL
           *  range — `min: 0` is "you may…" (Stoneforge Mystic's "you may
           *  search your library for an Equipment card"; Brightglass
           *  Gearhulk's "up to two" is `{ min: 0, max: 2 }`). Maps 1:1 onto
           *  `PendingChoice.count`'s existing fixed-N / range union — no new
           *  primitive, just exposing the shape the Op already had access to
           *  via `SpellContext.requestChoice`. */
          count: number | { min: number; max: number };
          prompt: string;
          /** REQUIRED — the picks binding name (`"$picked"`). A choice whose
           *  picks nothing consumes is meaningless, so the grammar demands a
           *  binding. */
          bind: string;
      }
    /** CR 701.9 — `player` discards the cards a `choice` Op picked. `cards`
     *  is a bare picks ref (`{ ref: "$picked" }`); each picked card still in
     *  the player's hand is discarded through `SpellContext.discardCard`
     *  (Library of Leng replacement + CARD_DISCARDED triggers apply exactly
     *  as for imperative cards). Skipped when the binding was never captured
     *  (the choice found no candidates — CR 608.2b). */
    | { op: "discard"; player: EffectPlayerRef; cards: EffectRef }
    /** CR 117.3a / 118.4 — an optional "you may pay {cost}" decision offered to
     *  a player (issue #806), OR a bare cost-free "you may …" decision (issue
     *  #680 — `cost` omitted). Maps 1:1 onto `SpellContext.requestMayPay`,
     *  riding the existing `may-pay` Pending Choice pipeline (enqueue →
     *  generic Pay/Skip prompt UI → `submitMayPay` mutation → resume): no new
     *  choice infrastructure. Like `choice`, the interpreter SUSPENDS the
     *  script at this Op (`resolutionStep` checkpoints the Op index) and
     *  resumes here when the player answers. `bind` (REQUIRED) names a
     *  BOOLEAN binding — `true` when the player paid/accepted, `false` when
     *  they declined — read by a later `if` predicate. With a `cost`, this is
     *  the counter/punisher primitive: "… unless its controller pays {2}" is
     *  `mayPay` + an `if` on the outcome. WITHOUT a `cost` (issue #680), it is
     *  a bare optional action with no payment — "you may return this card
     *  from your graveyard to your hand" (Squee, Goblin Nabob) — mirroring
     *  `SpellContext.requestMayPay`'s already-optional `cost` field (used
     *  cost-free by Verduran Enchantress / Nether Shadow's `resolve()`); this
     *  Op shape simply exposes that existing capability to the DSL (ADR 0045
     *  "generalize, don't add" — no new primitive). */
    | {
          op: "mayPay";
          /** Who is offered the payment/decision (CR 117.3a — usually the
           *  controller of the affected object, "its controller pays"). */
          player: EffectPlayerRef;
          /** The cost to pay on accept (mana / life / sacrifice union, CR
           *  702.24 shape). Omitted for a bare cost-free "you may" decision
           *  (issue #680). */
          cost?: MayPayCost;
          prompt: string;
          /** REQUIRED — the boolean binding name (`"$paid"`). A may-pay whose
           *  outcome nothing reads is meaningless, so the grammar demands it. */
          bind: string;
      }
    /** CR 701.5a — counter the announced target spell (remove it from the
     *  stack, put it into its owner's graveyard). Routes through
     *  `SpellContext.counter`; skipped when the target already left the stack
     *  (CR 608.2b). The consequence half of the counter/punisher pattern
     *  ("Counter target spell unless its controller pays {N}", issue #806).
     *  `destination` (issue #683) overrides the default graveyard destination
     *  for a COUNTERED SPELL — "if that spell is countered this way, exile it
     *  / put it on top of its owner's library / put it into its owner's hand
     *  instead" (No More Lies, Memory Lapse, Remand). Omitted/`"graveyard"`
     *  is the CR 701.5a default. */
    | {
          op: "counter";
          target: EffectTargetRef;
          destination?: CounterDestination;
      }
    /** if — the third frozen structural construct (ADR 0045, issue #806). NOT
     *  an Op verb: it branches the script on a PREDEFINED predicate form (never
     *  an arbitrary boolean expression — the validator and the bot must read
     *  it). `then` runs when the predicate holds; `else` (optional) runs
     *  otherwise. Each branch is itself an Op list, so `if` nests inside
     *  sequences and other branches, and a suspending Op (choice / mayPay)
     *  inside a branch suspends and resumes exactly as at the top level (the
     *  branch re-runs from the checkpointed `if` Op; the suspending Op reads its
     *  stored answer back). */
    | {
          op: "if";
          predicate: EffectPredicate;
          then: EffectOp[];
          else?: EffectOp[];
      }
    /** CR 701.16 — sacrifice the permanents a `choice` Op picked (a bare
     *  picks ref, issue #807). Each picked permanent still on the battlefield
     *  is sacrificed through `SpellContext.sacrifice` — its controller puts
     *  it into its owner's graveyard; indestructible does not save it
     *  (CR 701.16a) and dies-triggers fire exactly as for imperative cards.
     *  Skipped when the binding was never captured (the choice found no
     *  candidates — CR 608.2b: a player with nothing to sacrifice does
     *  nothing). */
    | {
          op: "sacrifice";
          /** A bare picks ref naming a `choice` Op's bind — sacrifices EVERY
           *  picked permanent (CR 701.16, the "each player sacrifices …"
           *  forEach pattern). Mutually exclusive with `target`. */
          permanents?: EffectRef;
          /** A single announced target / snapshot-bound permanent to sacrifice
           *  (CR 701.16 — "sacrifice that creature" / "sacrifice this
           *  creature", Kjeldoran Elite Guard, Phantasmal Mount). Resolved via
           *  the object-ref path (SNAP_ID + battlefield re-check, CR 608.2b),
           *  so a permanent already gone is a no-op. Mutually exclusive with
           *  `permanents`. */
          target?: EffectObjectSelector;
      }
    /** delayedTrigger — grants a DELAYED triggered ability (CR 603.7, ADR
     *  0048): "At the beginning of the next <boundary>, <do something>". The
     *  delayed body is an INLINE nested Effect Script persisted on the
     *  scheduled `DelayedTriggerInstance` (the fired trigger is
     *  self-contained in game state — no card-def lookup at fire time);
     *  everything the body needs from scheduling time crosses via the
     *  explicit `capture` map, whose keys become the body's ONLY initial
     *  bindings (outer bindings — `$source` included — are NOT visible
     *  inside the body). `targetPlayer` scopes the player-gated timings
     *  (`next-draw-step` / `next-main-phase`, CR 504/505) to one player's
     *  step; the global-boundary timings reject it (validator-enforced).
     *  Does not nest inside another delayedTrigger body. The two grammar gaps
     *  ADR 0048 tracked have since closed (ADR 0049): event-field captures
     *  (`$event.<field>`, issue #865) and list-valued captures
     *  (`{ select: EffectListSelector }`, issue #866). */
    | {
          op: "delayedTrigger";
          timing: DelayedTriggerTiming;
          /** Oracle text of the granted trigger (shown when it fires). */
          oracleText: string;
          /** What crosses from scheduling time to fire time, keyed by the
           *  binding name the body reads it back under. */
          capture?: Record<string, EffectCaptureSource>;
          /** REQUIRED for the player-scoped timings (CR 504/505); rejected
           *  for the global-boundary timings. Resolved at scheduling time. */
          targetPlayer?: EffectPlayerRef;
          /** REQUIRED for the `leaves-battlefield` timing (CR 603.7a / 603.10):
           *  the specific permanent whose departure fires this delayed trigger
           *  ("When THAT creature leaves the battlefield this turn, …"),
           *  resolved to an instance id at scheduling time. Rejected for every
           *  phase-boundary timing. Distinct from `capture` (which carries the
           *  body's data): `watch` is the trigger CONDITION's watched instance,
           *  not necessarily anything the body reads. */
          watch?: EffectObjectSelector;
          /** The delayed body — a nested Effect Script run by the
           *  interpreter when the trigger fires. */
          effects: EffectOp[];
      }
    /** forEach — the fourth and FINAL structural construct (ADR 0045, issue
     *  #807; the grammar is now closed). Executes the `effects` sub-list once
     *  per member of the declaratively-selected set, in selection order
     *  (players: APNAP, CR 101.4; permanents: APNAP by controller). The set
     *  is determined ONCE at construct entry (CR 608.2i) and frozen; a member
     *  that left the battlefield before its iteration is skipped (CR 608.2b).
     *
     *  `$each` is bound per iteration: the current player (players set — a
     *  bare `{ ref: "$each" }` in player positions) or the current
     *  permanent's snapshot (permanents set — bare `{ ref: "$each" }` in
     *  object positions, `$each.power` / `$each.toughness` /
     *  `$each.controller` in value positions, CR 608.2h LKI). Bindings made
     *  inside the body (`bind`, a `choice` Op's picks) are scoped to their
     *  iteration; bindings made BEFORE the construct stay readable in every
     *  iteration. `choice` Ops inside the body suspend/resume per iteration
     *  through the same Pending Choice pipeline as top-level choices — with a
     *  players set this yields APNAP-ordered decisions (CR 101.4). One
     *  deliberate simplification, flagged per the GRE rules: each iteration's
     *  actions apply as soon as they resolve (sequential), not batched
     *  simultaneously after all choices (CR 101.4d timing) — visible only
     *  when a later chooser's options depend on an earlier iteration's
     *  action. `forEach` does not nest (the validator rejects it).
     *
     *  `simultaneous` (CR 400.7 / 614-batch, issue #1094) — ONLY valid over a
     *  `{ set: "graveyard" }` selector, and ONLY with the canonical
     *  single-Op reanimation body `[{ op: "moveZone", target: { ref: "$each"
     *  }, to: "battlefield" }]` (optionally `controller`). When set, the
     *  interpreter bypasses the normal per-member `runOpList` walk entirely
     *  and hands the WHOLE frozen member set to
     *  `SpellContext.returnGraveyardSetToBattlefield` in one call, so every
     *  reanimated permanent enters as a single event — none of their static-
     *  effect grants or ETB triggers observe only some of the others already
     *  on the battlefield (Replenish; Living Death would set it too).
     *  Omitted/false keeps the original sequential per-member walk (the only
     *  behavior every OTHER `forEach` selector still has). */
    | {
          op: "forEach";
          select: EffectForEachSelector;
          effects: EffectOp[];
          simultaneous?: boolean;
      }
    /** CR 104.2a — set the DESIGNATED player as the winner, through the SAME
     *  `state.gameOver` seam State-Based Actions use (issue #1066, Coalition
     *  Victory). A thin declarative skin over `SpellContext.winGame`, one
     *  execution path (ADR 0045): `player` names the winner — the resolving
     *  `"controller"` for every shipped alternate-win card, but an announced
     *  target-slot / relative player is not precluded by the grammar. Skipped
     *  when the player cannot be resolved (CR 608.2b) or the game already
     *  ended (`winGame`'s own no-op guard, mirroring `drawGame`). Coalition
     *  Victory gates this Op behind nested `if`s checking its own predicate
     *  (a land of each basic type via `{ domain: { of } } >= 5`, a creature of
     *  each color via five `count` checks) — the Op ITSELF carries no
     *  predicate; the calling card's `if` chain is the gate (CR 104.2a: "a
     *  player CAN win as a result of a spell or ability", not the Op deciding
     *  who wins). */
    | { op: "winGame"; player: EffectPlayerRef }
    /** CR-generic "separate into two piles, another player chooses one" cycle
     *  (ADR 0053, pile division — Fact or Fiction, Do or Die, Death or Glory,
     *  Bend or Break, Fight or Flight, Stand or Fall). Drives a new two-step
     *  `DividePilesKind` pending-choice family: step 1 raises a
     *  `divide-piles` choice for `divider` — a total 2-way partition of
     *  `objects` (the submitted subset is pile A, the remainder pile B); step
     *  2 raises a `pick-pile` choice for `chooser` over the completed piles.
     *  Once both are answered, `chosenEffect` runs as an Op list with
     *  `chosenBind` bound to the chosen pile's ids (a LIST binding, like a
     *  `delayedTrigger` list-valued capture — read it via
     *  `{ set: "bound", ref: chosenBind }` in a nested `forEach`, or directly
     *  as a bare picks ref in `moveZone`'s `cards` shape), then `otherEffect`
     *  runs with `otherBind` bound to the other pile's ids. Either list may be
     *  EMPTY (a pile with no consequence — Do or Die's surviving pile, Fight
     *  or Flight's default-legal chosen pile) — unlike `forEach.effects`,
     *  `chosenEffect`/`otherEffect` do NOT require a non-empty Op list.
     *  Skipped entirely when `objects` resolves to no candidates, or when
     *  `divider`/`chooser` cannot be resolved (CR 608.2b). */
    | {
          op: "divideIntoPiles";
          objects: EffectPileObjectSelector;
          divider: EffectPlayerRef;
          chooser: EffectPlayerRef;
          dividePrompt: string;
          pickPrompt: string;
          chosenBind: string;
          otherBind: string;
          chosenEffect: EffectOp[];
          otherEffect: EffectOp[];
      }
    /** CR 508.1a / 509.1b (ADR 0053, pile division) — grant a turn-scoped
     *  "can't attack" or "can't block" restriction to a permanent. A thin
     *  declarative skin over the two existing SpellContext primitives
     *  `setCantAttackThisTurn` / `setCantBlockThisTurn`, one execution path
     *  (ADR 0045) — the same "restriction grant" reuse `tapUntap` already
     *  established for tap/untap. `target` is an object selector: an
     *  announced target slot, `$source`, or (the only shape the six pile
     *  cards use) the current `forEach { set: "bound" }` member `$each` over
     *  an unchosen pile (Fight or Flight, Stand or Fall). Skipped when the
     *  referenced permanent is gone (CR 608.2b). */
    | {
          op: "restrictCombat";
          restriction: "cant-attack" | "cant-block";
          target: EffectObjectSelector;
      };

/** A PREDEFINED predicate form for the `if` construct (ADR 0045, issue #806).
 *  The grammar is frozen at two enumerated forms — there are NO arbitrary
 *  boolean expressions, so the validator can statically check every reference
 *  and the bot can read the branch condition without executing the card:
 *
 *  - a BOOLEAN BINDING test — reads a boolean binding produced by an earlier
 *    Op (today: a `mayPay` Op's outcome), optionally negated with `not`. This
 *    is the "unless its controller pays {2}" form: `{ not: { binding: "$paid" } }`.
 *  - a COMPARISON between two numeric operands — each a literal, a `ref` on a
 *    bound snapshot's power/toughness, or a `count` of a declaratively-selected
 *    set — with one of the standard relational operators.
 *
 *  Growing the predicate vocabulary (a new comparison operator, a new binding
 *  kind) is cheap; adding a NON-enumerated form (a raw expression) requires
 *  reopening ADR 0045. */
export type EffectPredicate =
    | EffectBindingPredicate
    | EffectComparisonPredicate;

/** Boolean-binding predicate: true iff the named boolean binding is true
 *  (`{ binding }`) or false (`{ not: { binding } }`). The binding MUST be a
 *  boolean binding declared by an earlier Op — `validateEffectScript` rejects a
 *  dangling or wrong-family reference. */
export type EffectBindingPredicate =
    | { binding: string }
    | { not: { binding: string } };

/** The relational operators a comparison predicate may use (CR 107 — number
 *  comparisons). Frozen enumerated set. */
export type EffectComparisonOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

/** Comparison predicate: `left <op> right`, each side a numeric `EffectValue`
 *  (literal / ref / count). Reads like "the creature's power is 3 or greater"
 *  (`{ left: { ref: "$src.power" }, op: "ge", right: 3 }`). */
export interface EffectComparisonPredicate {
    left: EffectValue;
    op: EffectComparisonOp;
    right: EffectValue;
}

// `EffectChoiceKind` must stay a subset of the engine's `ZonePickKind` — the
// choice Op rides the existing Pending Choice pipeline verbatim (issue #805).
// A compile error here means a scriptable kind was invented rather than
// reused.
const _effectChoiceKindConforms: (k: EffectChoiceKind) => ZonePickKind = (k) =>
    k;
void _effectChoiceKindConforms;

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

/** CR 118.9 — an ALTERNATIVE casting cost that REPLACES the spell's mana cost
 *  entirely with a land-interaction cost the caster may choose at announcement
 *  (`announceCast.alternativeCostId`). Unlike an `additionalCosts` entry (paid
 *  ON TOP of mana), an alternative cost is paid INSTEAD of the mana cost:
 *  choosing it zeroes the mana cost for that cast. These variants pay by
 *  returning permanents to their owner's hand (Gush "return two Islands you
 *  control to their owner's hand rather than pay this spell's mana cost",
 *  Thwart "return three Islands") or by sacrificing them (Fireblast "sacrifice
 *  two Mountains").
 *
 *  The chosen permanents are auto-selected from the caster's matching
 *  permanents at cast commit (CR 601.2h) — for the fungible basics these cards
 *  name (any two Islands, any two Mountains) the choice is immaterial, matching
 *  the project's "auto-resolve a choice with no real option" policy. The
 *  on-resolution effect is authored DSL-first and is independent of which cost
 *  was paid (ADR 0045). This is CR 118.9 alternative cost — a rules concept
 *  with no keyword name, so it carries no Mechanics Registry row (the registry
 *  censuses named keywords/Ops; the resolution Ops here — draw / counter /
 *  dealDamage — are already censused). */
export interface AlternativeCost {
    /** Stable id referenced by `announceCast.alternativeCostId` to pick this
     *  variant. Unique within a card's `alternativeCosts`. */
    id: string;
    /** Player-facing label for the cast-option picker (e.g. "Return two
     *  Islands"). */
    description: string;
    /** PERMANENT leg (CR 118.9): how the matching permanents leave the
     *  battlefield — `"return"` bounces them to their owner's hand (CR 701.24),
     *  `"sacrifice"` moves them to the graveyard as a sacrifice (CR 701.16).
     *  Optional: a life-only or hand-cost alternative (Snuff Out, Force of Will,
     *  Foil) has no permanent leg. Present iff `count`/`filter` are. */
    action?: "return" | "sacrifice";
    /** How many matching permanents the caster must return / sacrifice
     *  (permanent leg only). */
    count?: number;
    /** Which of the caster's permanents qualify (permanent leg only; matched
     *  against the caster's own battlefield; "you control" is implicit). */
    filter?: PermanentFilter;
    /** LIFE leg (CR 118.4 / 119.4): life paid as part of the alternative cost.
     *  Snuff Out ("pay 4 life"), Force of Will / Force of Negation ("pay 1
     *  life and exile a blue card"). Paid at cast commit; affordable only when
     *  the caster's life total ≥ this amount (CR 119.4). */
    payLife?: number;
    /** HAND leg (CR 118.9): cards the caster gives up FROM HAND — exiled
     *  (Force of Will / Force of Negation / Force of Vigor / Pyrokinesis) or
     *  discarded (Foil). Each requirement is a distinct card filter × count and
     *  must be satisfied by DISTINCT cards (Foil: "an Island card and another
     *  card"). The cast card itself never pays for its own cost (it is on the
     *  stack, not in hand). WHICH cards pay is the caster's choice (parks for a
     *  picker when real, auto-resolves when forced). */
    handCost?: {
        /** Whether the chosen hand cards are exiled (CR 701.13) or discarded
         *  (CR 701.9). */
        action: "exile" | "discard";
        requirements: { filter: EffectCardFilter; count: number }[];
    };
    /** Cast-availability CONDITION (CR 118.9 — "if it's not your turn", "if you
     *  control a Swamp"). The variant is only offered/legal when it holds; an
     *  absent condition means always available. */
    condition?: AlternativeCostCondition;
}

/** When an {@link AlternativeCost} variant is legal to choose (CR 118.9). */
export type AlternativeCostCondition =
    /** Only on the caster's own turn (Mine Collapse "If it's your turn"). */
    | { kind: "your-turn" }
    /** Only when it is NOT the caster's turn (Force of Vigor / Force of
     *  Negation "If it's not your turn"). */
    | { kind: "not-your-turn" }
    /** Only while the caster controls a permanent matching `filter`
     *  (Snuff Out "If you control a Swamp"). */
    | { kind: "control"; filter: PermanentFilter };

/** Full card definition used by the GRE. */
export interface CardDefinition {
    id: CardId;
    name: string;
    /** Printed rarity of this card in its HOME set (the set the definition is
     *  declared in). Reprints in other sets carry their own rarity on the
     *  `CardPrint`. Required: a new card must declare its rarity (CR 206) —
     *  the registry self-check and the generator both enforce presence. */
    rarity: Rarity;
    manaCost?: ManaCost;
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    /** Starting loyalty of a planeswalker (CR 306.5b). When the permanent
     *  enters the battlefield the engine places this many `counters["loyalty"]`
     *  on it (`state.ts` ETB block) — loyalty counters reuse the generic
     *  `CardInstanceState.counters` map (same shape as Age/Fade/charge). Only
     *  meaningful on a card whose `types` include "Planeswalker". */
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
    /** Additional INDEPENDENT target groups beyond the primary
     *  `targetRequirement` (CR 601.2c — a spell may instruct the player to
     *  choose several targets of DISTINCT descriptions). Each entry is a fully
     *  independent `TargetRequirement` chosen in order AFTER the primary one;
     *  the resulting targets are appended to the stack item's flat `targets`
     *  list in declaration order (primary first, then each additional), so an
     *  Effect Script references them positionally — Fumarole ("destroy target
     *  creature and target land") declares `targetRequirement: { type:
     *  "Creature", count: 1 }` + `additionalTargetRequirements: [{ type:
     *  "Land", count: 1 }]` and destroys `{ target: 0 }` (the creature) and
     *  `{ target: 1 }` (the land). Legality for EVERY group is checked at cast
     *  announcement (CR 601.2c). Undefined for the common single-group case. */
    additionalTargetRequirements?: TargetRequirement[];
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
    /** Effect Script (ADR 0045): the spell's resolution as declarative,
     *  JSON-pure data — an ordered flat list of Ops executed top to bottom
     *  by the interpreter (`convex/gre/effects/interpreter.ts`), each Op
     *  calling an existing SpellContext primitive. DSL-first is mandatory
     *  for new cards whose effect the Op vocabulary can express; `resolve()`
     *  remains the escape hatch for protocol-like cards and needs an explicit
     *  justification (ADR 0045). Mutually exclusive with `resolve`,
     *  `resolveSteps` and `effect` for this effect site — combining them
     *  throws at lookup and fails the catalogue validation sweep. Ability
     *  sites (activated/triggered/modes) adopt Effect Scripts in follow-up
     *  slices. */
    effects?: EffectOp[];
    /** Declarative marker: this spell's resolution destroys every land in play
     *  (CR 701.7, e.g. Armageddon's `ctx.destroyAll("Land")`). Purely a
     *  classification hint for effects that need to reason about a spell's
     *  outcome WITHOUT running its imperative `resolve()` — currently
     *  Equinox's "{T}: Counter target spell if it would destroy a land you
     *  control" (`spellWouldDestroyLandControlledBy`). It does NOT change how
     *  the spell resolves. Set it on any mass-land-destruction card whose
     *  effect lives in an opaque `resolve()`/`destroyAll` body. */
    destroysAllLands?: boolean;
    /** CR 701.5c — "This spell can't be countered." A spell so flagged is
     *  STILL a legal target for an effect that says "counter target spell"
     *  (targeting is unaffected — the oracle ruling for Obliterate is
     *  explicit: "Counterspells can be cast that target it, but when they
     *  resolve they simply don't counter it since it can't be countered.").
     *  The exception lives entirely at the RESOLUTION of the countering
     *  effect: `SpellContext.counter` (the single choke point every counter
     *  card — DSL `counter` Op or a `resolve()` closure — routes through)
     *  checks this flag on the target and, when set, returns without removing
     *  the spell from the stack. Everything else the countering spell/ability
     *  does (additional effects, its own resolution) proceeds normally — only
     *  the counter half fizzles (CR 608.2b — it does as much as possible).
     *  Used by Obliterate, Urza's Rage, Blurred Mongoose, Kavu Chameleon
     *  (issue #1065). */
    cantBeCountered?: true;
    /** Bot move-enumeration constraint (issue #938): a "copy-on-ETB" spell that
     *  enters the battlefield as — or creates a token that's — a copy of a
     *  permanent already in play (Clone, Copy Artifact, Vesuvan Doppelganger,
     *  Dance of Many). Such a cast is legal but strictly wasteful when no
     *  permanent it could copy exists: it resolves into a do-nothing permanent
     *  (a blank enchantment / a 0/0 that dies to SBA) while spending its mana
     *  and a card. The vs-AI Bot's move enumerator (`enumerateCastMoves`)
     *  prunes the cast while NO permanent on ANY battlefield matches this
     *  filter, so the whole class inherits the prune declaratively rather than
     *  via a hard-coded card-id list. It does NOT change CR legality: human /
     *  server casts are unconstrained (a player may still cast into an empty
     *  board). Keyed off the copiable-source description, e.g. `{ types:
     *  "Artifact" }` for Copy Artifact, `{ types: "Creature" }` for Clone. */
    copySourceFilter?: PermanentFilter;
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
    /** CR 614.1c self-conditional replacement: this permanent enters the
     *  battlefield tapped UNLESS the predicate returns true — the fast-land /
     *  check-land / "unless it's your Nth turn" shape (Botanical Sanctum
     *  "unless you control two or fewer other lands", Arena of Glory "unless
     *  you control a Mountain", Starting Town "unless it's your first, second,
     *  or third turn of the game"). Evaluated once, at the moment of entry,
     *  against the entering permanent's controller's board state — the
     *  predicate does NOT see the entering permanent itself (CR 614.1c: the
     *  replacement is chosen and applied as the object is about to enter, not
     *  after). Mutually exclusive in effect with `entersTapped: true` (that
     *  flag wins unconditionally when both are set — no card needs both). A
     *  land declaring neither field enters untapped as normal. */
    entersTappedUnless?: (
        view: LandEntryStateView,
        controllerId: string
    ) => boolean;
    /** CR 614.12 land-entry pay-choice (shock lands — Steam Vents "as it
     *  enters, you may pay 2 life; if you don't, it enters tapped"). Unlike
     *  `entersTappedUnless` (a deterministic board predicate), this suspends
     *  land entry on a stackless `land-entry-tapped` PendingChoice: the
     *  controller may pay this cost to skip the land's OWN tapped clause.
     *  Declining taps it. Paying removes only this clause — any other tapped
     *  source (Kismet) still applies independently (CR 616). `MayPayCost`
     *  generalises the clause beyond life. See ADR 0051. */
    entersTappedUnlessPay?: MayPayCost;
    /** Tracks continuity of control like summoning sickness, even for
     *  noncreature permanents (CR 302.6 generalised). When set, the permanent
     *  enters with `isSummoningSick` and clears it at its controller's untap
     *  step, so an activated ability can gate on "controlled continuously since
     *  your most recent turn began" via `canActivate: (s) => !s.isSummoningSick`
     *  combined with `controllerTurnOnly`. Used by Rocket Launcher. */
    tracksControlContinuity?: boolean;
    /** Counters placed on the permanent when it enters the battlefield
     *  (CR 122.1, 614.1c). Each entry is a counter type and a count, where
     *  `count: "X"` reads the value chosen for X at cast time (CR 107.3), and
     *  `count: "kicker"` reads how many times the spell was kicked (CR 702.33e —
     *  "a charge counter for each time it was kicked", Everflowing Chalice).
     *  Applied by
     *  `finalizeSpellResolution` after the permanent is on the battlefield. */
    entersWith?: {
        counters?: { type: string; count: number | "X" | "kicker" }[];
    };
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
     *  creature's mana value").
     *
     *  When `exileFilter` is used (instead of `sacrificeFilter`), the chosen
     *  permanent is EXILED rather than sacrificed (CR 118.5 / 406 — FEM Soul
     *  Exchange: "As an additional cost to cast this spell, exile a creature
     *  you control."). The exiled permanent's subtypes are snapshotted on the
     *  stack item so `SpellContext.getAdditionalCostSubtypes()` can read them at
     *  resolve (Soul Exchange's "+2/+2 counter if the exiled creature was a
     *  Thrull"). Provide exactly one of `sacrificeFilter` / `exileFilter`.
     *  Unlike the sacrifice form, the exile form MAY coexist with
     *  `targetRequirement`: targets are chosen first (CR 601.2c), then the
     *  additional-cost picker opens (CR 601.2f), then mana is paid. */
    additionalCosts?: {
        sacrificeFilter?: PermanentFilter;
        exileFilter?: PermanentFilter;
        /** CR 601.2b / 118.4 — "As an additional cost to cast this spell, pay X
         *  life." The caster chooses X at announcement (independent of the mana
         *  cost — the card has no {X} pip); the engine pays X life at cast
         *  commit and snapshots X onto the stack item so `getX()` returns it at
         *  resolve. The cast is illegal if the player's life is below the chosen
         *  X (CR 118.4 — you can't pay more life than you have). When set, the
         *  spell's `targetRequirement.count` may be `"X"` to take up to X
         *  targets, and the divided total equals the chosen X. Used by Fire
         *  Covenant. */
        payXLife?: boolean;
        /** CR 601.2b / 118.4 — "As an additional cost to cast this spell, pay N
         *  life" for a FIXED N (distinct from the caster-chosen `payXLife`).
         *  The engine pays exactly N life at cast commit; the cast is illegal if
         *  the player's life is below N (CR 118.4 — you can't pay more life than
         *  you have). Composes with `targetRequirement` /
         *  `additionalTargetRequirements` (targets are chosen first, CR 601.2c).
         *  Used by Fumarole ("pay 3 life"). */
        payLife?: number;
        /** CR 107.3 / 608.2g — "X is the number of <cards> in an opponent's
         *  graveyard as you cast this spell." X is COMPUTED by the engine at
         *  announcement from the named card types in the chosen opponent's
         *  graveyard (not chosen by the caster, not paid). The computed value is
         *  snapshotted onto the stack item as `chosenX` so `getX()` returns it at
         *  resolve and the value can't change after the spell is cast. Used by
         *  Spoils of War (`cardTypes: ["Artifact", "Creature"]`). For a 2-player
         *  game "an opponent" is unambiguous; the single opponent's graveyard is
         *  counted. */
        xFromOpponentGraveyard?: { cardTypes: CardType[] };
        /** CR 702.34a / 118.5 — a FLASHBACK-only additional cost: "Exile X
         *  <color> cards from your graveyard." Applies ONLY when the spell is
         *  cast via flashback (from the graveyard); a normal cast from hand
         *  skips it entirely. The number of cards exiled equals the announced X
         *  (the card carries a variable `{X}` pip, so this composes with the
         *  existing `chosenX` flow — X drives BOTH the exile count and the
         *  effect). The caster picks exactly X matching cards from their OWN
         *  graveyard via `selectCastExileCost`; the picked cards move graveyard
         *  → exile at cast commit. The flashback card itself is never eligible
         *  (it is leaving the graveyard as it's cast — CR 702.34e "You can't
         *  exile <this> to pay for its own flashback cost"). Used by Flash of
         *  Insight ("Flashback—{1}{U}, Exile X blue cards from your
         *  graveyard"). `color` filters the eligible cards (CR 105.2); omit for
         *  any card. */
        flashbackExileFromGraveyard?: { color?: Color };
    };
    /** CR 118.9 — alternative casting costs the caster may choose at
     *  announcement INSTEAD of paying this spell's mana cost. Each entry pays
     *  by returning or sacrificing N matching permanents the caster controls.
     *  See {@link AlternativeCost}. Used by Gush, Thwart (return Islands) and
     *  Fireblast (sacrifice Mountains). */
    alternativeCosts?: AlternativeCost[];
    /** CR 702.74 — Evoke. "Evoke [cost]" represents TWO abilities (702.74a): a
     *  static ability ("you may cast this card by paying [cost] rather than
     *  paying its mana cost") and a triggered ability ("when this permanent
     *  enters, if its evoke cost was paid, its controller sacrifices it").
     *  This field carries only the FIRST half — reuses the {@link
     *  AlternativeCost} shape verbatim (CR 118.9 already governs "casting a
     *  spell for its evoke cost", per 702.74a's own text), the SAME cost-system
     *  infra as `alternativeCosts` (`convex/gre/alternativeCost.ts`'s
     *  `getAlternativeCost`/`affordableAlternativeCosts` resolve this field
     *  alongside the array). Kept as its own dedicated field — like
     *  `flashback`/`madness`/`escape` — rather than folded into
     *  `alternativeCosts[]`, because a card's chosen alt cost must be
     *  IDENTIFIABLE as "the evoke one" at cast commit (compared by reference
     *  against this field) so the engine can tag the resulting stack item
     *  `evoked: true` (`convex/game.ts`), which then rides onto the entering
     *  permanent for free (a stack item IS its `CardInstanceState`, same
     *  object — the `escaped` precedent). The SECOND half (the sacrifice) is a
     *  real `TriggeredAbility` a card adds to its own `triggeredAbilities[]`
     *  via the `evokeTrigger` template (`convex/cards/abilities/evoke.ts`),
     *  gated on `CardInstanceState.evoked`. Used by Solitude, Grief (MH2
     *  Elemental Incarnations — their evoke cost is a pure HAND leg, "Exile a
     *  <colour> card from your hand", so it composes with the EXISTING
     *  alt-cost hand-leg picker with zero new plumbing). By convention this
     *  card's `AlternativeCost.id` is `"evoke"`. */
    evoke?: AlternativeCost;
    /** CR 702.34 — Flashback. A static ability that functions while the card
     *  is in its owner's graveyard: "You may cast this card from your graveyard
     *  by paying [this cost] rather than its mana cost", and "If the flashback
     *  cost was paid, exile this card as it resolves or leaves the stack."
     *  Set to the alternative flashback mana cost (e.g. Faithless Looting's
     *  `{2}{R}` → `{ X: 2, R: 1 }`). The engine (`convex/gre/flashback.ts`)
     *  reads this to make a graveyard card castable; the resolving stack item
     *  is flagged `exileOnResolve` so `finalizeSpellResolution` sends the card
     *  to exile instead of the graveyard. A temporary grant (Snapcaster Mage,
     *  `CardInstanceState.grantedFlashback`) overrides / supplies this at the
     *  instance level. Set to a bare {@link ManaCost} for a mana-only flashback
     *  (Faithless Looting), or to a {@link FlashbackCost} to add a flashback-only
     *  NON-mana cost — sacrifice a permanent and/or exile a card from hand
     *  (Lava Dart: "Sacrifice a Mountain") — that never leaks onto the hand
     *  cast (CR 702.34a). */
    flashback?: ManaCost | FlashbackCost;
    /** CR 702.138 — Escape. The escape cost this card may be cast from its own
     *  owner's graveyard for (mana + exile other graveyard cards). The engine
     *  (`convex/gre/escape.ts`) reads this to make the graveyard card castable;
     *  the resolving permanent is flagged `escaped` (CR 702.138e). Used by Uro,
     *  Phlage, Nethergoyf. */
    escape?: EscapeCost;
    /** CR 702.35 — Madness. The alternative mana cost this card may be cast for
     *  out of exile in the window right after it is discarded (the engine
     *  `convex/gre/madness.ts` reads this). On discard the card is exiled
     *  instead of going to the graveyard (CR 702.35c) and its owner may cast it
     *  for this cost (CR 702.35d); an uncast copy is put into the graveyard at
     *  cleanup. `Madness {0}` is the empty cost `{}` (a real, free cost — not
     *  `undefined`, which means "no madness"). Used by Basking Rootwalla
     *  (`{}`), Blazing Rootwalla (`{}`), Anje's Ravager (`{ X: 1, R: 1 }`). */
    madness?: ManaCost;
    /** CR 702.138 — a static ability granting escape to EVERY nonland card in
     *  its controller's graveyard (Underworld Breach). The granted escape cost
     *  is each card's OWN mana cost plus exiling `exileOtherCount` other cards
     *  from that graveyard (CR 702.138a). Functions only while this permanent is
     *  on the battlefield. */
    grantsEscapeToOwnGraveyard?: { exileOtherCount: number };
    /** CR 702.33 — Kicker. An OPTIONAL additional cost the caster may pay as
     *  they cast this spell, snapshotted on the resulting stack item and read at
     *  resolution ({@link KickerCost}). The on-resolution effect stays DSL-first
     *  (`effects`); only the cast/cost permission lives in the engine. Used by
     *  Overload, Bloodchief's Thirst, Burst Lightning, Tear Asunder, Consult the
     *  Star Charts (single Kicker) and Everflowing Chalice (Multikicker). */
    kicker?: KickerCost;
    /** CR 702.33 — the target requirement that REPLACES `targetRequirement` when
     *  this spell was kicked ("If this spell was kicked, [do something to] target
     *  <different thing> instead"). Chosen at announcement (the kick decision
     *  precedes target selection, CR 601.2b/601.2c). Used by Bloodchief's Thirst
     *  ("target creature or planeswalker with mana value 2 or less" →
     *  unrestricted when kicked) and Tear Asunder ("target artifact or
     *  enchantment" → "target nonland permanent"). Omit when the target set is
     *  unchanged by kicking (Overload, Burst Lightning — the effect, not the
     *  target, differs). */
    kickedTargetRequirement?: TargetRequirement;
    /** Adds this many generic mana to the total cost for each target beyond
     *  the first (CR 601.2f). Used by Fireball ("costs {1} more to cast for
     *  each target beyond the first"). */
    additionalGenericPerExtraTarget?: number;
    /** Mana-spent tracking for the SPELL CAST (CR 106.4 / 202.3 — the cast-path
     *  twin of the activated-ability `ActivatedAbility.noteManaSpent`). When
     *  true, the engine snapshots the per-colour mana-pool delta around payment
     *  and writes it onto the resulting stack item as `notedManaSpent`, readable
     *  in `resolve` via `SpellContext.getNotedManaSpent()`. Used by Soul Burn to
     *  cap its lifegain by the {B} spent on X. NOTE (flagged simplification): the
     *  pool carries no provenance of which mana paid the variable {X} portion vs
     *  the fixed pips, so the resolve derives "{B} spent on X" as the noted black
     *  minus the card's fixed black pips, clamped to [0, X]; the oracle's "spend
     *  ONLY black and/or red mana on X" payment restriction is not enforced at
     *  tap time (no engine seam exists for colour-restricted generic payment). */
    noteManaSpent?: boolean;
    /** Restricts cast timing to a specific subset of phases (CR 117.1b).
     *  When set, the spell is castable only while `state.phase` is in this
     *  list. Used by Berserk ("cast only before the combat damage step") —
     *  the instant-speed check still applies, this only narrows further. */
    castPhaseRestriction?: Phase[];
    /** CR 107.3 — an upper bound on the chosen X, keyed to a LIVE board count
     *  that only the engine can read ("X can't be greater than the number of
     *  snow lands you control", Winter's Chill). A declarative tag (not a
     *  closure — JSON-pure) resolved by the cast path and the Bot's X
     *  enumeration to the caster's current count; announcing a larger X is
     *  rejected at cast time. `"snow-lands"` counts the caster's snow lands via
     *  `countSnowLands` (honoring Melting / Arcum's Weathervane supertype
     *  mutation). Extend the union as further board-count caps arise. */
    castXUpperBound?: "snow-lands";
    /** CR 601.3e — "Cast this spell only if no permanent[s] named <this card's
     *  name> are on the battlefield." When true, the spell's Cast action is
     *  suppressed (and the server cast rejected) while any permanent on either
     *  battlefield shares this card's name (FEM Tidal Influence). Name match
     *  uses the printed card name (CR 201.2), so alternate-art prints of the
     *  same card collide as expected. */
    castUniqueByName?: boolean;
    /** When true, the normal draw at draw step is suppressed if the controller
     *  controls this permanent. A phaseTrigger at DRAW handles the choice
     *  (skip or draw). Used by Island Sanctuary. */
    drawStepReplacement?: boolean;
    /** Restricts cast timing by whose turn it is (CR 117.1b). `"opponent"` —
     *  only during an opponent's turn (Siren's Call). `"self"` — only during the
     *  controller's own turn (Camouflage's "during your declare attackers
     *  step", combined with `castPhaseRestriction`). */
    castTurnRestriction?: "opponent" | "self";
    /** Extra land drops per turn granted to the controller while this permanent
     *  is on the battlefield (CR 305.2 — Fastbond). Added to LAND_DROPS_PER_TURN
     *  at land-play legality check time. Use 999 for unlimited. */
    extraLandDrops?: number;
    /** While ANY permanent with this flag is on the battlefield, no player may
     *  play a land (CR 305.1 special action prohibition) AND a land that would
     *  enter the battlefield from any source is prevented from entering (CR 614
     *  replacement-style prohibition). Worms of the Earth. Read live from the
     *  battlefield (like `extraLandDrops`) so the lock lifts automatically the
     *  instant the source leaves play — no stale flag. The engine mirrors the
     *  derived value into `GameState.landPlayLocked` at every SBA pass for
     *  serialization/observability, but the consumption sites read the live
     *  helper, so the cache can never cause an incorrect ruling. */
    preventsLandPlayAndETB?: boolean;
    /** Continuous land-mana colour substitution (CR 614). While ANY permanent
     *  with this declaration is on the battlefield, a LAND tapped for mana has
     *  its produced colours rewritten per the substitution before the mana
     *  reaches the pool (Infernal Darkness — all lands produce {B}; Naked
     *  Singularity — per-basic-subtype permutation). Read live from the
     *  battlefield through the single `applyLandManaReplacement` mana funnel
     *  (like `extraLandDrops`/`preventsLandPlayAndETB`), so the effect ends the
     *  instant the source leaves play — no GameState flag, no stale state. */
    landManaSubstitution?: LandManaSubstitution;
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
 *  `getDefinition(printId)` lookup transparently returns the original
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
    /** Printed rarity of THIS printing (CR 206). May differ from the home-set
     *  `CardDefinition.rarity` when a card is reprinted at a different rarity.
     *  Required: every printing declares its own rarity. */
    rarity: Rarity;
}
