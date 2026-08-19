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

/** Where a card revealed off the top of a library can be routed by the
 *  `revealTopAndRoute` Op (CR 400.7). `"library"` is deliberately absent — the
 *  card is already there, and "put it back on top / on the bottom" is
 *  `scryReorder`'s job (it owns the ordering choice this Op has no use for). */
export type RevealRouteDestination =
    | "battlefield"
    | "hand"
    | "graveyard"
    | "exile";

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
    /** CR 202.1a / 107.4e — GUILD-HYBRID mana pips ({B/G}, {W/U}, …). Each entry
     *  is one hybrid pip, listed as the two colours it may be paid with (order
     *  irrelevant). Hogaak `{5}{B/G}{B/G}` → `[["B","G"],["B","G"]]`. A hybrid
     *  pip is paid at cast time with one mana of EITHER colour (or by a Convoke
     *  creature of either colour — CR 702.51). This field DECLARES the pips; the
     *  flat generic/single-colour requirement stays in the other keys, and
     *  `normalizeManaCost` folds each pip into a composite `"B/G"` key (issue
     *  #1738) so every payment consumer owes it — pool payment, the castability
     *  probe, land AUTO-TAP (`convex/gre/autoTap.ts`, issue #1739) and the
     *  payWith / convoke path (`convex/gre/payWith.ts`) alike.
     *  `manaValue` counts each pip as 1 (CR 202.3f), and `getColorsFromCost`
     *  includes BOTH colours of each pip in the card's colour (CR 105.2 / 202.2).
     *  NARROW scope (issue #1338): only two-colour guild hybrid — MONOCOLOUR
     *  hybrid ({2/B}) is still unmodelled (issue #1743). Shipped hybrid cards
     *  pay these pips with real mana (Figure of Fable, the ECL Elemental
     *  Incarnations, Carnage Interpreter); Hogaak is the exception only because
     *  it forbids spending mana, so its pips are always convoked. */
    hybrid?: Array<[Color, Color]>;
};

/** CR 702.34a / 118.5 — the full Flashback cost, generalizing the mana-only
 *  `CardDefinition.flashback?: ManaCost` to carry an optional NON-mana cost
 *  component that applies ONLY on the flashback (graveyard) cast, never on the
 *  card's normal hand cast. A card whose flashback cost is purely mana can still
 *  set `flashback` to a bare `ManaCost` — the engine normalizes both shapes
 *  (`convex/gre/flashback.ts` → `normalizeFlashbackCost`). All additional costs
 *  reuse existing cost machinery scoped to the flashback cast path only:
 *  `sacrifice` routes through the unified sacrificeChoice layer (always an
 *  explicit player sacrifice choice, CR 701.21a), `exileFromHand` through the flashback
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
 *  (CR 702.138b) — a flag the resulting permanent carries
 *  (`CardInstanceState.escaped`), read by "as long as ~ escaped" /
 *  "sacrifice it unless it escaped" clauses (Uro, Phlage, Nethergoyf).
 *  Unlike Flashback (CR 702.34), an escaped card is NOT exiled as it resolves —
 *  it moves graveyard → stack → its normal destination (battlefield for a
 *  permanent, graveyard for an instant/sorcery). Read by
 *  `convex/gre/escape.ts`. */
export interface EscapeCost {
    /** The mana portion of the escape cost (CR 702.138a). */
    mana: ManaCost;
    /** CR 702.138a escape — exile OTHER cards from the caster's graveyard as an
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

/** CR 702.33 — ONE Kicker: an OPTIONAL additional cost the caster may choose to
 *  pay as they cast the spell ("You may pay an additional [cost] as you cast
 *  this spell"). Paid ON TOP of the mana cost at cast time (CR 601.2f — unlike
 *  an {@link AlternativeCost}, which REPLACES it, CR 118.9).
 *
 *  A Kicker cost is an additional cost of ANY kind (CR 702.33a), so its legs are
 *  the shared {@link CostLegs} vocabulary (ADR 0079): mana (Overload's `{2}`),
 *  a permanent to sacrifice or return (Bog Down's two lands, Arctic Merfolk's
 *  "return a creature you control"), life (Phyrexian Scuta's "pay 3 life") and
 *  cards from hand (Dralnu's Pet's `{2}{B}` + discard a creature card). All
 *  present legs are paid together, once per kick.
 *
 *  A card declares an ARRAY of these ({@link CardDefinition.kickers}) because
 *  "Kicker {A} and/or {B}" (the Planeshift Battlemage cycle) is two
 *  INDEPENDENTLY payable Kickers on one spell, each with its own intervening-if
 *  ETB trigger. How many times each was paid is recorded per `id` on the
 *  resulting stack item (`StackItem.kickerPayments`); DSL scripts read the
 *  per-Kicker answer with `{ kickerPaid: "<id>" }`
 *  ({@link EffectKickerPaidValue}) and the total with `{ kickerCount: true }`
 *  ({@link EffectKickerCountValue}). Kicker is a cost-system / keyword-cast
 *  capability (engine infra), NOT an Effect Script Op.
 *
 *  - single Kicker (Overload, Burst Lightning, Bloodchief's Thirst, Tear
 *    Asunder, Consult the Star Charts): kicked at most once → its payment count
 *    is 0 (not kicked) or 1 (kicked).
 *  - Multikicker (CR 702.33e — Everflowing Chalice): `multi: true` lets the
 *    caster pay THIS Kicker's cost any number of times; the recorded count is
 *    how many times it was paid. Multikicker is a property of one Kicker, not of
 *    the card. */
export type KickerCost = CostLegs & {
    /** Stable id for this Kicker, unique within the card. Keys the per-Kicker
     *  payment record (`StackItem.kickerPayments`) and the `{ kickerPaid }`
     *  Effect Script value. A single-Kicker card conventionally uses `"kicker"`;
     *  a two-Kicker card names them for the cost being paid (`"kicker-u"` /
     *  `"kicker-r"` on a Battlemage). */
    id: string;
    /** Human-readable cost text for the cast-cost dialog's per-Kicker toggle
     *  ("Kicker {2}{U}", "Kicker — sacrifice two lands"). The client renders
     *  this verbatim, so a non-mana leg is legible BEFORE the caster commits. */
    description: string;
    /** CR 702.33e — Multikicker: THIS Kicker's cost may be paid any number of
     *  times as the spell is cast. Omitted/false = a single kicker (paid at most
     *  once). */
    multi?: boolean;
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

/** CR 303.4 — "What an Aura can be attached to is defined by its enchant
 *  keyword ability (see rule 702.5)." This is the NORMALIZED form of that
 *  restriction, shared by the two ways an object can carry one:
 *
 *  - **printed** — derived from the Aura card's cast-time `targetRequirement`
 *    (Control Magic's "enchant creature" is `{ type: "Creature" }`), and
 *  - **granted at runtime** — stamped on a single permanent that BECOMES an
 *    Aura while on the battlefield (the `addSubtype` Op's `enchantRestriction`
 *    field; Necromancy's "it becomes an Aura with enchant creature").
 *    `CardInstanceState.grantedEnchantRestriction` is where it lives.
 *
 *  An object can carry BOTH at once, and then both apply: CR 702.5c — "If an
 *  Aura has multiple instances of enchant, all of them apply. … The Aura can
 *  enchant only objects or players that match all of its enchant abilities."
 *  The single predicate `resolveEnchantRestriction` (`convex/gre/state.ts`)
 *  returns every clause and every legality site conjoins them — the CR 303.4c
 *  / 704.5m attachment SBA and the CR 303.4f non-cast host scan alike — so the
 *  OFFERED host set and the ENFORCED host set cannot diverge. The granted
 *  clause is battlefield-scoped (CR 400.7): an object off the battlefield
 *  carries only its printed one, at both sites. */
export interface EnchantRestriction {
    /** Card types, ANY of which a PERMANENT host must have (CR 702.5a — "The
     *  enchant ability restricts what an Aura spell can target and what an
     *  Aura can enchant"; "enchant creature"). Absent or empty accepts no
     *  permanent — an Aura restricted only to players (`players: true`)
     *  legitimately has none. */
    types?: CardType[];
    /** CR 303.4 "enchant player" — a player is a legal host in its own right.
     *  Never a battlefield object, so it is a separate flag rather than a
     *  member of `types`. */
    players?: boolean;
    /** CR 303.4 — a restriction naming ONE specific object rather than a
     *  characteristic ("enchant creature put onto the battlefield with
     *  Necromancy"). When set, ONLY the permanent with this instance id is a
     *  legal host, in ADDITION to the `types` match. Instance-scoped by
     *  nature: a printed `targetRequirement` can never produce one, because
     *  the object it names doesn't exist until the effect that grants the
     *  restriction resolves. */
    hostId?: string;
}

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
     *  target selection entirely.
     *
     *  The object form's `max` may ALSO be the literal `"X"` — the genuinely
     *  optional "up to X" variable-count template (CR 601.2c: "as many as you
     *  choose, from zero to X", e.g. Pest Infestation "Destroy up to X target
     *  artifacts and/or enchantments"), distinct from the exact-count `"X"`
     *  string above. Resolved the same way, against `chosenX`, into a live
     *  `{ min, max }` range — `convex/gre/state.ts`'s
     *  `resolveTargetRequirementCount` is the single resolver every count
     *  consumer calls (issue #2365). */
    count: number | "X" | { min: number; max?: number | "X" };
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
    /** Restricts legal permanent targets by tap state (CR 701.26). Used by
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
     *  value X"). Honored for permanent and spell targets.
     *
     *  `"sourcePower"` (issue #1378) resolves to the EFFECTIVE power (CR 613
     *  layer 7c) of the announcing source permanent — Guardian Scalelord's
     *  "return target nonland permanent card with mana value X or less from
     *  your graveyard to the battlefield, where X is this creature's power".
     *  Distinct from `"X"` (the spell/ability's OWN chosen `{X}`): this reads
     *  a live BOARD value, not an announced cost. Resolved at the SAME point
     *  `"X"` already is — legal-target computation
     *  (`getLegalTargets`/`raiseTriggerTargetSelection`) and pending-target
     *  filter carry (`pendingTargetFiltersFromRequirement`) — so the value is
     *  fixed as the ability is put on the stack / targets are announced
     *  (CR 603.3d) and never re-evaluated at resolution, mirroring how Ward /
     *  Backup's `targetIsAnother` already need no re-check plumbing. Falls
     *  back to 0 when the source cannot be located (CR 608.2b convention,
     *  matching `EffectManaValueValue`'s own left-play fallback) —
     *  unreachable in practice since resolution happens synchronously as the
     *  ability is placed, with no priority window for the source to leave.
     *  Meaningful only for a TRIGGERED or ACTIVATED ability whose source is a
     *  battlefield permanent (a cast SPELL's source is a hand card with no
     *  effective power to read); every current caller of `getLegalTargets`
     *  besides the trigger/activated-ability paths simply omits the
     *  `sourcePower` argument, so an unthreaded call resolves `"sourcePower"`
     *  to 0 rather than silently misreading an unrelated value. */
    mvFilter?: {
        min?: number | "X" | "sourcePower";
        max?: number | "X" | "sourcePower";
        equals?: number | "X" | "sourcePower";
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
     *  control"), for PLAYER targets (CR 115 — "target opponent", Word of
     *  Command; "you" keeps only the caster), and for SPELL/ability stack
     *  targets (CR 109.3 / 114.1 — a stack item's "controller" is its caster;
     *  Lutri, the Spellchaser: "target instant or sorcery spell YOU
     *  CONTROL"), all through the shared `matchesBattlefieldController`
     *  predicate.
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
    /** Restricts legal permanent targets to those whose `staticAbilities`
     *  include AT LEAST ONE of these keywords (CR 702 — OR semantics, the
     *  disjunctive counterpart of the single-keyword `requireAbility`, which
     *  it is orthogonal to: set one or the other). Used by "target creature
     *  with trample or haste" (Minsc & Boo, Timeless Heroes). Ignored for
     *  player / spell targets. */
    requireAbilityAny?: ReadonlyArray<string>;
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
    /** Restricts legal SPELL targets (`type: "spell"`) to spells that THEMSELVES
     *  target at least one PERMANENT of one of these card types (CR 114.1 —
     *  Confound's "Counter target spell that targets a creature"). The filter
     *  reads the candidate stack item's own chosen `targets`, resolves each
     *  `"permanent"` selection against the battlefield, and requires at least
     *  one hit whose `types` include a listed type. Fail-CLOSED by
     *  construction: a spell with no targets, a spell whose targets are all
     *  players / other spells / graveyard cards, and a spell whose permanent
     *  target has already left the battlefield all fail. Non-permanent target
     *  kinds are never counted — CR 109.2 makes "a creature" a creature
     *  PERMANENT, not a creature card in another zone. Single string is
     *  shorthand for one type. Ignored for non-spell target types. */
    spellTargetsTypeFilter?: CardType | CardType[];
    /** Restricts legal SPELL targets (`type: "spell"`) to spells that were
     *  KICKED (CR 702.33a) — at least one Kicker cost was paid as the spell was
     *  cast. Read off the candidate stack item's `kickerPayments` record (the
     *  per-Kicker payment map, ADR 0079), so a card with two distinct Kickers
     *  qualifies when EITHER was paid. `false` is the negative form (only
     *  UNkicked spells qualify). An ability on the stack is never kicked.
     *  Ignored for non-spell target types. */
    spellWasKicked?: boolean;
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
     *  `targetAmounts`. `count` should be `{ min: 1 }` (open-ended).
     *  `kind` (default `"deal"`) tags what the divided budget DOES — every
     *  divide-as-chosen card deals damage except Pollen Remedy, which
     *  PREVENTS it (CR 615.1); the frontend's divide banner/buttons read this
     *  to say "Prevent damage" instead of the default "Deal damage" (QA — the
     *  banner hard-coded "Deal damage" for every divide spell regardless). */
    divideAsChosen?: { total: number | "X" | "X+1"; kind?: "deal" | "prevent" };
    /** Restricts legal SPELL targets (`type: "spell"`) to spells that WOULD
     *  destroy a land the activating player controls (CR 114.1 + 701.8). A
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
     *  spell, never an ability (CR 701.6a; a triggered/activated ability on the
     *  stack is not a legal target for Counterspell et al.). `"spell"` is the
     *  explicit form of that same spell-only default. `"activated-ability"`
     *  instead keeps ONLY activated abilities on the stack (CR 602 / 113.3 — the
     *  stack item carries an `abilityId`); used by Brown Ouphe ("Counter target
     *  activated ability from an artifact source"). `"ability"` keeps ANY
     *  ability — activated OR triggered (and delayed) — but no spells; used by
     *  Stifle ("Counter target activated or triggered ability"). `"any"`
     *  (CR 702.21a, Ward) keeps BOTH spells and abilities — "counter that
     *  spell or ability" needs no kind narrowing at all, unlike every other
     *  value here which excludes one side or the other. Abilities are legal
     *  targets ONLY under an explicit ability-admitting kind (`"activated-
     *  ability"` / `"ability"` / `"any"`). Mana abilities never use the stack
     *  (CR 605.3a), so they are never a legal target regardless. Ignored for
     *  non-spell target types. */
    spellStackKind?: "spell" | "activated-ability" | "ability" | "any";
    /** Restricts a stack-object target (`type: "spell"`) to objects whose
     *  SOURCE card types include at least one of these (CR 113.7a). An
     *  activated ability on the stack carries the source permanent's card
     *  characteristics, so this reads the stack item's live `types`. Used by
     *  Brown Ouphe ("...from an artifact source"). Single string is shorthand
     *  for one type. Ignored for non-spell target types. */
    stackSourceTypeFilter?: CardType | CardType[];
    /** Restricts a stack SPELL-OR-ABILITY target (`type: "spell"`) to objects
     *  that target at least one of these permanent instance ids (CR 114.1).
     *  Injected at activation time via a dynamic `getTargetRequirement` with
     *  the source's own id. Used by Mistfolk ("Counter target spell that
     *  targets this creature", spells only — the default `spellStackKind`).
     *  Combined with `spellStackKind: "any"` (Ward, CR 702.21a) the same
     *  filter also admits abilities: whichever kind gate `spellStackKind`
     *  already applied governs which stack-item kinds reach this filter, so
     *  it no longer hardcodes "abilities never qualify" itself. Ignored for
     *  non-spell target types. */
    spellTargetsInstanceIds?: ReadonlyArray<string>;
    /** Reflexive self-pin (CR 702.21a, Ward): when set on a TRIGGERED
     *  ability's `targetRequirement`, `raiseTriggerTargetSelection`
     *  (`gre/rules.ts`) dynamically populates `spellTargetsInstanceIds` with
     *  the firing stack item's OWN source permanent id (`StackItem.
     *  triggerSourceId` — the permanent carrying the triggered ability, set by
     *  `buildTriggerItem`) rather than a static author-time list. This is what
     *  lets "whenever THIS PERMANENT becomes the target of a spell or ability
     *  an opponent controls, counter it" resolve its own target automatically
     *  (no player choice, CR 603.3d single-legal-target auto-select) without a
     *  parallel event→stack-item resolution mechanism: it reuses the Mistfolk
     *  `spellTargetsInstanceIds` filter, just computed per-instance instead of
     *  per-card. Only meaningful on a TriggeredAbility's requirement (a
     *  spell/activated ability has no `triggerSourceId` to read); ignored
     *  elsewhere. Pair with `spellStackKind: "any"` for CR 702.21a's "spell OR
     *  ability" scope. */
    spellTargetsSelfSource?: boolean;
    /** Reflexive self-EXCLUDE (the inverse of `spellTargetsSelfSource`): the
     *  source permanent's own instance id is merged into `excludeInstanceIds`,
     *  so "exile ANOTHER target permanent" / "up to one OTHER target creature"
     *  cannot pick the source permanent itself. Author-time
     *  `excludeInstanceIds` are preserved and merged. One shared helper,
     *  `applySelfExclusion` (`gre/rules.ts`), performs the merge everywhere.
     *
     *  Honoured on BOTH ability kinds, each reading the source id it has:
     *  a TRIGGERED ability's `StackItem.triggerSourceId`, via
     *  `raiseTriggerTargetSelection` (CR 603.3d target choice at stack
     *  placement); an ACTIVATED ability's on-battlefield source `card`, via
     *  `activateAbilityOnState` (`game.ts`) and the bot's matching
     *  `enumerateAbilityMoves` (issue #2399 — Reflection of Kiki-Jiki's
     *  "another target nonlegendary creature you control"). Ignored on a SPELL
     *  requirement, which has no source permanent to exclude.
     *
     *  The older per-card idiom for the same clause — a dynamic
     *  `getTargetRequirement(source)` closure hand-rolling
     *  `excludeInstanceIds: [source.id]` (Giver of Runes, Manifold Key) — still
     *  works and is untouched, but prefer this flag: a closure cannot ride a
     *  BACK FACE's JSON-encoded definition id, and `enumerateAbilityMoves`
     *  skips any ability that carries one, hiding it from the bot entirely. */
    excludeSource?: boolean;
    /** CROSS-SLOT same-controller constraint spanning the announced target
     *  slots of THIS requirement (CR 601.2c, issue #1104 — Barrin's Spite:
     *  "Choose two target creatures controlled by the same player"). Every
     *  other filter on this interface constrains a slot against the CASTER
     *  or a static value; this is the one relational constraint spanning
     *  slots against EACH OTHER. Checked at BOTH legality-scan
     *  (`getLegalTargets`) and target-selection time (`selectTarget`,
     *  `game.ts`) through the SAME single-authority target-filter registry
     *  (ADR 0068, `gre/targetFilters.ts`): once one target of the pair is
     *  chosen, every LATER pick under this requirement must share that
     *  first pick's LIVE controller (`siblingControllerIdFor`). The FIRST
     *  pick is unconstrained by itself (nothing to compare against yet) —
     *  legal like any other candidate. Meaningful only for `count >= 2`
     *  permanent-kind requirements; ignored for player/spell/graveyard
     *  targets and a `count: 1` requirement (nothing to compare). */
    sameController?: boolean;
    /** Restricts legal permanent targets by token-ness (CR 111.5, issue
     *  #1195). `true` keeps ONLY tokens; `false` keeps ONLY NONTOKEN
     *  permanents ("target nontoken creature", Dance of Many / Satya,
     *  Aetherflux Genius). Mirrors `PermanentFilter.isToken` /
     *  `EffectCardFilter.isToken`'s exact-match semantics (a direct
     *  passthrough of `CardInstanceState.isToken`), just exposed on the
     *  ANNOUNCED-target requirement shape those two already cover for a
     *  `choice`/`count`-selected zone. Ignored for player / spell / graveyard
     *  targets. Closes the DIVERGENCE Dance of Many's ETB trigger has
     *  documented since #1459 ("TargetRequirement has no token filter
     *  field") — see that card for the fix. */
    isToken?: boolean;
    /** Restricts legal permanent targets to those their CURRENT controller has
     *  controlled continuously since the beginning of the current turn — the
     *  same continuity window CR 302.6 describes for summoning sickness, but
     *  anchored to the CURRENT turn rather than to the controller's most recent
     *  untap step (issue #1824). `true` keeps only continuously-controlled
     *  permanents; `false` keeps only those whose control was interrupted (they
     *  entered this turn, or changed controller this turn).
     *
     *  Used by the "choose target creature the ACTIVE PLAYER has controlled
     *  continuously since the beginning of the turn" force-attack cycle
     *  (Norritt, Arcum's Whistle) — pair it with `controller: "active"`, which
     *  supplies the "the active player controls it" half; this field supplies
     *  only the continuity half.
     *
     *  Evaluated through the ONE engine authority
     *  `hasControlledSinceTurnStart` (`gre/controlContinuity.ts`), the same
     *  predicate that backs `PermanentFilter.controlledSinceTurnStart`, off the
     *  `enteredOnTurn` entry stamp (CR 400.7) and the turn-scoped
     *  `GameState.controlChangedThisTurn` break ledger. Deliberately NOT
     *  `isSummoningSick`, which is cleared at its CONTROLLER's untap step and so
     *  stays true across the whole of the opponent's following turn.
     *
     *  FAILS CLOSED when the state view carries no `turn` (a client view built
     *  without the continuity fields): an unverifiable candidate is reported
     *  illegal rather than silently admitted, so the offered set can only ever
     *  narrow relative to the accepted set — never widen. Ignored for player /
     *  spell / graveyard targets. */
    controlledSinceTurnStart?: boolean;
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

/** Where a COUNTERED SPELL ends up instead of CR 701.6a's default owner's
 *  graveyard (issue #683's "if that spell is countered this way, …" clause —
 *  No More Lies "exile it", Memory Lapse "put it on top of its owner's
 *  library", Remand "put it into its owner's hand"). `"graveyard"` is the
 *  CR 701.6a default; every other member is a `moveZone`-style destination
 *  applied to the stack item at the moment it's removed from the stack
 *  (before a plain `moveZone` Op could reach it — a spell on the stack isn't
 *  one of `moveZone`'s recognized object kinds). */
export type CounterDestination = "graveyard" | "exile" | "hand" | "library-top";

export interface TargetSelection {
    /** "permanent" = battlefield card, "player" = player, "spell" = stack
     *  item, "graveyard-card" = card in a player's graveyard (CR 400.7),
     *  "hand-card" = card in a player's hand (issue #1101 — `lookDistribute`'s
     *  `bind` snapshots the KEPT card right after it moves library → hand;
     *  it never becomes a permanent, so a later `manaValue`-of read resolves
     *  it here instead of through the battlefield). */
    type: "permanent" | "player" | "spell" | "graveyard-card" | "hand-card";
    id: string; // cardInstanceId, playerId, or stackItem.id
    /** Owner of the zone the target lives in. Required for non-battlefield
     *  zone targets ("graveyard-card", "hand-card") since the same instance
     *  id is unique per zone but the zone owner is what disambiguates which
     *  graveyard/hand the card sits in. Unused for permanent / player /
     *  spell targets. */
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
export interface ModeOption {
    /** Stable id within the owning definition (e.g. "gain-life", "prevent").
     *  Used by the UI to identify the chosen option and by the engine to
     *  dispatch resolution. Must be unique within `modes`. */
    id: string;
    /** Short label shown in the mode picker UI (e.g. "Gain 3 life"). */
    label: string;
    /** Full oracle text for this mode (the bullet line — used by the stack
     *  item display and rule-trace logs). */
    oracleText: string;
}

export interface SpellMode extends ModeOption {
    /** Per-mode target requirement (CR 601.2c, only the chosen mode's
     *  targets need legal candidates per CR 700.2d). Undefined for modes
     *  with no targets. */
    targetRequirement?: TargetRequirement;
    /** CR 601.2c — additional INDEPENDENT target groups for this mode, the
     *  per-mode twin of `CardDefinition.additionalTargetRequirements`
     *  (Hull Breach's third mode: "Destroy target artifact AND target
     *  enchantment", issue #1953). Each entry is a separate group chosen
     *  after `targetRequirement`, in array order; the picks concatenate onto
     *  the stack item's flat `targets` list, so an Effect Script reads them
     *  positionally (`{ target: 0 }` = `targetRequirement`'s pick,
     *  `{ target: 1 }` = the first entry here).
     *
     *  Distinct from a single requirement with an array `type` and
     *  `count: 2`: that would let the player pick two artifacts, whereas two
     *  groups force exactly one of each. `announceCast` validates EVERY group
     *  has enough legal candidates before the cast is announced, so a mode
     *  whose second group is unfillable simply cannot be chosen (CR 700.2d). */
    additionalTargetRequirements?: TargetRequirement[];
    /** Resolution body. Receives the full SpellContext; targets come from
     *  the announcement-time selection driven by `targetRequirement`. Omit
     *  for modes whose only effect is continuous (via `staticEffects`).
     *  Mutually exclusive with `effects` (ADR 0045, issue #1280). */
    resolve?: (ctx: SpellContext) => void;
    /** Effect Script alternative to `resolve` (ADR 0045, issue #1280): an
     *  ordered Op list dispatched through the SAME `getAbilityEffectFn` /
     *  interpreter seam as `ActivatedAbility.effects` /
     *  `TriggeredAbility.effects` — one execution path for every effect
     *  site. Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Static effects that apply when this mode is chosen. For modal auras
     *  (e.g. Phantasmal Terrain — "choose a basic land type"), the engine
     *  reads the chosen mode's static effects instead of the card-level ones.
     *  Supports subtype-set, keyword-grant, etc. */
    staticEffects?: StaticEffect[];
    /** Set when this mode IS a choice of color (CR 105.1) — Prismatic Ward /
     *  Chromatic Armor's warded-colour pick, Sleight of Mind's color-word
     *  replacement. Drives the `ManaSymbol` icon in `ModeRow` (`mode-picker.tsx`)
     *  the same way `PendingChoice.options[].color` does for the `option-pick`
     *  picker — never set for a non-color mode (Healing Salve's two modes). */
    color?: Color;
}

/** One mode of a MODAL ABILITY — activated (CR 700.2a + CR 602.2b — Umezawa's
 *  Jitte's "Remove a charge counter from ~: Choose one — …") or TRIGGERED
 *  (CR 700.2b / 603.3c — Deceiver Exarch's "When this creature enters, choose
 *  one — …", issue #2461). The announcing player picks exactly one mode as the
 *  ability is announced, BEFORE targets are chosen (CR 700.2a — as part of
 *  activating; CR 700.2b — as part of putting the trigger on the stack), so
 *  only the CHOSEN mode's `targetRequirement` is declared and only its targets
 *  need legal candidates (CR 700.2c). The two flavors differ only in WHERE the
 *  announcement happens — a client-supplied argument on `activateAbility` for
 *  an activated ability, an engine-raised `kind: "trigger-mode"` PendingChoice
 *  for a trigger — never in what a mode IS, which is why one type serves both.
 *
 *  Deliberately the activated-ability twin of {@link SpellMode}, sharing its
 *  {@link ModeOption} display surface and riding the SAME `chosenModeId`
 *  plumbing the modal-spell path already uses (pendingTarget →
 *  pendingActivation → stack item, CR 700.2c). It carries no `staticEffects`:
 *  a mode of a one-shot activated ability has no continuous half (that is a
 *  modal PERMANENT's concern, CR 700.2c, which is what `SpellMode` covers).
 *
 *  NOT the DSL `optionChoice` Op: that one picks its mode DURING resolution,
 *  which is right for "choose one" written inside a resolving effect but wrong
 *  for a printed modal ability — a resolution-time pick has no response window
 *  and can't lock a target at announcement. */
export interface AbilityMode extends ModeOption {
    /** Per-mode target requirement (CR 601.2c / 700.2d). Undefined for a mode
     *  with no targets — its siblings' requirements do NOT apply to it. */
    targetRequirement?: TargetRequirement;
    /** Effect Script for this mode (ADR 0045) — the DSL-first default,
     *  dispatched through the same `getAbilityEffectFn` interpreter seam as
     *  `ActivatedAbility.effects`. Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Imperative alternative to `effects`, for a protocol-like mode only. */
    resolve?: (ctx: SpellContext) => void;
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
        /** How MANY permanents matching `sacrificeFilter` the cost gives up
         *  (CR 602.1 / 118.5 — Bolas's Citadel: "Sacrifice ten nonland
         *  permanents"). Omitted = 1, the historical single-permanent shape
         *  every earlier card uses. The activation is illegal unless the
         *  activator's battlefield holds at least this many matching
         *  permanents, and the picker owes exactly this many picks. Only
         *  meaningful alongside `sacrificeFilter`; the mana-value snapshot
         *  (`getAdditionalSacrificeMv()`) is taken only for a count of 1,
         *  since "the sacrificed permanent" is ambiguous above that. */
        sacrificeFilterCount?: number;
        /** "Tap untapped permanents matching <filter> you control" as an
         *  activation cost (CR 602.1, 118.8). The activating player chooses
         *  which untapped permanents to tap while paying the cost; the
         *  activation is illegal unless the candidate pool can cover the cost.
         *  Distinct from `tap` (which taps THIS source): the source is excluded
         *  from the candidate pool, so a card with both `tap: true` and
         *  `tapOtherFilter` taps itself PLUS the chosen others (Hand of Justice
         *  — "{T}, Tap three untapped white creatures you control: Destroy
         *  target creature"). The filter is evaluated with the activating
         *  player as the controller-relation reference, so
         *  `controllerRelation: "you"` resolves to the activator.
         *
         *  Two mutually-exclusive shapes (see `gre/tapOtherCost.ts`, the single
         *  authority for both predicates):
         *   - `count` — a FIXED cardinal: tap exactly N matching permanents
         *     (Hand of Justice's three; FEM's Vodalian War Machine's one).
         *   - `totalPower` — "tap ANY NUMBER … with total power N or greater"
         *     (CR 702.122a, Crew N). The pick set is unbounded in size and the
         *     cost is paid once the picks' summed EFFECTIVE power (plus each
         *     creature's `crewPowerBonus`, CR 702.122b) reaches N. */
        tapOtherFilter?: {
            filter: PermanentFilter;
            count?: number;
            totalPower?: number;
        };
        /** Life payment (CR 119.4). Legal while `player.life >= life`; SBA
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
        /** CR 702.29f — this activation cost IS a cycling cost ("Typecycling
         *  abilities are cycling abilities, and typecycling costs are cycling
         *  costs"). The declared, fail-closed discriminator that lets the
         *  discard choke point tell "this card was discarded to pay an
         *  activation cost of a cycling ability" (CR 702.29c) apart from every
         *  other discard, WITHOUT a second event (CR 702.29d — a "cycles or
         *  discards" ability must trigger exactly once on a cycled card).
         *
         *  Set ONLY by `cyclingActivationShell`
         *  (`cards/abilities/cycling.ts`), the single shell both
         *  `cyclingAbility` and `typecyclingAbility` build through — so
         *  702.29f holds structurally rather than by each factory remembering
         *  the flag. Never set by an author by hand, and deliberately NOT
         *  derived from the ability's id or oracle text: a string match would
         *  fail open the moment a variant is added.
         *
         *  Only meaningful together with `discardThis` (the cycling cost's
         *  discard leg). A `discardThis` cost WITHOUT it — Harvester of Misery
         *  (`sets/big/black.ts`) — is an ordinary discard cost, not a cycling
         *  cost, and must not fire a "when you cycle this card" trigger. */
        cyclingCost?: boolean;
        /** "Exile this card from your graveyard" as an activation cost
         *  (CR 118.3 / 702.129a — the Eternalize cost's non-mana component;
         *  CR 702.128a Embalm is the same shape). The SOURCE card itself moves
         *  graveyard → exile as the ability goes on the stack. Only meaningful
         *  together with `activateFromGraveyard: true` (the source lives in the
         *  graveyard); the graveyard-source gate in `activateAbility` is what
         *  makes the card findable, and this flag is what consumes it.
         *
         *  Deferred to COMMIT, never to announcement: a cancelled mana payment
         *  must leave the graveyard untouched (CR 601.2h — an illegal/aborted
         *  activation is rewound), so `PendingActivation.exileThisSource`
         *  carries the intent and `commitPendingActivation` performs the move.
         *
         *  Distinct from `discardThis` (hand → graveyard, Cycling),
         *  `exileFromGraveyard` (exile OTHER cards, chosen by the payer —
         *  Night Soil) and `sacrifice` (this permanent from the battlefield).
         *  The exiled source is still what the ability's script copies: an
         *  eternalize script's `createTokenCopy { ref: "$source" }` recovers it
         *  from exile, the same last-known-information shape `moveZone` uses
         *  (CR 608.2b). */
        exileThis?: boolean;
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
        /** Dynamic generic mana cost equal to the number of counters of `type`
         *  the SOURCE permanent has at activation time (CR 601.2f — Chromatic
         *  Armor: "{X}: Put a sleight counter on this Aura and choose a color. X
         *  is the number of sleight counters on this Aura."). Unlike a
         *  player-chosen `{X}` (`mana.X === "X"`), X is FIXED by board state, so
         *  the ability declares NO `mana.X` and never prompts for a value: the
         *  engine reads `card.counters[type]` at activation and folds that many
         *  generic pips onto any declared `mana`. Because the source counts its
         *  OWN counters BEFORE the effect adds one (CR 602.1 — costs are
         *  determined at announcement), each successive activation costs one
         *  more (1 counter → {1}, then {2}, …). */
        manaEqualToCounterCount?: { type: string };
    };
    /** Oracle text for this ability (displayed in context menus and on the stack). */
    oracleText: string;
    /** Target requirements declared at activation time (CR 602.2b). Chosen
     *  when the ability is activated, validated again on resolution. */
    targetRequirement?: TargetRequirement;
    /** Additional INDEPENDENT target groups beyond the primary
     *  `targetRequirement` (CR 601.2c via CR 602.2b — an ability may instruct
     *  the player to choose several targets of DISTINCT descriptions). The
     *  ability-level twin of `CardDefinition.additionalTargetRequirements`,
     *  with identical semantics and the same machinery behind it: each entry
     *  is a fully independent `TargetRequirement` chosen in order AFTER the
     *  primary one, and the resulting targets are appended to the stack item's
     *  flat `targets` list in declaration order, so an Effect Script
     *  references them positionally.
     *
     *  Oko, Thief of Crowns' "−5: Exchange control of target artifact or
     *  creature you control and target creature an opponent controls with
     *  power 3 or less" declares `targetRequirement: { type: ["Artifact",
     *  "Creature"], count: 1, controller: "you" }` +
     *  `additionalTargetRequirements: [{ type: "Creature", count: 1,
     *  controller: "opponent", powerFilter: { max: 3 } }]` — the two groups
     *  differ in `controller` AND `powerFilter`, not only in `type` as the
     *  shipped spell-side callers (Fumarole, Hull Breach) do. Legality for
     *  EVERY group is checked at ACTIVATION (CR 602.2b), which is where the
     *  power ≤ 3 restriction bites. Undefined for the common single-group
     *  case. Issue #2361. */
    additionalTargetRequirements?: TargetRequirement[];
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
    /** Rider on a TAP mana ability (CR 605.1a, CR 121.1, `useStack: false`):
     *  the controller draws N cards as part of the SAME mana ability
     *  resolving — Chromatic Sphere ("{1}, {T}, Sacrifice this artifact: Add
     *  one mana of any color. Draw a card.") and Chromatic Star's mana half
     *  are the precedent (CR 605.1a permits a mana ability to carry a non-mana
     *  additional effect and still resolve without the stack — the Wall of
     *  Roots shape). Unlike `dealsDamageToControllerOnTap` /
     *  `putDepletionCounterOnTap`, this rider fires EVEN when the ability
     *  sacrifices its own source (`cost.sacrifice === true`): the draw is a
     *  player-level effect, not conditioned on the permanent still existing —
     *  Chromatic Sphere's whole activation is sacrifice-for-mana-and-draw.
     *  Routed through `drawCard` (`convex/gre/state.ts`) + `emitCardDrawn` so
     *  "whenever you draw a card" triggers (Sheoldred, Underworld Dreams)
     *  still see it, exactly like every other draw path — run BEFORE the
     *  shared tap-mana-ability trigger flush (`processPendingActionTriggers`).
     *  Deliberately NOT modeled as a separate leaves-the-battlefield trigger
     *  (contrast Chromatic Star, `sets/tsp/colorless.ts`): Sphere's draw is
     *  tied only to activating ITS OWN mana ability, not to dying by any
     *  means — a removal spell must NOT draw a card for Sphere, so a Star-
     *  style trigger would be a silent rules deviation (issue #1093). Shared
     *  by both tap-for-mana paths (`tapUntap` priority tap +
     *  `tapSourceIntoPayment` payment tap). */
    drawsCardOnTap?: number;
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
    /** AI-only shadow Effect Script for a `resolve()`/`resolveSteps` activated
     *  ability (PRD #1423, issue #1431) — see `CardDefinition.aiEffects` for
     *  the full contract (never executed, valued by `OP_VALUERS` only). Not
     *  covered by the card-level catalogue guard in this ticket (scoped to
     *  spell-site `resolve()`, issue #1431) — provided so the same shadow-
     *  script mechanism is available at this site too. */
    aiEffects?: EffectOp[];
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
    /** CR 106.6 rider (issue #1559, Delighted Halfling — "…and that spell
     *  can't be countered") carried by the mana this ability produces,
     *  orthogonal to `manaRestriction`: it never changes which spells the
     *  mana may pay for, only that a spell actually paid for with it can't be
     *  countered (`StackItem.dynamicCantBeCountered`, stamped at cast-cost
     *  commit). Threaded onto the deposited `RestrictedMana` unit exactly
     *  like `manaRestriction` — meaningful only alongside it (or alongside
     *  `manaChoices`, for a choice ability), never alone. */
    manaCantBeCounteredRider?: true;
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
    /** DECLARATIVE board-derived colour set for a mana ability (CR 605.1a) —
     *  the data form of {@link getManaChoices} for the common case where the
     *  offered colours are simply "every colour some described set of
     *  permanents contributes", one mana of each:
     *
     *  - "…any color that a land an opponent controls could produce"
     *    (`{ filter: { types: "Land", controllerRelation: "opponents" },
     *       colors: "produces" }`)
     *  - "…any color that a basic land you control could produce"
     *    (`{ filter: { types: "Land", supertypes: "Basic",
     *       controllerRelation: "you" }, colors: "produces" }`)
     *  - "Choose a color of a permanent you control…"
     *    (`{ filter: { controllerRelation: "you" }, colors: "isColor" }`)
     *
     *  Evaluated by `boardDerivedManaChoices` (`gre/constants.ts`) at EVERY
     *  activation, through the one `getDynamicManaChoices` authority every
     *  consumer already reads — the castability probe, the auto-tap solver,
     *  the bot's payment planner, the three tap mutations and the client
     *  picker — so the offered set tracks the board as it changes and never
     *  desyncs between the index the client submits and the list the server
     *  validates.
     *
     *  Prefer this over `getManaChoices`: it is JSON-pure (ADR 0046), so it
     *  survives the wire and can be inspected by any consumer, where a closure
     *  is opaque. `getManaChoices` stays for genuinely COMPUTED lists that no
     *  filter can express (Vivi Ornitier's power-derived {U}/{R} split). When
     *  both are present the descriptor wins.
     *
     *  `manaChoices` remains the representative / fallback list for
     *  best-effort callers with no board snapshot, exactly as for
     *  `getManaChoices`. */
    manaColorSource?: BoardManaColorSource;
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
    /** "Activate only as a sorcery" (CR 602.3b via 307.5's timing template —
     *  the same restriction a sorcery's own casting follows: only while the
     *  activating player has priority, the stack is empty, and it's a main
     *  phase). Distinct from a LOYALTY ability's timing (`cost.loyalty`,
     *  `assertLoyaltyActivationLegal`), which additionally requires the
     *  activator to be the ACTIVE player — "activate only as a sorcery" alone
     *  does not (any player may do so on their own priority window as long as
     *  the timing template is met, e.g. during an opponent's main phase with
     *  an empty stack if some effect granted them priority there — CR 117.3c).
     *  Checked via the engine's existing `isSorceryTiming(state)` helper
     *  (`gre/phases.ts`) at the shared activation-legality chokepoint
     *  (`assertActivationTimingLegal`). First consumer: Dauthi Voidwalker's
     *  "{T}, Sacrifice this creature: ... Activate only as a sorcery." (MH2,
     *  issue #1156) — general enough for any future "activate only as a
     *  sorcery" activated ability, not loyalty-specific. */
    sorcerySpeedOnly?: boolean;
    /** Modes of a MODAL activated ability (CR 700.2 + 602.2b, issue #1341 —
     *  Umezawa's Jitte). When set, the activator locks exactly one mode in at
     *  announcement; the chosen mode's `targetRequirement` drives target
     *  selection (overriding the ability-level `targetRequirement` /
     *  `getTargetRequirement`) and its `effects`/`resolve` runs on resolution
     *  (the ability-level ones are ignored). Only "choose one" is supported,
     *  mirroring the modal-spell shape. */
    modes?: AbilityMode[];
    /** Dynamic target requirement computed at activation time from the source
     *  permanent's state. If set, overrides `targetRequirement`. Used by
     *  abilities whose target legality depends on the source (Stone Giant:
     *  "target creature you control with toughness less than Stone Giant's
     *  power"). Ignored for a modal ability — the chosen mode's own
     *  `targetRequirement` wins (CR 700.2d). */
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
    /** Keyword static abilities granted as part of becoming a creature
     *  (Earthbend N's "becomes a 0/0 creature with haste", issue #1317). Applied
     *  via the SAME no-duration channel as `SpellContext.grantStaticAbilityPermanent`
     *  (CR 611.2c) — idempotent, and NOT spliced back out when a temporary
     *  animation (`duration` set) reverts; only leaving the battlefield clears
     *  a permanent's granted abilities. No card in scope combines a temporary
     *  animation with a granted ability, so this asymmetry is unexercised but
     *  documented. */
    grantedAbilities?: string[];
    /** Phase boundary at which the animation reverts (CR 611.2, Mishra's
     *  Factory's "until end of turn"). OMITTED means the animation is
     *  INDEFINITE (CR 611.2b) — it never auto-reverts at a phase boundary and
     *  lasts for as long as the permanent stays this same object on the
     *  battlefield (Earthbend N: "becomes a 0/0 creature ... that's still a
     *  land", no duration clause in the reminder text). */
    duration?: DurationSpec;
}

// --- Permanent filter (shared by sweeper primitives) ---
//
// Defined in `./filters.ts` (single source of truth, ADR 0002). Re-exported
// here for back-compat with existing imports from `convex/cards/types`.

import type { PermanentFilter } from "./filters";
export type { PermanentFilter } from "./filters";

/** Where a mana ability's COLOUR options come from when they are derived from
 *  the board instead of printed on the card (CR 605.1a). See
 *  {@link ActivatedAbility.manaColorSource}.
 *
 *  Deliberately two orthogonal axes and nothing else — WHICH permanents
 *  contribute, and HOW each one yields a colour. Everything else (whose
 *  battlefield, land vs. basic land vs. any permanent) is already expressible
 *  as a {@link PermanentFilter}, so this adds no second selector vocabulary. */
export interface BoardManaColorSource {
    /** Selector over the contributing permanents, evaluated against EVERY
     *  player's battlefield. `controllerRelation` is what scopes it: `"you"`
     *  = the activating player's own permanents, `"opponents"` = every OTHER
     *  player's (CR 109.5); omitted = the whole board. Matched with the
     *  engine's single `matchesPermanentFilter` authority, against a
     *  layer-aware view (live colours, live supertypes), so a Blood-Moon'd or
     *  colour-shifted permanent contributes what it CURRENTLY is. */
    filter: PermanentFilter;
    /** How a matching permanent yields a colour:
     *  - `"produces"` — every colour it COULD produce if tapped (CR 106.4);
     *    colourless {C} is not a colour and never contributes (CR 202.2).
     *  - `"isColor"` — the permanent's OWN colours (CR 105.2 / 202.2, read
     *    post-layer-5 so a colour-changing effect is honoured). */
    colors: "produces" | "isColor";
}

// --- Cost legs (CR 117.3a / 118.4 / 118.9 / 702.24, ADR 0079) ---

/** The single authority on **what a cost is made of** (ADR 0079, issue #1933).
 *
 *  The repo used to carry two overlapping leg vocabularies — `AlternativeCost`
 *  (CR 118.9) and `MayPayCost` (CR 117.3a / 118.4) — and they had drifted in
 *  BOTH directions: the may-pay discard leg had no filter where the alt-cost
 *  hand leg did, and the alt cost had no summed-power threshold where the
 *  may-pay sacrifice leg did. Neither had a return-to-hand leg for a may-pay.
 *  `CostLegs` is the union of the two: every leg is written once, and both
 *  vocabularies are now defined in terms of it ({@link AlternativeCost} adds
 *  `id`/`description`/`condition`; {@link MayPayCost} is `CostLegs` plus the
 *  historical bare-`ManaCost` shorthand).
 *
 *  Legs are ORTHOGONAL and ALL-OR-NOTHING: every present leg is paid together,
 *  an absent leg costs nothing. The nesting is deliberate — `permanent` and
 *  `hand` group the fields that only make sense together, so an orphan `count`
 *  with no `filter`, or an `action` with neither, is unrepresentable. */
/** A WHOLESALE substitution of a spell's mana cost, applied automatically by
 *  the permission that supplied the cast rather than announced up front by the
 *  caster (CR 601.2b's alternative costs are the caster's CHOICE; this is not
 *  one — there is nothing to opt into, and no `AlternativeCost` is offered).
 *  That is why it is its own vocabulary and not an `AlternativeCost` leg:
 *  `CostLegs.life` is a FIXED number, while every member here is a payment
 *  DERIVED from the card being cast.
 *
 *  - `"life-equal-to-mana-value"` (CR 119.4 life payment / 202.3 mana value /
 *    107.3b, Bolas's Citadel) — the caster pays life equal to the cast card's
 *    mana value and pays no mana at all. Because the card is not on the stack
 *    when the amount is computed, an `{X}` in its mana cost counts as 0
 *    (CR 107.3b: the only legal choice for X is 0 when an effect lets a player
 *    cast a spell paying neither its mana cost nor an alternative cost with an
 *    X in it). Affordable only while the caster's life total is at least the
 *    amount (CR 119.4) — paying down to exactly 0 is legal; SBAs then apply. */
export type ManaCostReplacement = "life-equal-to-mana-value";

export interface CostLegs {
    /** MANA leg (CR 117.3a / 118.9). For a may-pay this is mana paid on top of
     *  nothing; for an alternative cost it is mana paid INSTEAD of the printed
     *  cost (Dash, CR 702.109a — a pure mana-for-mana swap). */
    mana?: ManaCost;
    /** PERMANENT leg (CR 701.21 sacrifice / 400.7 return): permanents matching
     *  `filter` that the payer controls leave the battlefield to pay the cost.
     *
     *   - `action: "sacrifice"` — moved to the owner's graveyard as a sacrifice
     *     (CR 701.21 sacrifice; shock lands, cumulative upkeep, Fireblast, Mine Collapse).
     *   - `action: "return"` — bounced to the owner's hand (CR 400.7 / 118.9;
     *     Gush / Thwart / Daze, and the may-pay "unless you return a land you
     *     control to its owner's hand" shape).
     *
     *  `count` selects between two payment shapes:
     *
     *   - **fixed cardinal** (`number`) — "give up N matching permanents". The
     *     payer picks exactly `count` (CR 701.21a); the historical shape.
     *   - **summed-power threshold** (`{ minTotalPower: N }`) — "sacrifice ANY
     *     NUMBER of matching permanents with total power ≥ N" (CR 118 / 701.21,
     *     Phyrexian Dreadnought). The payer picks a variable-size set whose
     *     summed EFFECTIVE power (layer pipeline, CR 613) meets or exceeds `N`;
     *     over-payment is legal, minimality is not required. Threshold mode is
     *     a may-pay-only shape today — no printed alternative cost uses it.
     *
     *  The threshold rides the COST leg (a punisher paid through `mayPay`)
     *  rather than a generic `choice`-Op rider deliberately: Phyrexian
     *  Dreadnought's "sacrifice unless you sacrifice …" is a
     *  cost-or-lose-the-permanent decision, which is exactly what the `mayPay`
     *  pipeline already models (accept → pay the whole union; decline → the
     *  `if !$paid` consequence sacrifices the source). A general "sacrifice
     *  things totalling power N" `choice` rider is deferred until a card needs
     *  it OUTSIDE a cost context (YAGNI).
     *
     *  WHICH permanents pay is ALWAYS the payer's choice, routed through the
     *  unified `convex/gre/sacrificeChoice.ts` layer. A `"return"` leg never
     *  auto-picks, not even with exactly one legal permanent — a forced pick is
     *  still information the player must see. */
    permanent?: {
        action: "return" | "sacrifice";
        filter: PermanentFilter;
        count: number | { minTotalPower: number };
    };
    /** LIFE leg (CR 119.4 — "Pay N life"). Snuff Out pays 4, Force of
     *  Will pays 1, a shock land pays 2. Affordable only when the payer's life
     *  total ≥ this amount (CR 119.4). Deterministic — no picker. */
    life?: number;
    /** HAND leg (CR 701.9 discard / 701.13 exile): cards the payer gives up
     *  FROM HAND — exiled (Force of Will / Force of Negation / Pyrokinesis /
     *  the MH2 evoke Incarnations) or discarded (Foil; the may-pay "you may
     *  discard a card" shape, issue #899, Formidable Speaker).
     *
     *  Each requirement is a distinct card filter × count and must be satisfied
     *  by DISTINCT cards (Foil: "an Island card and another card"). An EMPTY
     *  filter (`{}`) constrains nothing — the untyped "discard a card" shape.
     *  A cast card itself never pays for its own cost (it is on the stack, not
     *  in hand). WHICH cards pay is the payer's choice (parks for a picker when
     *  real, auto-resolves when forced).
     *
     *  **AUTHORING CONSTRAINT — declare the MOST RESTRICTIVE requirement
     *  FIRST.** Requirements are satisfied by a GREEDY pass in DECLARATION
     *  ORDER (`assignMayPayHandCards`, `gre/state.ts`; `canPayHandCost`,
     *  `gre/alternativeCost.ts`), not by a bipartite matching. With OVERLAPPING
     *  requirements a permissive-first ordering can spend the only qualifying
     *  card on the permissive leg and then report a FALSE unaffordable —
     *  `[{ filter: {} }, { filter: { type: "Land" } }]` against a hand of one
     *  land and one spell fails, while the same two requirements declared
     *  land-first succeed. Foil's shape works precisely because its Island
     *  requirement is declared first. The greedy is kept deliberately: it is
     *  the behaviour BOTH cost vocabularies have always had, and identical
     *  pricing across them is worth more here than the generality a matching
     *  rewrite would buy (no printed card needs it). */
    hand?: {
        action: "exile" | "discard";
        requirements: { filter: EffectCardFilter; count: number }[];
    };
    /** ENERGY leg (CR 122.1 — "pay {E}"). Fixed count only (a "pay {E}{E}{E}"
     *  declared cost, Guide of Souls, issue #1194) — unlike mana's symbol
     *  multiset this is a single scalar, so there is no further shape to
     *  generalize. Paid all-or-nothing alongside every other present leg via
     *  the existing `SpellContext.payEnergy` primitive (#697's Energy resource,
     *  `PlayerState.energyCounters`). No printed alternative cost uses it. */
    energy?: number;
}

// --- Additional-cost legs (CR 601.2b / 601.2f / 118.8) ---

/** ONE leg of a caster-chosen ADDITIONAL cost (`additionalCosts.oneOf`).
 *
 *  "As an additional cost to cast this spell, discard a card or pay 3 life"
 *  (Bitter Triumph, Bone Shards) is a DISJUNCTION the caster resolves at
 *  announcement — CR 601.2b: "the player announces their intentions to pay any
 *  or all of those costs". This is orthogonal to `alternativeCosts` /
 *  {@link CostLegs}, which model paying INSTEAD OF the mana cost (CR 118.9);
 *  every leg here is paid ALONGSIDE it (CR 601.2f).
 *
 *  A leg reuses the SAME field vocabulary as `additionalCosts` itself, so the
 *  chosen leg flattens onto the spec (`resolveAdditionalCosts`,
 *  `convex/gre/additionalCost.ts`) and every downstream cost site keeps reading
 *  one flat shape. Declare exactly the fields the leg pays; an empty leg is a
 *  free leg, and is rejected — with a duplicate or blank id, a blank label and
 *  a one-leg "disjunction" — by the catalogue guard in
 *  `convex/__tests__/additionalCostLegChoice.test.ts`. */
export interface AdditionalCostLeg {
    /** Stable id the caster names in `announceCast`'s `additionalCostLegId`.
     *  Unique within the card's `oneOf` — `resolveAdditionalCosts` resolves it
     *  with a `.find()`, so a duplicate would make the LATER leg unreachable
     *  and charge the earlier leg's cost for it. Guarded catalogue-wide (see
     *  {@link AdditionalCostLeg}). */
    id: string;
    /** Picker label, e.g. "Discard a card" / "Pay 3 life". */
    label: string;
    /** CR 701.9 — "discard a card" leg. See `additionalCosts.discard`. */
    discard?: { filter?: EffectCardFilter; count: number };
    /** CR 119.4 — "pay N life" leg. See `additionalCosts.payLife`. */
    payLife?: number;
    /** CR 701.21 — "sacrifice a <filter>" leg. See
     *  `additionalCosts.sacrificeFilter`. */
    sacrificeFilter?: PermanentFilter;
    /** CR 701.13 — "exile a <filter>" leg. See `additionalCosts.exileFilter`. */
    exileFilter?: PermanentFilter;
}

/** The whole `CardDefinition.additionalCosts` spec (CR 601.2f / 118.8), named
 *  so the cost helpers and the cast pipeline can pass it around — and so a
 *  FLATTENED spec (base fields + the caster's chosen {@link AdditionalCostLeg},
 *  `resolveAdditionalCosts`) has the same type as the declared one. */
export type AdditionalCostSpec = NonNullable<CardDefinition["additionalCosts"]>;

// --- May-pay cost union (CR 117.3a / 118.4 / 702.24) ---

/** The cost a `requestMayPay` decision offers to pay: the shared
 *  {@link CostLegs} vocabulary (ADR 0079), or a plain `ManaCost` — the
 *  historical mana-only shape, retained as a shorthand.
 *  `normalizeMayPayCost` widens the bare form to `{ mana }`, so every existing
 *  mana-only caller is unaffected (ADR 0042). */
export type MayPayCost = ManaCost | CostLegs;

/** A dynamically-derived `mayPay` mana cost (issue #1150, generalized #1958):
 *  "pay <a base cost> reduced by <a generic amount>" — where at least one of
 *  the two isn't knowable at authoring time. A SECOND shape accepted by the
 *  `mayPay` Op's `cost` field, alongside the static `MayPayCost` union
 *  (ADR 0045 "generalize, don't add" — the Op's cost model grows a leg rather
 *  than a new Op or a card-shaped primitive).
 *
 *  Both halves vary independently, which is exactly the two printed shapes:
 *
 *   - **dynamic base, fixed reduction** — `manaCostOf` + `reducedBy: 2`
 *     (Flash, MIR: "sacrifice it unless you pay its mana cost reduced by {2}");
 *   - **fixed base, dynamic reduction** — `mana: { X: 10 }` + `reducedBy:
 *     { domain: { of: "controller", times: 2 } }` (Draco, PLS: "sacrifice this
 *     creature unless you pay {10}. This cost is reduced by {2} for each basic
 *     land type among lands you control", issue #1958).
 *
 *  Resolved by the interpreter at `mayPay` execution time, never by
 *  `SpellContext.requestMayPay` itself: the base cost is read (from
 *  `manaCostOf`'s referenced object via `SpellContext.getManaCost`, or taken
 *  verbatim from the literal `mana`), `reducedBy` is resolved through the SAME
 *  `EffectValue` grammar every other numeric Op parameter uses, and the
 *  GENERIC portion is reduced by that amount and floored at {0} (CR 118.9 — a
 *  cost can't be reduced below {0}; colored pips are never removed by a
 *  generic reduction, mirroring `applyCostModifiers`'s existing
 *  `Math.max(0, generic - reduction)` clamp). The resulting concrete
 *  `ManaCost` is what actually reaches `requestMayPay`'s `mana` leg.
 *
 *  Exactly ONE base source must be present — enforced by
 *  `isDynamicMayPayManaCost` (`gre/effects/validate.ts`). */
export type DynamicMayPayManaCost = {
    /** Generic amount subtracted from the base cost. A plain `number` is the
     *  historical fixed shape (Flash's {2}); any other `EffectValue` is
     *  resolved at execution time — Draco's `{ domain: { of: "controller",
     *  times: 2 } }` is "{2} for each basic land type among lands you
     *  control", reusing the existing Domain value member rather than
     *  recomputing Domain in the cost path. */
    reducedBy: EffectValue;
} & (
    | {
          /** The object whose printed mana cost is the base: a bare PICKS ref
           *  (the instance id an earlier `choice` Op selected, e.g.
           *  `{ ref: "$picked" }` — Flash's "you may put a creature card from
           *  your hand onto the battlefield... pay ITS mana cost"). Same
           *  position/family as `moveZone`'s `cards` field; the ordered ref
           *  pass enforces it. */
          manaCostOf: EffectRef;
          mana?: never;
      }
    | {
          /** A LITERAL base cost, for the "pay {N}, reduced by …" shape whose
           *  base is printed on the card and whose reduction is what varies
           *  (Draco's {10}). */
          mana: ManaCost;
          manaCostOf?: never;
      }
);

/** A dynamically-derived `mayPay` ENERGY cost (issue #1195): "pay {E} equal
 *  to <some runtime amount>" — Satya, Aetherflux Genius's "sacrifice unless
 *  you pay {E} equal to its mana value", where "it" is the token copy just
 *  created, not knowable at authoring time. A THIRD shape accepted by the
 *  `mayPay` Op's `cost` field, alongside the static `MayPayCost` union and
 *  the dynamic-mana `DynamicMayPayManaCost` (ADR 0045 "generalize, don't
 *  add" — the Op's cost model grows a leg, not a new Op or primitive).
 *  Unlike `DynamicMayPayManaCost` (a bespoke `manaCostOf` + `reducedBy`
 *  reader), `energyEqualTo` reuses the EXISTING `EffectValue` grammar
 *  wholesale — no new value kind: in practice always `{ manaValue: { of:
 *  <ref> } }`, but any `EffectValue` composes (a `ref`'s power, a `counters`
 *  count, …) with zero additional plumbing, since the interpreter resolves
 *  it through the SAME `resolveValue` every other numeric Op parameter uses.
 *  Resolved HERE, at `mayPay` Op execution time, never by
 *  `SpellContext.requestMayPay` itself, which only ever sees the fully-
 *  resolved `energy: number` leg of the static `MayPayCost`. An unresolvable
 *  value (the referenced object left the battlefield, CR 608.2b) skips the
 *  whole `mayPay` Op, mirroring `DynamicMayPayManaCost`'s own skip. */
export interface DynamicMayPayEnergyCost {
    energyEqualTo: EffectValue;
}

// --- Transform / double-faced permanents (CR 712, issue #1210, ADR 0067) ---

/** Which face's URL segment `src/lib/images.ts` requests from Scryfall's
 *  per-face CDN routing (`https://cards.scryfall.io/<variant>/<face>/...`) —
 *  `"front"` (the default for every non-transformed card) or `"back"`. Only
 *  meaningful paired with a `CardDefinition.imagePrintId`: a REAL double-faced
 *  Scryfall print exposes ONE scryfall id shared by two `card_faces`, each
 *  served under its own `front/`/`back/` path (issue #1595). Set to `"back"`
 *  only on the synthesized `CardDefinition` `registerBackFaceDefinition`
 *  (`gre/transform.ts`) builds for a transformed permanent's back face — never
 *  authored directly on a card/token spec. */
export type CardImageFace = "front" | "back";

/** The BACK face of a double-faced permanent (CR 712) — a printed
 *  characteristic set entirely distinct from the front, unlike face-down
 *  morph (CR 707.4, `CardInstanceState.faceDown`), which hides a single REAL
 *  identity behind a generic 2/2. Declared on `CardDefinition.backFace` (a
 *  printed DFC) or `TokenSpec.backFace` (a double-faced token, e.g. the
 *  Incubator — CR 701.53 Incubate creates a front-face artifact token whose
 *  own "{2}: Transform this artifact" ability flips it to this back face).
 *  Consulted by `transformPermanent` (`gre/transform.ts`), which registers a
 *  synthesized `CardDefinition` from this spec exactly like a token's own
 *  front-face synthesis (`registerTokenDefinition`) — so every existing
 *  def-derived reader (layers, combat, activated-ability discovery) sees the
 *  new face automatically once the instance's `card.card.id` is swapped.
 *  Transform is always PUBLIC information (CR 712.6) — no per-viewer
 *  hiding, unlike `faceDown`. Scoped to what CR 712 needs for a permanent
 *  ALREADY on the battlefield to transform in place; a full two-sided-card
 *  CASTING model (choosing a face to cast, a distinct mana cost per face,
 *  CR 711) is out of scope. */
export interface CardBackFace {
    /** Display name of the back face. */
    name: string;
    /** Card types the back face presents (CR 712.2). */
    types: CardType[];
    /** Optional creature subtypes of the back face. */
    subtypes?: string[];
    /** Optional supertypes of the back face. */
    supertypes?: CardSupertype[];
    /** Power for a creature back face. */
    power?: number;
    /** Toughness for a creature back face. */
    toughness?: number;
    /** CR 306.5b (issue #2380) — starting loyalty for a PLANESWALKER back face
     *  (Jace, Vryn's Prodigy // Jace, Telepath Unbound and the rest of the ORI
     *  flip-walker cycle). The back-face twin of {@link CardDefinition.loyalty}:
     *  the synthesized back-face `CardDefinition`
     *  (`registerBackFaceDefinition`, `gre/transform.ts`) carries it through to
     *  the SAME CR 306.5b entry placement every printed planeswalker uses, so a
     *  permanent that ENTERS the battlefield already showing this face enters
     *  with the right loyalty counters instead of 0 (and dying instantly to the
     *  CR 704.5i SBA). Folded into the content-derived definition id
     *  (`tokenDefinitionId`) so a client-side decode rebuilds it too. */
    loyalty?: number;
    /** Colors of the back face (CR 712.2 — a back face's color is fixed by
     *  its own printed characteristics, independent of the front). */
    colors?: Color[];
    /** Static (keyword) abilities the back face has. */
    staticAbilities?: string[];
    /** Continuous static effects the back face has (CR 611), named by
     *  {@link TokenStaticEffectKey}. Keys rather than closures for the same
     *  reason as `TokenSpec.staticEffectKeys`: a back face is registered through
     *  the SAME content-derived-id codec (`backFaceAsTokenSpec` →
     *  `tokenDefinitionId`), so anything that can't be encoded in the id is lost
     *  the first time a decoder rebuilds the definition. */
    staticEffectKeys?: TokenStaticEffectKey[];
    /** Activated abilities the back face has (e.g. a transform-back ability
     *  on a card that flips both directions). */
    activatedAbilities?: ActivatedAbility[];
    /** Printed Oracle text of the back face (display/reference only). */
    oracleText?: string;
    /** Optional Scryfall id for the back face's own art. */
    imagePrintId?: string;
}

/** JSON-pure subset of {@link CardBackFace} for the `createToken` Effect
 *  Script Op's `EffectTokenSpec.backFace` (ADR 0045/0046) — every field a
 *  double-faced TOKEN's back needs, minus `activatedAbilities`/
 *  `staticEffects` (closures aren't JSON-expressible; a token whose back
 *  face needs either stays a `resolve()` card). Structurally a subtype of
 *  `CardBackFace`, so the interpreter passes it straight through to
 *  `SpellContext.createToken` with no conversion. */
export interface EffectCardBackFace {
    name: string;
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    colors?: Color[];
    staticAbilities?: string[];
    oracleText?: string;
    imagePrintId?: string;
}

// --- Token specification (CR 111, 707.1) ---

/** Stable key naming one continuous static effect a token (or a synthesized
 *  back face) can carry, CR 611. The union is the AUTHORITY: the factory table
 *  in `cards/tokenStaticEffects.ts` is typed `Record<TokenStaticEffectKey, …>`,
 *  so adding a member here without a factory (or a factory without a member) is
 *  a compile error.
 *
 *  Why a key and not the `StaticEffect` itself: a token's whole identity is the
 *  content-derived string `tokenDefinitionId` builds, and `maybeSynthesizeToken`
 *  decodes that string back into a definition on every registry miss (cold
 *  isolate, client-side engine run). A `StaticEffect` is a pair of closures and
 *  cannot ride a string — a key can, and both sides rebuild through the same
 *  factory. See `cards/tokenStaticEffects.ts` for the full rationale and the
 *  bug this shape closes (Urza's Saga's Construct decoding as a bare 0/0 and
 *  dying to the CR 704.5f SBA). */
export type TokenStaticEffectKey =
    | "cant-be-enchanted-self"
    | "pt-cda-artifacts-you-control";

/** Characteristics a card takes on in every zone OTHER than the battlefield
 *  (CR 113.6c — "an ability that states which zones it doesn't function in
 *  functions everywhere except for the specified zones, even outside the game
 *  and before the game begins"). Declared by
 *  {@link CardDefinition.offBattlefieldCharacteristics}; read through the
 *  single shared accessor in `gre/zoneCharacteristics.ts`.
 *
 *  Types and subtypes are ADDITIVE — the oracle template is "it's a 1/1 Insect
 *  creature IN ADDITION TO its other types" (CR 205.1b) — while power and
 *  toughness REPLACE, since the cards carrying this ability are non-creature
 *  cards with no printed P/T to add to. */
export interface OffBattlefieldCharacteristics {
    /** Card types added on top of the printed ones (CR 205.1b). */
    addTypes?: CardType[];
    /** Subtypes added on top of the printed ones (CR 205.3). */
    addSubtypes?: string[];
    /** Power the card has outside the battlefield (CR 208.2). */
    power?: number;
    /** Toughness the card has outside the battlefield (CR 208.2). */
    toughness?: number;
}

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
    /** CR 306.5b (issue #2380) — starting loyalty for a PLANESWALKER spec. Not
     *  authored on an ordinary `createToken` spec today (no card in the pool
     *  creates a planeswalker token); it exists because `backFaceAsTokenSpec`
     *  (`gre/transform.ts`) reshapes every {@link CardBackFace} through this
     *  type, and a planeswalker BACK face (the ORI flip-walker cycle) must
     *  carry its starting loyalty into the synthesized `CardDefinition` and
     *  into the content-derived id `maybeSynthesizeToken` decodes.
     *
     *  SCOPE — the `createToken` path does NOT honour it. CR 306.5b loyalty
     *  PLACEMENT lives on the two battlefield-entry funnels a token never uses
     *  (`stageReanimatedOnBattlefield` and `finalizeSpellResolution`,
     *  `gre/state.ts`); `createTokenPermanents` places no loyalty counters, so
     *  a planeswalker token authored through this field today would enter at 0
     *  loyalty and die to the CR 704.5i SBA. Shipping one means teaching
     *  `createTokenPermanents` the same placement first — this field is a
     *  back-face carrier until then. */
    loyalty?: number;
    /** Colors of the token (CR 110.5 — colorless if omitted, else the listed
     *  set). Encoded as a synthetic mana cost so `hasColor` and projection
     *  read tokens identically to printed permanents. */
    colors?: Color[];
    /** Static abilities the token enters with (e.g. `["flying"]`). */
    staticAbilities?: string[];
    /** Continuous static effects the token enters with (CR 611), named by
     *  {@link TokenStaticEffectKey} — Tetravite's "This token can't be
     *  enchanted", Urza's Saga's Construct "+1/+1 for each artifact you
     *  control". Resolved to real `StaticEffect`s through
     *  `resolveTokenStaticEffects` (`cards/tokenStaticEffects.ts`) and
     *  registered onto the synthesized token CardDefinition, so battlefield-wide
     *  readers that key off the card def (the layer system, `isGuardedAgainst`)
     *  observe them.
     *
     *  KEYS, not the effects themselves, because the keys are what survive the
     *  round trip: they are folded into the token's content-derived definition
     *  id (`tokenDefinitionId`) and rebuilt from it by `maybeSynthesizeToken` on
     *  any registry miss. Closures cannot ride that string; before this field
     *  existed the decoder rebuilt from a hand-maintained kind list and silently
     *  dropped every effect not on it. */
    staticEffectKeys?: TokenStaticEffectKey[];
    /** Optional Scryfall id of a printed token card. Used by the image layer
     *  to fetch real token art (e.g. The Hive's Wasp print from 10E:
     *  `09921372-126f-4c81-b6d8-ea50b1d0eb44`). When omitted, the renderer
     *  falls back to an in-app placeholder showing the name / abilities / P/T. */
    imagePrintId?: string;
    /** Activated abilities the token enters with (CR 707.2, issue #1191 —
     *  Investigate's Clue: "{2}, Sacrifice this token: Draw a card."). Folded
     *  onto the synthesized token `CardDefinition` exactly like a printed
     *  card's `activatedAbilities[]`, so every existing activation code path
     *  (`activateAbility`, `getStackAbilities`, wire projection) works
     *  unchanged — ability lookup always goes through `card.card.id` →
     *  the registry, never a denormalized copy on `CardInstanceState`. Folded
     *  into the token's content-derived definition id (`tokenDefinitionId`) so
     *  a token WITH an activated ability gets a distinct def from one without,
     *  and decoded back client-side by `maybeSynthesizeToken` (issue #778 /
     *  #1191 — the gap that blocked Magda's Treasures / Voldaren Epicure's
     *  Blood token / Sunfall's Incubate). */
    activatedAbilities?: ActivatedAbility[];
    /** Triggered abilities the token enters with (CR 707.2, issue #2364 —
     *  a token's OWN printed triggered ability, independent of its creating
     *  source: Pest Infestation's "When this token dies, you gain 1 life.",
     *  Vaultborn Tyrant's death-created copy retaining its own ETB/dies
     *  triggers). Full closure-bearing `TriggeredAbility[]` — the SAME shape
     *  `CardDefinition.triggeredAbilities` and `EmblemDefinition.
     *  triggeredAbilities` use, for `resolve()` callers that build the ability
     *  via the ordinary trigger factories (`enteredTrigger`, `diedTrigger`,
     *  …) or reuse a printed card's own ability objects verbatim (CR 707.2 —
     *  a copy carries the same abilities the original had). Folded onto the
     *  synthesized token `CardDefinition` exactly like `activatedAbilities`
     *  above, so `effectiveTriggeredAbilities` (`gre/copy.ts`) picks it up
     *  through the ordinary `presented?.triggeredAbilities` read — no change
     *  needed at the trigger-scan site.
     *
     *  Content-hashed into `tokenDefinitionId` by `id`/`oracleText`/`event`
     *  ALWAYS, PLUS `effects` whenever the ability object happens to carry
     *  one — `TriggeredAbility.matches` is a REQUIRED closure that can never
     *  survive a JSON round trip, but `effects` (set when the ability was
     *  built via `enteredTrigger`/`diedTrigger`'s `effects:` param rather
     *  than `resolve:`) is plain data and rides the id string fine. A
     *  RESOLVE()-built ability (`resolve:`, no `effects` field at all — the
     *  common case for this closure-bearing surface, e.g. a card that reuses
     *  a printed card's own ability objects verbatim) has nothing JSON-safe
     *  to encode beyond identity, so `maybeSynthesizeToken` decodes a
     *  registry MISS for THAT ability into a SAFE, NEVER-FIRING stub
     *  (`matches: () => false`) rather than crashing on a missing `matches`
     *  — a deliberate, narrower version of the "silently drops the ability"
     *  gap `staticEffectKeys`' doc comment describes: the ability's IDENTITY
     *  (id/oracleText/event) survives decode for display, its FUNCTION only
     *  survives while the definition stays in the registry that created it
     *  (the common/live-game case, since `createTokenPermanents` registers
     *  the real closures in the SAME call that creates the token). An
     *  `effects:`-built ability on THIS surface gets the same full-fidelity
     *  cold-decode rebuild `EffectTokenSpec.triggeredAbilities` documents —
     *  the codec doesn't care which surface an ability originated from, only
     *  whether it carries `effects`. */
    triggeredAbilities?: TriggeredAbility[];
    /** Counters this token enters the battlefield WITH (CR 111.9/122.1 —
     *  "create an Incubator token ... with N +1/+1 counters on it", CR
     *  701.53 Incubate; issue #1210/#924). SAME name/shape as
     *  `CardDefinition.entersWith.counters` (reused rather than invented,
     *  "generalize don't add") minus the `"X"`/`"kicker"` dynamic-count
     *  sentinels — a `resolve()` card computes any dynamic amount itself
     *  before building the spec. The JSON-pure DSL counterpart is
     *  `EffectTokenSpec.entersWith`, whose `count` accepts a full
     *  `EffectValue` resolved by the `createToken` Op executor. Stamped onto
     *  each created copy's `CardInstanceState.counters` before the CR 614
     *  ETB chokepoint runs, mirroring `finalizeSpellResolution`'s own
     *  `entersWith.counters` application for a non-token permanent. */
    entersWith?: {
        counters?: { type: string; count: number }[];
        /** CR 614.1c / 614.12a (ADR 0100 D3) — as-enters choices this token's
         *  controller answers before it enters. Registered onto the token's
         *  synthesized `CardDefinition` too (CR 707.2 — a copy of this token
         *  copies the clause), so the CR 614 chokepoint reads it the same way
         *  it reads a printed card's. */
        asEnters?: AsEntersChoice[];
    };
    /** This token's BACK face (CR 712, issue #1210/#924 — the Incubator's
     *  "{2}: Transform this artifact" flips it to a Construct creature
     *  token). See {@link CardBackFace} for the full contract. Undefined for
     *  the overwhelming majority of (single-faced) tokens. */
    backFace?: CardBackFace;
    /** Which face THIS spec's own `imagePrintId` renders (issue #1595). Only
     *  set by `backFaceAsTokenSpec` (`gre/transform.ts`) when reshaping a
     *  `CardBackFace` into a `TokenSpec` for `registerBackFaceDefinition` —
     *  never authored directly on an ordinary `createToken` spec. Folded into
     *  the content-derived id by `tokenDefinitionId` (a trailing segment) so
     *  a CLIENT that never ran the server-side registration call — the
     *  overwhelming common case, since `transformPermanent` runs
     *  server-side only — still decodes `"back"` from the wire `card.card.id`
     *  string alone via `maybeSynthesizeToken`, with no registry round-trip
     *  needed. See {@link CardDefinition.imagePrintFace}. */
    imagePrintFace?: CardImageFace;
    /** CR 508.4 (issue #1195) — the token enters the battlefield ALREADY
     *  TAPPED, independent of `entersAttacking` (Satya, Aetherflux Genius's
     *  "create a TAPPED and attacking token…" taps the token unconditionally,
     *  even if the copied creature has vigilance — CR 508.4 attacking-token
     *  entry bypasses the normal tap-to-attack rule (CR 508.1f) entirely, so
     *  "tapped" is its own explicit adjective, not a consequence of
     *  "attacking"). Applied in `createTokenPermanents` alongside (OR'd with)
     *  the existing `shouldEnterTapped` Kismet-style replacement check.
     *  Orthogonal to `entersAttacking` — a token could need one without the
     *  other, though every current caller sets both together. */
    entersTapped?: boolean;
    /** CR 508.4 — the token enters the battlefield ALREADY ATTACKING, joining
     *  the CURRENT combat directly through the shared `markAttacking` helper
     *  (`gre/combat.ts`) rather than through the normal declare-attackers
     *  action. `markAttacking` sets BOTH engine-wide representations of
     *  "attacking" together — `state.combat.attackerIds` membership AND the
     *  per-permanent `CardInstanceState.isAttacking` flag — which is what
     *  makes the token a real "attacking creature" for every OTHER
     *  combat-scoped read (Assault-Formation-style statics,
     *  `combatRoleFilter` targeting, `PermanentFilter.isAttacking`,
     *  `SpellContext.getIsAttacking`, and the frontend's blocker-assignment
     *  affordance) — setting `attackerIds` alone is NOT enough, and earlier
     *  code here that did exactly that (issue #1195 review) left the token
     *  only half-attacking. Per CR 508.4: the token's controller is NOT
     *  offered a planeswalker/battle attack target choice here — a tracked
     *  DIVERGENCE (tracked-by: #1865, see `cards/sets/m3c/multicolor.ts`'s
     *  Satya doc for the full rationale: this is a real gap against the
     *  current pool, not a hypothetical future card, since planeswalkers
     *  already ship widely and the engine already models attacking them) —
     *  every current caller's oracle text is silent on the point and the
     *  engine defaults to "attacks the defending player", CR 508.4's own
     *  default absent an effect-specified target; it is NOT subject to
     *  attack-declaration requirements/
     *  restrictions (CR 508.4c — bypassed by construction, since this never
     *  runs the normal declare-attackers legality path); and it does NOT
     *  retroactively fire "whenever a creature attacks" triggers (CR 508.4 —
     *  "attacking" but never "attacked" for trigger purposes) because no
     *  ATTACKERS_DECLARED event is emitted for this entry. No-op if there is
     *  no active combat to join (defensive — every shipped caller only sets
     *  this from an attack-triggered ability's effect, where combat is
     *  guaranteed live) or if the token ended up somewhere other than the
     *  battlefield (a CR 614 enters-as-exiled replacement). If combat has
     *  already moved past the declare-blockers step when this runs, the token
     *  is simply never added to `blockedAttackerIds`, so it deals its combat
     *  damage unblocked exactly as CR 508.4 requires for a token entering
     *  attacking after blockers are locked in — no extra bookkeeping needed. */
    entersAttacking?: boolean;
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
    /** Activated abilities the token enters with (CR 707.2, issue #1191 —
     *  Investigate's Clue: "{2}, Sacrifice this token: Draw a card."; extended
     *  #778 for Blood's "{1}, {T}, Discard a card, Sacrifice this token: Draw
     *  a card."; extended #2423 for a runtime colour-choice mana ability, the
     *  Treasure shape). A RESTRICTED, JSON-pure subset of `ActivatedAbility`:
     *  only `id`, `cost` (`tap` / `mana` / `sacrifice` / `discardFilter` — the
     *  JSON-pure cost legs; no closures), `oracleText`, `useStack`, `effects`
     *  (an Effect Script, DSL-only — `resolve`/`effect` are rejected) and
     *  `manaChoices` (a plain `ManaCost[]`, mirroring the card-level
     *  `ActivatedAbility.manaChoices` above — "{T}, Sacrifice this artifact:
     *  Add one mana of any color.") and `manaProduced` (its FIXED-output
     *  sibling, a plain `ManaCost` — issue #2021, the Eldrazi Spawn token's
     *  "Sacrifice this token: Add {C}."; the DESCRIPTOR is what every mana
     *  authority reads, never the `effects` body, which a fixed-output mana
     *  ability does not execute) are accepted, enforced by
     *  `isTokenActivatedAbility` in `gre/effects/validate.ts`. Each ability's
     *  `effects[]` is validated and ref-checked as its OWN independently-scoped
     *  script (fresh `$source` = the token itself once created — see
     *  `validateEffectOpList`'s nested-`createToken` pass), never against the
     *  outer script's bindings. Structurally compatible with
     *  `ActivatedAbility[]`, so the interpreter passes `token` straight to
     *  `SpellContext.createToken` with no conversion (ADR 0045, ADR 0046) —
     *  including `manaChoices`, which the engine's mana-tap-choice machinery
     *  (`hasManaAbility`/`getActivatedManaAbility`, `gre/constants.ts`; the
     *  commit path in `game.ts`) reads generically off whatever
     *  `ActivatedAbility` it finds on the permanent's synthesized
     *  `CardDefinition`, with no card-vs-token distinction. */
    activatedAbilities?: ActivatedAbility[];
    /** Triggered abilities the token enters with (CR 707.2, issue #2364 — the
     *  Pest template: "When this token dies, you gain 1 life."). A RESTRICTED,
     *  JSON-pure descriptor — {@link TokenTriggeredAbility} — NOT
     *  `TriggeredAbility[]` itself: `TriggeredAbility.matches` is a REQUIRED
     *  closure (unlike `ActivatedAbility`'s optional `effect`/`resolve`), so no
     *  JSON-pure literal can satisfy that type at all. Each descriptor is
     *  synthesized into a real, self-scoped `TriggeredAbility` by
     *  `resolveTokenTriggeredAbilities` (`cards/tokenTriggeredAbilities.ts`) —
     *  the SAME factory both the `createToken` Op executor (registration) and
     *  a cold-decode rebuild would call, mirroring `tokenStaticEffects.ts`'s
     *  "one table for encode and decode" pattern. Restricted to a token's OWN
     *  ability, always CR 109.2 self-scoped (this restricted surface has no
     *  `scope`/`filter` field — a token trigger needing "yours"/"any" scope
     *  stays a `resolve()` card via `TokenSpec.triggeredAbilities`). Enforced
     *  by `isEffectTokenSpec`/`isTokenTriggeredAbility` in
     *  `gre/effects/validate.ts`; each ability's `effects[]` is validated as
     *  its own independently-scoped script with a fresh `$source` = the token
     *  (`validateEffectOpList`'s nested-`createToken` pass). */
    triggeredAbilities?: TokenTriggeredAbility[];
    /** Counters this token enters the battlefield WITH (CR 111.9/122.1,
     *  issue #1210/#924 — Incubate N: "create an Incubator token ... with N
     *  +1/+1 counters on it", N possibly dynamic — "the number of creatures
     *  exiled this way"). SAME name/shape as `TokenSpec.entersWith` (JSON-pure
     *  DSL counterpart) except `count` is a full `EffectValue` — a literal, a
     *  bound ref, or a `count` construct — resolved by the
     *  `createToken` Op executor into a plain number before the spec reaches
     *  `SpellContext.createToken`. A counter whose count doesn't resolve
     *  (uncaptured binding) or resolves to ≤0 is dropped (CR 122's "put N
     *  counters" with N ≤ 0 is a no-op). */
    entersWith?: {
        counters?: { type: string; count: EffectValue }[];
        /** CR 614.1c / 614.12a (ADR 0100 D3) — as-enters choices the created
         *  token owes before it enters. Pure data (no `EffectValue`), forwarded
         *  verbatim onto the `TokenSpec` the executor builds. */
        asEnters?: AsEntersChoice[];
    };
    /** This token's BACK face (CR 712, issue #1210/#924). JSON-pure subset —
     *  see {@link EffectCardBackFace}. Undefined for the overwhelming
     *  majority of (single-faced) tokens. */
    backFace?: EffectCardBackFace;
    /** CR 508.4 (issue #1195) — see {@link TokenSpec.entersTapped}. Passed
     *  verbatim to `SpellContext.createToken`. */
    entersTapped?: boolean;
    /** CR 508.4 (issue #1195) — see {@link TokenSpec.entersAttacking}. Passed
     *  verbatim to `SpellContext.createToken`. */
    entersAttacking?: boolean;
}

/** Event kinds a {@link TokenTriggeredAbility} descriptor can name — the
 *  ENCODE/DECODE dispatch key `resolveTokenTriggeredAbilities`
 *  (`cards/tokenTriggeredAbilities.ts`) maps to a real trigger factory
 *  (`enteredTrigger` / `diedTrigger` / `attacksTrigger`). Deliberately a
 *  small, curated set (not the full `GameEventType` union) — extend only when
 *  a card actually needs a new self-scoped token trigger kind, mirroring how a
 *  new Effect Op earns its place (ADR 0045), not upfront.
 *
 *  `ATTACKERS_DECLARED` (issue #2399) was earned by Fable of the Mirror-
 *  Breaker's chapter-I token — "Whenever this token attacks, create a Treasure
 *  token" — the first card in the catalogue needing a token to carry its own
 *  attack trigger. Note CR 508.4: a token that ENTERS attacking is attacking
 *  but was never declared, so no `ATTACKERS_DECLARED` is emitted for it and a
 *  self-scoped attack trigger correctly does not fire (`finishTokenEntry`,
 *  `gre/state.ts`). */
export type TokenTriggeredEventKind =
    | "PERMANENT_ENTERED"
    | "CREATURE_DIED"
    | "ATTACKERS_DECLARED";

/** JSON-pure, restricted triggered-ability descriptor for
 *  `EffectTokenSpec.triggeredAbilities` (issue #2364). Always CR 109.2
 *  SELF-scoped (the token's own printed ability) — the only semantics
 *  `resolveTokenTriggeredAbilities` can synthesize with full fidelity on
 *  BOTH registration AND a cold-registry-miss decode: `id`/`oracleText`/
 *  `event`/`effects` are ALL JSON-pure (this interface has no `matches`/
 *  `resolve` field to lose), so `tokenDefinitionId` (`cards/registry.ts`)
 *  encodes all four into the token's content-derived id, and
 *  `maybeSynthesizeToken`'s decode calls the SAME `resolveTokenTriggered-
 *  Abilities` factory the live registration path uses whenever it finds an
 *  `effects` segment — registration and a cold decode literally cannot
 *  disagree, because both run the same rebuild. (`TokenSpec.
 *  triggeredAbilities` — the closure-bearing `resolve()` surface — has no
 *  such guarantee: `matches`/`resolve` are real closures with nothing
 *  JSON-safe to encode, so THAT surface still degrades to a non-firing stub
 *  on a cold decode; see its own doc comment.) A token trigger needing a
 *  wider scope, a structural `filter`, or a `resolve()` body stays a
 *  `TokenSpec.triggeredAbilities` entry. No `resolve`/`effect` field at all
 *  here — DSL-only by construction, mirroring `EffectTokenSpec.
 *  activatedAbilities`'s restriction. */
export interface TokenTriggeredAbility {
    /** Stable id, unique within the token's ability set. */
    id: string;
    /** Oracle text shown on the stack / in the inspector. Survives a
     *  cold-decode even when `matches` can't (see `TokenSpec.
     *  triggeredAbilities`'s doc comment) — kept for display fidelity. */
    oracleText: string;
    /** Which event fires this ability — dispatches to the matching factory. */
    event: TokenTriggeredEventKind;
    /** Effect Script (ADR 0045) — the ability's resolution body. Required:
     *  this restricted surface has no `resolve()` escape hatch, so an
     *  ability with nothing to run is not expressible. */
    effects: EffectOp[];
}

// --- As-enters choices (CR 614.1c / 614.12, ADR 0100) ---

/** ADR 0100 D3 — one "as [this] enters the battlefield …" choice, declared as
 *  DATA beside `entersWith.counters` rather than as an Effect Script.
 *
 *  CR 614.1c makes every "As [this] enters …" / "[This] enters as …" clause a
 *  replacement effect, and CR 614.12a requires the choice to be made BEFORE the
 *  permanent enters. A replacement is a DECLARATION, not an effect that
 *  resolves — the same reason `entersWith.counters` is data — and the Effect
 *  Script interpreter has no coherent `$self` for a permanent that is in no
 *  zone while it answers. No `EffectOp` is added for this family.
 *
 *  Every answer is a write to a typed field that already exists; the applier
 *  (`applyAsEntersAnswer`, `convex/gre/state.ts`) is exhaustive over this union
 *  via `assertNever`, so a `kind` cannot be added without a writer.
 *
 *  SLICE 1 (#2492) declared the whole union and wired NO card to it. The
 *  catalogue-wide guard `convex/cards/__tests__/asEntersUnion.test.ts` still
 *  asserts that leg by leg, narrowed to the legs still unwired: `discard` is
 *  wired (Mox Diamond, #2389), the rest arrive in #2019 (`mode`), #2467
 *  (`name` / `subtypes` / `body` / `payLife`), #2451 (`copy`) and #1980
 *  (`pay`). */
export type AsEntersChoice =
    /** CR 614.12 — "as this enters, choose a colour/creature type/…" expressed
     *  as one of the card's own `modes`; the answer is written to
     *  `CardInstanceState.chosenModeId` (Voice of All, Prismatic Ward). */
    | { kind: "mode" }
    /** CR 614.1c — "as this enters, name a card" (Meddling Mage); the answer is
     *  written to `CardInstanceState.chosenName`. `filter` narrows the legal
     *  name space (Meddling Mage's "choose a nonland card name") and is
     *  ENFORCED at submit — `applyNameCardSubmit`
     *  (`convex/gre/pendingChoiceSubmit.ts`) reads it off the staged entry and
     *  rejects a name it does not match, so the definition stays the single
     *  source and no copy rides the prompt. What is enforced is exactly the
     *  subset of `EffectCardFilter` the shared `handCardMatchesFilter` reads
     *  (name / type / excludeType / subtype / supertype / color /
     *  manaValueAtMost / manaCostEquals / any); the printed-characteristic
     *  fields it does not read — `excludeSupertype`, `excludeColor`,
     *  `manaValueEquals`, `hasAbility` — fall through to "matches", so a
     *  `filter` declaring only one of those is inert rather than restrictive.
     *
     *  Read on the BOT side via `isLegalNamedCard`/`nameCardDefaultFor`
     *  (`src/lib/ai/bot-view.ts`, `convex/gre/pendingChoiceSubmit.ts`) — the
     *  single admissibility authority both the server's submit check and the
     *  bot's default now share, so a filtered `name` choice cannot stall the
     *  escalation ladder (shipped by #2530, closing #2497; that issue's
     *  freeze analysis — CR 608.2's `choice` has no rung below the minimal-
     *  legal submission — is the reason both sides route through one
     *  predicate rather than two that could disagree). Still unreachable via
     *  the as-enters `filter` leg specifically (no shipped card populates
     *  this union — `asEntersUnion.test.ts` fails CI on the first one); the
     *  same predicate is already exercised live via `PendingChoice.
     *  nameRestriction` (Meddling Mage, Desperate Research). Picking a name
     *  that merely SATISFIES the filter is what's built; picking a name
     *  worth locking belongs with the card that first ships it (#2467). */
    | { kind: "name"; filter?: EffectCardFilter }
    /** CR 614.1c — "as this enters, choose N <subtype>s" (Illusionary Terrain);
     *  the answer is written to `CardInstanceState.chosenSubtypes`. */
    | { kind: "subtypes"; from: string[]; count: number }
    /** CR 614.1c — "as this enters, choose a body" (Primal Clay, Shapeshifter):
     *  the chosen option supplies the entering permanent's power / toughness and
     *  any body-bound subtypes or keywords.
     *
     *  A `body` immediately after a `payLife` in the same `asEnters` list is
     *  the Nameless Race COMPOSITION (#2467), not a card-shaped special case:
     *  `applyAsEntersAnswer`'s `payLife` arm overwrites the queued `body`'s
     *  `options` with the single option derived from the life just paid, so
     *  `body` never actually offers the card's OWN declared `options` in that
     *  shape — declare `options: []` there; it is dead data kept only so the
     *  type stays uniform across every `body` leg. */
    | {
          kind: "body";
          options: {
              id: string;
              label: string;
              power: number;
              toughness: number;
              subtypes?: string[];
              staticAbilities?: string[];
          }[];
      }
    /** CR 614.1c + CR 119.4 — "as this enters, pay any amount of life" (Nameless
     *  Race). `cap: "life"` means "any amount you can pay"; a number caps it
     *  lower; `{ opponentBoardCount }` caps it at a count read fresh off the
     *  chooser's OPPONENTS' board as the choice is offered — permanents
     *  matching `permanents` plus graveyard cards matching `graveyardCards`
     *  (Nameless Race: "can't be more than the total number of white nontoken
     *  permanents your opponents control plus … white cards in their
     *  graveyards", #2467). Generalizes the fixed-number cap by reusing
     *  `PermanentFilter` / `EffectCardFilter` rather than adding a bespoke
     *  `kind` for a board-derived cap (ADR 0100 D3 — "two kinds composing beats
     *  one more bespoke kind"); resolved by `asEntersOpponentBoardCount`
     *  (`convex/gre/state.ts`). COST-BEARING, so it participates in the CR
     *  614.12b constraint when two permanents are staged simultaneously. */
    | {
          kind: "payLife";
          cap:
              | number
              | "life"
              | {
                    opponentBoardCount: {
                        permanents?: PermanentFilter;
                        graveyardCards?: EffectCardFilter;
                    };
                };
      }
    /** CR 707.6 — "as this enters, it becomes a copy of …" (Clone). Answering it
     *  can GROW the owed list: the COPIED definition's own `asEnters` entries are
     *  discovered only once the copy has been applied (ADR 0100 D4). */
    | { kind: "copy"; filter?: PermanentFilter; opts?: CopyEffectOptions }
    /** CR 303.4f — an Aura entering by a non-cast path chooses what it enchants.
     *  Not declared by any card: the entry sites raise it themselves for an Aura
     *  with two or more legal hosts (ADR 0100 D2 folds the shipped
     *  `stagedAuraEntries` mechanism into this one). */
    | { kind: "aura-host" }
    /** CR 614.12 — "as this enters, you may pay <cost>" (shock lands, ADR 0051).
     *  Declared here so the family is whole; the shipped `land-entry-tapped`
     *  provisional park keeps its own shape until #1980 reconciles the two. */
    | { kind: "pay"; cost: ManaCost }
    /** CR 614.1a + CR 701.9 — "if this permanent would enter, you may discard a
     *  card matching `filter` instead. If you do, put it onto the battlefield.
     *  If you don't, put it into `ifDeclined`" (Mox Diamond, #2389).
     *
     *  The one DECLINABLE member of this union: every other kind narrows HOW the
     *  permanent enters, this one decides WHETHER it enters at all. Declining —
     *  or being unable to pay, which CR 614.1a makes the same thing since the
     *  "instead" is never applied — aborts the staged entry, and
     *  `applyAsEntersAnswer` puts the object in `ifDeclined` itself rather than
     *  running the entry tail (the `aura-host` CR 303.4g shape). The permanent
     *  therefore never touches the battlefield on that branch: no ETB trigger,
     *  no LKI, no "dies" event — a permanent SPELL goes stack → graveyard as a
     *  card (CR 608.3).
     *
     *  COST-BEARING, so it participates in the CR 614.12b constraint when two
     *  permanents are staged simultaneously; the candidate set is recomputed as
     *  the choice is OFFERED (`enqueueAsEntersChoice`), which is what keeps a
     *  sibling's already-committed discard out of it.
     *
     *  `ifDeclined` is data rather than a convention because "you may X instead,
     *  or it goes to Y" is the general shape and Y is the card's to say; today
     *  only the graveyard leg is printed. `filter` is matched with the shared
     *  `handCardMatchesFilter`, the same matcher the alt-cost hand leg and the
     *  as-enters `name` filter use — so it reads 9 of `EffectCardFilter`'s
     *  fields and treats the rest as "matches". */
    | { kind: "discard"; filter?: EffectCardFilter; ifDeclined: "graveyard" }
    /** CR 614.12c — "some replacement effects cause a permanent to enter the
     *  battlefield with its controller's choice of one of two abilities, each
     *  marked with an anchor word". No shipped card uses anchor words; the kind
     *  ships so the mechanic is whole with no card exposing it. */
    | {
          kind: "anchor";
          options: { id: string; label: string; staticAbilities?: string[] }[];
      };

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
    /** Subtypes added on top of the copied object's subtypes (CR 707.2's
     *  "except" clause — Phantasmal Image: "it's an Illusion in addition to
     *  its other types", Oracle-worded as a type but Illusion is a creature
     *  SUBTYPE; CR 707.2 lets an "except" clause modify any copiable value).
     *  Mirrors `additionalTypes` exactly: appended in `applyCopy`, fully
     *  recomputed from `opts` on every application (so a re-copy without the
     *  option — Vesuvan-style — doesn't leave a stale addition behind). */
    additionalSubtypes?: string[];
    /** Ids on the RECIPIENT's own `triggeredGrantTemplates[]` for triggered
     *  abilities the copy effect itself adds (CR 707.2's "except" clause —
     *  Phantasmal Image: "...and it has 'When this creature becomes the
     *  target of a spell or ability, sacrifice it.'"). Distinct from
     *  `TriggeredAbility.retainedThroughCopy` (which preserves an ability the
     *  recipient already had printed, across the copy overwrite — Vesuvan's
     *  own upkeep re-copy trigger): this GRANTS an ability the recipient's
     *  printed card does not otherwise have, sourced from ITS OWN
     *  `triggeredGrantTemplates[]` (not the copied object's) so the ability
     *  survives regardless of what gets copied. Routed entirely through the
     *  existing anthem-style grant machinery
     *  (`CardInstanceState.grantedTriggeredAbilities`,
     *  `effectiveTriggeredAbilities` in `gre/copy.ts`) — no new trigger-scan
     *  path. `applyCopy` recomputes the recipient's own-sourced grants from
     *  this list on every application, same idempotency shape as
     *  `additionalTypes`/`additionalSubtypes`. */
    additionalTriggeredAbilityIds?: string[];
    /** CR 707.2's "except" clause granting a KEYWORD the copied object does
     *  not have — Fable of the Mirror-Breaker's back face: "a token that's a
     *  copy of another target nonlegendary creature you control, EXCEPT IT HAS
     *  HASTE" (issue #2399). Appended to the copied definition's own
     *  `staticAbilities` inside `applyCopy`'s copiable-value rebuild, exactly
     *  the way `additionalSubtypes` is appended to its subtypes — so the
     *  keyword is a COPIABLE VALUE of the copy (CR 707.2), not a layer-6
     *  grant. That distinction is observable: copy the copy and the second
     *  token has haste too, which a `grantAbility` Op after the fact would not
     *  give. Fully recomputed from `opts` on every application (a re-copy
     *  without the option leaves no stale keyword behind), same idempotency
     *  shape as `additionalTypes`/`additionalSubtypes`. */
    additionalStaticAbilities?: string[];
    /** CR 707.2 "except its base power and toughness are N/N" — the copy's
     *  BASE P/T (layer 7a) replaces the copied object's printed values.
     *  Eternalize (CR 702.129a) makes a 4/4; Embalm (CR 702.128a) omits it and
     *  keeps the printed body. A copiable value, so every later layer (7b–7e
     *  anthems, counters) still applies on top. Both halves are independent so
     *  a future "except its base power is 1" clause needs no new field. */
    basePower?: number;
    baseToughness?: number;
    /** CR 707.2 "except it's [colour]" — an explicit colour SET on the copy
     *  (Eternalize: black; Embalm: white). Written to the recipient's layer-5
     *  `colorOverride`, the SAME field `getEffectiveColors` treats as
     *  outranking every other derivation.
     *
     *  Distinct from `copyColor: false` + `ownColors`, which means "don't copy
     *  the colour, keep your OWN" (Vesuvan Doppelganger, CR 707.9d). This one
     *  names the colours outright, so it takes precedence when both are set. */
    colorOverride?: Color[];
    /** CR 707.2 "except it has no mana cost" (Eternalize / Embalm tokens; also
     *  every CR 111.4 token, whose mana value is 0). Written to the recipient's
     *  `manaCostOverride`, which `getInstanceManaCost` — the single authority
     *  every mana-value and colour reader goes through — honours ahead of the
     *  copied definition's printed cost. Mana value therefore reads 0. */
    noManaCost?: boolean;
    /** Scryfall print id for the copy's ART (CR 111 / 707.2 — cosmetic only,
     *  never a characteristic). A copy normally presents the copied card's own
     *  printing, which is right for Clone and Dance of Many; an Eternalize /
     *  Embalm token has its OWN printed token card (Fanatic of Rhonas → tmh3
     *  #15, a black Zombie Snake Druid frame) and must render that instead.
     *  Written to `CardInstanceState.imagePrintId`, which the card renderer
     *  prefers over the definition-derived art. */
    imagePrintId?: string;
}

/** CR 615 / 510.1c — a SOURCE-scoped damage-prevention shield: it prevents
 *  damage the matched SOURCE would deal, to ANY recipient. Every other shield
 *  on `GameState` is keyed on the RECIPIENT (`targetPreventionShields`,
 *  `playerDamagePrevention`) or on a source/recipient PAIR
 *  (`preventionEffects` — a Circle of Protection); this is the only
 *  recipient-agnostic one, which is exactly the shape "prevent all combat
 *  damage target creature would deal this turn" needs.
 *
 *  A source matches when EITHER match arm hits:
 *   - `sourceIds` — an explicit instance-id list, locked in at resolution
 *     (Falling Timber's announced target, Guard Dogs' target, Rith's Charm's
 *     chosen source, Farrel's Mantle's marked creature).
 *   - `match` — a DYNAMIC characteristic filter re-evaluated at the moment
 *     damage would be dealt, so a creature that BECOMES blue after the shield
 *     resolves is covered (Radiant Kavu, CR 615.6). `colors` is an OR-set
 *     (CR 202.2 — "blue creatures and black creatures" means a source that is
 *     blue OR black); `cardType` additionally requires that card type.
 *
 *  `combatOnly` narrows the shield to COMBAT damage (CR 510). Omitted/false
 *  means ALL damage from the source is prevented, combat or not (Rith's
 *  Charm). Every shield in this list is turn-scoped: unconsumed entries expire
 *  at CLEANUP (CR 514.2). */
export interface SourceDamagePreventionShield {
    /** Instance ids of the shielded sources. Omit for a filter-only shield. */
    sourceIds?: string[];
    /** Dynamic characteristic match, evaluated at damage time. */
    match?: {
        /** OR-set of colours (CR 202.2). A source matches if it is any one. */
        colors?: Color[];
        /** Additionally require this card type on the source (CR 205.2). */
        cardType?: CardType;
    };
    /** true → only combat damage is prevented (CR 510). */
    combatOnly?: boolean;
    /** true → this entry is NOT a CR 615 prevention effect at all: it is the
     *  CR 510.1c combat-damage ASSIGNMENT restriction ("target creature
     *  assigns no combat damage this turn" — Farrel's Mantle, Farrel's
     *  Zealot), which happens to have the same outcome and rides the same
     *  list.
     *
     *  The distinction is invisible until a source-side "combat damage can't
     *  be prevented" effect exists (CR 615.12, Questing Beast). Unpreventable
     *  damage overrides every PREVENTION shield in this list (Falling Timber,
     *  Guard Dogs, Radiant Kavu, Rith's Charm, and the CR 615 spelling of
     *  "assigns no combat damage" that Warning / Restrain use) — but it does
     *  NOT override an assignment restriction: a creature that assigns no
     *  combat damage never produces a damage event for CR 615.12 to protect.
     *
     *  Deliberately fail-OPEN toward prevention: an entry that omits the flag
     *  is treated as a CR 615 shield, which is what every other producer of
     *  this list creates. `markAssignsNoCombatDamage` — the single CR 510.1c
     *  producer — sets it explicitly. */
    assignsNone?: boolean;
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
    /** Chosen targets (validated at cast time). Always an ANNOUNCED target
     *  (CR 601.2c) in practice — `selectTarget` / `getLegalTargets` /
     *  `enumerateTargetTuples` never produce the "hand-card" member of
     *  `TargetSelection.type` (issue #1101 — that kind only arises from a
     *  `lookDistribute` `bind`'s internal object resolution, `resolveObjectRef`'s
     *  hand-card fallback), so this stays the broader `TargetSelection[]`
     *  rather than forking a second announced-only type across the whole
     *  targeting plumbing. */
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
     *  battlefield.
     *
     *  `opts` additionally accepts the CR 508.4 entry-state flags
     *  `entersTapped` / `entersAttacking` (issue #1195, Satya, Aetherflux
     *  Genius — "create a tapped and attacking token that's a copy of…"):
     *  passed straight through to the internal placeholder token's
     *  `TokenSpec`, so the SAME `createTokenPermanents` handling that taps a
     *  plain `createToken` and joins it to combat applies here too, BEFORE
     *  `applyCopy` overwrites the token's copiable characteristics (entry
     *  state is independent of what gets copied). Meaningless for
     *  `becomeCopyOf` (a permanent already on the battlefield never
     *  "enters"), so those two fields live only on this function's `opts`,
     *  not on the shared `CopyEffectOptions` interface itself.
     *
     *  `lastKnownFromGraveyardOrExile` (CR 608.2b / 702.129a, issue #2339)
     *  widens the source lookup — and ONLY for the caller that sets it — from
     *  "on the battlefield" to "on the battlefield, or last known in a
     *  graveyard or exile". Exactly one shape needs it: a keyword whose own
     *  activation COST removed the source from the zone it was activated from
     *  (Eternalize exiles the card from the graveyard to pay, then resolves by
     *  copying it). Copiable values are printed values (CR 707.2), so the copy
     *  is identical wherever the object now sits. Left unset — the default,
     *  and every pre-existing caller — a source that has left the battlefield
     *  still fizzles the copy. Hidden zones (hand, library) are never
     *  searched: CR 400.2, no rules story copies a card nobody can see. */
    createTokenCopyOf: (
        sourceCreatureId: string,
        controllerId: string,
        createdBy?: string,
        opts?: CopyEffectOptions & {
            entersTapped?: boolean;
            entersAttacking?: boolean;
            lastKnownFromGraveyardOrExile?: boolean;
        }
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
    /** CR 120.1 — deals `amount` damage to a player FROM an explicit
     *  battlefield permanent (`sourceInstanceId`), rather than from the
     *  resolving stack item. The named permanent is stamped as the damage
     *  source, so source-keyed rules — infect (life-loss vs poison), lifelink
     *  (its controller gains life), source-colour prevention/protection, "a
     *  source deals damage" triggers — all key off THAT permanent's identity,
     *  not the spell's. Routes through the same CR 614 replacement → CR 615
     *  prevention pipeline as `dealDamage`. Used by Backlash ("that creature
     *  deals damage equal to its power to its controller"), the declarative
     *  skin being `dealDamage`'s optional `source` field. No-op when the
     *  permanent has left the battlefield (CR 608.2b) or `amount <= 0`. */
    dealDamageFromPermanent: (
        sourceInstanceId: string,
        playerId: string,
        amount: number
    ) => void;
    /** Generic Fight primitive (CR 701.14-style mutual damage). The resolving
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
     *  (CR 601.2h — "Unpayable costs can't be paid"). n <= 0 is a trivially-paid
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
    /** Re-writes a permanent's stored modal choice (`chosenModeId`, CR 700.2c)
     *  post-ETB — the "choose a color" half of a re-choosable modal permanent
     *  (Chromatic Armor: "{X}: Put a sleight counter on this Aura and choose a
     *  color"). No-op if the permanent has left the battlefield. The new
     *  `modeId` must be one of the card's declared `modes[].id`; a
     *  colour-filtered replacement/static that reads `self.chosenModeId`
     *  (the shipped Prismatic-Ward shield) immediately reflects the new pick. */
    setChosenMode: (instanceId: string, modeId: string) => void;
    /** CR 702.138b — true iff `target` is a permanent that ESCAPED (was cast
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
    /** Whether the target permanent is tapped (CR 701.26a). Returns false for
     *  players and for permanents no longer on the battlefield. Used by
     *  intervening-if checks like Howling Mine's "if ~ is untapped". */
    getIsTapped: (target: TargetSelection) => boolean;
    /** Destroys a permanent (CR 701.8). Routes through the regeneration /
     *  indestructible replacement layer. Returns true if the permanent was
     *  actually moved to the graveyard, false if a regen shield or
     *  indestructible saved it or if the target had already left the
     *  battlefield. Used by spells like Volcanic Eruption that must count
     *  "permanents put into a graveyard this way" (CR 614.5, 701.19a).
     *
     *  Pass `cantBeRegenerated: true` (Terror, Disintegrate) to suppress the
     *  regen shield replacement (CR 701.19c) — indestructible still
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
    /** Adds a subtype to a target permanent INDEFINITELY, in addition to its
     *  other types (layer 4, CR 613.1d, issue #1194 — Guide of Souls: "It
     *  becomes an Angel in addition to its other types"). Not tied to a
     *  source staying in play (CR 611.2c — a resolving ability's continuous
     *  effect doesn't depend on its source once generated): the target keeps
     *  the subtype even after the granting permanent leaves the battlefield.
     *  Writes the same `grantedSubtypesAdd` instance markers the aura-style
     *  `subtype-add` static effect uses, keyed to the `"indefinite"` sentinel
     *  source id — mirrors `setSupertype`'s indefinite CR 205.4a pattern
     *  exactly, no new storage shape. Idempotent (adding an already-present
     *  subtype via this indefinite grant is a no-op). No-op for a
     *  non-permanent target or one that has left the battlefield.
     *
     *  `enchantRestriction` (CR 303.4) is the enchant clause that comes WITH
     *  an `"Aura"` subtype grant — "it becomes an Aura with enchant creature".
     *  It is stamped on the instance (`grantedEnchantRestriction`) and is
     *  written even when the subtype itself is already present (the
     *  idempotency above is about the subtype, not the restriction). */
    addSubtype: (
        target: TargetSelection,
        subtype: string,
        enchantRestriction?: EnchantRestriction
    ) => void;
    /** SETS a target permanent's card types INDEFINITELY, replacing every type
     *  it currently has (CR 205.1a: "Some effects set an object's card type.
     *  In most such cases, the new card type(s) replaces any existing card
     *  types."; layer 4, CR 613.1d). Oko, Thief of Crowns' "+1: Target
     *  artifact or creature ... becomes a green Elk creature" — the affected
     *  artifact stops being an artifact.
     *
     *  Not tied to a source staying in play (CR 611.2c — a resolving ability's
     *  continuous effect doesn't depend on its source once generated), so it
     *  writes the SAME `grantedTypes` / `suppressedTypes` instance markers the
     *  aura-style `type-add` / `type-remove` static effects use, keyed to the
     *  `"indefinite"` sentinel source id — exactly the pattern `setSupertype`
     *  (CR 205.4a) and `addSubtype` (layer 4) already use, no new storage
     *  shape. `revertTypeProvenance` (`gre/state.ts`) is already
     *  source-agnostic and restores the printed type line when the permanent
     *  leaves the battlefield (CR 400.7).
     *
     *  SUPERTYPES are untouched — they live on a separate field, which is what
     *  CR 205.1a describes and what Oko's own ruling confirms ("The creature
     *  keeps any supertypes (such as legendary) it has, but loses any other
     *  card types it has (such as artifact)").
     *
     *  SUBTYPES are deliberately NOT touched here. CR 205.1a's correlated-
     *  subtype clause ("If an object's card type is removed, the subtypes
     *  correlated with that card type ... are also removed") is the territory
     *  of the subtype primitives `setSubtypes` / `setSubtypesUntil`, whose
     *  non-land arm already replaces a permanent's subtype line wholesale.
     *  Every "becomes a [subtype] [type]" Oracle line sets both halves, so the
     *  two primitives are paired at the call site (Oko: `setCardTypes` then
     *  `setSubtypes(["Elk"])`) rather than one reaching into the other's
     *  storage. No-op for a non-permanent target or one that has left the
     *  battlefield (CR 608.2b). */
    setCardTypes: (target: TargetSelection, types: CardType[]) => void;
    /** Makes a target permanent LOSE ALL ABILITIES indefinitely (CR 613.1f
     *  layer 6 — ability-removing effects), as generated by a RESOLVING
     *  one-shot ability rather than by a continuous static effect: Oko, Thief
     *  of Crowns' "+1: Target artifact or creature loses all abilities ...".
     *  CR 611.2c — the effect does not depend on its source staying on the
     *  battlefield, so it never reverts (Oko's ruling: "The effects of Oko's
     *  second ability lasts indefinitely. It doesn't expire during the cleanup
     *  step or if you or Oko leave the game.").
     *
     *  Writes the SAME instance markers the continuous `ability-loss` static
     *  effect writes (`abilitiesSuppressedBy` + one `removedKeywords` entry per
     *  stripped keyword) through the SAME shared applier, keyed to the
     *  `"indefinite"` sentinel source id — one execution path, so activated,
     *  triggered, mana and keyword abilities all disappear by exactly the
     *  mechanism Titania's Song already exercises.
     *
     *  Takes a FRESH layer timestamp (`allocStaticTimestamp`), so per CR 613.7
     *  an ability GRANTED to the permanent after this resolves survives — the
     *  printed ruling: "If the affected creature gains an ability after Oko's
     *  second ability resolves, it will keep that ability." No-op for a
     *  non-permanent target or one that has left the battlefield
     *  (CR 608.2b). */
    loseAllAbilities: (target: TargetSelection) => void;
    /** Returns a target permanent to its owner's hand (CR 400.7). The card
     *  becomes a new object on the zone change (CR 400.7) — battlefield-only
     *  transient state (tapped, marked damage, regen shields, summoning
     *  sickness, attached/granted-by-aura state) is cleared. No-op if the
     *  target has left the battlefield (CR 608.2b). */
    returnToHand: (target: TargetSelection) => void;
    /** Puts a target battlefield permanent into its OWNER's library
     *  `positionFromTop` cards from the top (1-based; 1 = top — CR 400.7,
     *  issue #1726, Teferi, Hero of Dominaria's −3 "third from the top" =
     *  3). Routed through the single LTB funnel (`removePermanentTo`), so
     *  aura cleanup (CR 611.2), transient-state reset (CR 400.7), counter
     *  loss (CR 121.2), PERMANENT_LEFT and an `exileOnLeave` redirect
     *  (CR 614.1c — a redirected card never reaches the library) all behave
     *  exactly as for a bounce. When the library holds fewer than
     *  `positionFromTop − 1` cards the card is put on the bottom (splice
     *  clamps — the official Teferi ruling). The moved card is stamped
     *  known-to-all (ADR 0026): every player watched WHICH card went in and
     *  where; the projection's contiguous-run model surfaces it once the
     *  cards above it are drawn, and any shuffle clears it. No-op if the
     *  target has left the battlefield (CR 608.2b). */
    putIntoLibraryFromBattlefield: (
        target: TargetSelection,
        positionFromTop: number
    ) => void;
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
     *  `shuffleLibrary` (CR 701.24) after the search resolves. */
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
     *  not able (not in hand, not a Land, or the land drop is spent).
     *
     *  ZONE-BROAD (CR 305.9, issue #1961) — `opts.sourceZone` names the zone the
     *  land is played FROM, defaulting to `"hand"` (Word of Command's shape,
     *  unchanged). A `"graveyard"`/`"exile"` source is the land twin of
     *  `castChosenSpell`'s own zone generalization: a play-during-resolution
     *  permission (Hideaway's "you may play the exiled card") reaches a land
     *  sitting in exile, and it must enter through the SAME canonical land-play
     *  transition so the CR 305.2a land drop is recorded identically. This
     *  primitive is deliberately timing-AGNOSTIC — CR 305.3 ("a player can't
     *  play a land if it isn't their turn") is enforced by the CALLER's legality
     *  lookup ({@link getChosenLandPlayable}), because Word of Command's own
     *  resolution plays a land under the NON-active player's control. */
    playLandForPlayer: (
        playerId: string,
        cardInstanceId: string,
        opts?: { sourceZone?: "hand" | "graveyard" | "exile" }
    ) => boolean;
    /** Taps a permanent on the battlefield (CR 701.26a). No-op if already
     *  tapped or if the target is no longer on the battlefield (CR 608.2b).
     *  Used by Icy Manipulator and similar "tap target permanent" effects. */
    tap: (target: TargetSelection) => void;
    /** Untaps a permanent on the battlefield (CR 701.26b). No-op if already
     *  untapped or if the target is no longer on the battlefield (CR 608.2b).
     *  Used by Twiddle's untap mode and similar "untap target permanent"
     *  effects. */
    untap: (target: TargetSelection) => void;
    /** Transforms a permanent (CR 701.27 / 712, issue #1210, ADR 0067) — flips
     *  it to its back face if currently showing front, or back to front if
     *  already transformed (CR 712.8a — the SAME primitive flips either
     *  direction). A thin entry point over the pure `transformPermanent`
     *  mutator (`gre/transform.ts`), mirroring how `tap`/`untap` wrap
     *  `tapPermanent`/`untapPermanent`. No-ops if the target left the
     *  battlefield (CR 608.2b) or its current-face definition declares no
     *  `backFace` — nothing to flip to/from. Used by a double-faced
     *  permanent's own "{cost}: Transform this" activated ability (the
     *  Incubator token, CR 701.53). */
    transform: (target: TargetSelection) => void;
    /** Exiles a permanent and immediately returns it to the battlefield showing
     *  its BACK face, under its OWNER's control (CR 712 / 400.7, issue
     *  #2380) — the ORI flip-walker template ("exile Jace, then return him to
     *  the battlefield transformed under his owner's control").
     *
     *  The SIBLING of {@link SpellContext.transform}, never a mode of it: that
     *  one flips a permanent in place (CR 712.8a) and the object's identity is
     *  preserved, this one performs two real zone changes, so what comes back
     *  is a NEW object (CR 400.7) — counters are gone, Auras/Equipment have
     *  fallen off, "enters the battlefield" triggers fire again, existing
     *  references (targets on the stack) no longer find it, and a planeswalker
     *  back face enters with its own CR 306.5b starting loyalty
     *  ({@link CardBackFace.loyalty}).
     *
     *  No-op when the target has already left the battlefield (CR 608.2b), and
     *  the return leg is skipped when a replacement effect diverted the card to
     *  some zone other than exile on its way out. A permanent whose current
     *  face declares no `backFace` is still exiled and returned (it simply
     *  comes back showing the same face) — the Oracle clause's exile is
     *  unconditional.
     *
     *  `controllerId` overrides who the returning permanent enters under. The
     *  DEFAULT (omitted) is its OWNER — the ORI flip-walker wording, "return
     *  him to the battlefield transformed under his OWNER's control", so a
     *  stolen Jace flips back to its owner. Fable of the Mirror-Breaker's
     *  chapter III says "under YOUR control" instead (issue #2399), which is a
     *  different answer only when the Saga's controller is not its owner — pass
     *  the ability's controller for that wording. */
    exileAndReturnTransformed: (
        target: TargetSelection,
        controllerId?: string
    ) => void;
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
     *  rider (CR 701.26a): the permanent taps the instant control reverts.
     *  No-op if the target has left the battlefield. */
    gainControlUntilEndOfTurn: (
        target: TargetSelection,
        newControllerId: string,
        opts?: { tapOnLoss?: boolean }
    ) => void;
    /** Destroys every permanent on the battlefield matching the filter
     *  (CR 701.8). Shorthand `CardType | CardType[]` is equivalent to
     *  `{ types }`. The object form supports compounding types, subtypes, and
     *  keyword requirements — e.g. `{ types: "Creature", excludeAbility: "flying" }`
     *  for "destroy all non-flying creatures". Undefined filter destroys every
     *  permanent.
     *
     *  Pass `opts.cantBeRegenerated: true` (Wrath of God, Damnation) to
     *  suppress the regen shield replacement (CR 701.19c) — indestructible
     *  still protects. */
    destroyAll: (
        filter?: CardType | CardType[] | PermanentFilter,
        opts?: { cantBeRegenerated?: boolean }
    ) => void;
    /** Player draws N cards one at a time (CR 121.1). Stops if library empties; sets hasDrawnFromEmpty (CR 704.5b).
     *  Each draw funnels through the CR 614 draw-replacement seam
     *  (`planDrawStep`/`commitDrawPlan`), so a DETERMINISTIC replacement
     *  (Enduring Renewal) fires here too. INTERACTIVE replacements (Zur's
     *  Weirding "may pay 2 life") cannot suspend in this synchronous primitive,
     *  so the drawing player draws without offering the pay-choice — the DSL
     *  `draw` Op is the suspend-capable path (ADR 0061). By design: every
     *  `resolve()`/`resolveSteps` card that needs interactivity migrated onto
     *  the DSL `draw` Op (issue #1264, closed #1250); this primitive now
     *  serves internal non-interactive plumbing plus the narrow allowlisted
     *  stragglers in `convex/cards/__tests__/drawPrimitiveGuard.test.ts`. */
    drawCards: (playerId: string, amount: number) => void;
    /** CR 614 / ADR 0061 — the suspend-capable draw seam, exposed for the DSL
     *  `draw` Op. `planDraw` computes the replacement plan for the drawing
     *  player's NEXT single draw (revealing the top card when an interactive
     *  replacement will offer a pay-choice); `commitDraw` applies a computed
     *  plan and returns how many cards actually entered the hand (emitting
     *  CARD_DRAWN per card). The Op loops `planDraw` → `requestMayPay` (only
     *  for `may-pay-bin`) → `commitDraw`, one card at a time, so an interactive
     *  draw replacement suspends and resumes at the exact card. `paid` is the
     *  `may-pay-bin` answer (ignored for other plan kinds). */
    planDraw: (playerId: string, requestedCount: number) => DrawStepPlan;
    commitDraw: (
        playerId: string,
        plan: DrawStepPlan,
        paid?: boolean
    ) => number;
    /** CR 701.17 — mills the top `amount` cards of a player's library into
     *  their graveyard, one at a time (re-reading the live top each pass so
     *  successive mills chase the receding library top), stopping early once
     *  the library empties (CR 701.17a). The single choke point for "when this
     *  card is put into your graveyard from your library" triggers (Gaea's
     *  Blessing) — emits one `CARD_MILLED` event per card AFTER it lands in the
     *  graveyard, the mill analogue of `drawCards`/`emitCardDrawn`. No-op for
     *  `amount ≤ 0`.
     *
     *  Returns the instance ids of the cards that GENUINELY reached the
     *  graveyard, in mill order (issue #1095, the `mill` Op's `bind`). A card
     *  a CR 614 graveyard-bound replacement (Yawgmoth's Will / Dauthi
     *  Voidwalker) redirected to exile is omitted — it was exiled, not milled,
     *  the same distinction that already gates `CARD_MILLED` emission below. */
    millCards: (playerId: string, amount: number) => string[];
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
            /** CR 701.13 — whether the host's attachments travel into exile WITH
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
    /** CR 720.2 (issue #1199) — crowns `playerId` the monarch. Idempotent (a
     *  player who is already the monarch becoming the monarch again is a
     *  no-op) and self-reassigning (crowning someone new automatically
     *  displaces whoever held the designation — CR 720.2 — no separate "stop
     *  being monarch" call). Also the CR 720 release trigger for any Palace
     *  Jailer-style watch armed by `exileUntilMonarchChanges` against a
     *  DIFFERENT controller than the newly-crowned player ("an opponent
     *  becomes the monarch"). */
    becomeMonarch: (playerId: string) => void;
    /** CR 720 (Palace Jailer, issue #1199) — exiles `targetId` (host-only,
     *  CR 701.13, the O-Ring precedent: its Auras fall to the orphan-aura SBA
     *  and Equipment detaches) and arms a watch that returns it the moment an
     *  OPPONENT of the resolving ability's controller next becomes the
     *  monarch (`becomeMonarch`). Unlike `exileWithAttachments`, the return
     *  condition is the monarch designation changing hands, not this card's
     *  own source leaving the battlefield — Palace Jailer leaving play does
     *  NOT return the exiled creature (official ruling). No-op if the target
     *  isn't on the battlefield. */
    exileUntilMonarchChanges: (
        targetId: string,
        opts?: { returnTapped?: boolean }
    ) => void;
    /** Randomizes the order of a player's library using the seeded PRNG
     *  (CR 701.20). Deterministic under replay. */
    shuffleLibrary: (playerId: string) => void;
    /** Puts every card in a player's graveyard onto the BOTTOM of their
     *  library in a random order (Endurance's ETB — "put all the cards from
     *  their graveyard on the bottom of their library in a random order").
     *  The graveyard cards are shuffled among themselves with the seeded PRNG
     *  (deterministic under replay) and appended after the existing library,
     *  which keeps its order; the new bottom ordering is unwitnessed, so
     *  knowledge on the moved cards is cleared (ADR 0026, like a shuffle).
     *  No-op when the graveyard is empty. */
    putGraveyardOnBottomOfLibrary: (playerId: string) => void;
    /** Counters a spell or ability on the stack (CR 701.6a). Target must be
     *  TargetSelection with type "spell". No-op if target no longer on stack
     *  (CR 608.2b). `destination` overrides where a COUNTERED SPELL (never an
     *  ability — CR 701.6a / 113.7a, abilities simply cease to exist) ends up
     *  instead of its owner's graveyard — the "if that spell is countered this
     *  way, exile/return/put-on-top instead" clause carried by No More Lies,
     *  Memory Lapse, and Remand. Omitted/`"graveyard"` is the default CR
     *  701.5a destination. */
    counter: (
        target: TargetSelection,
        destination?: CounterDestination
    ) => void;
    /** CR 701.6-adjacent (issue #1205, Subtlety) — move a SPELL on the stack
     *  onto the top or bottom of its owner's library WITHOUT countering it.
     *  Distinct from `counter(target, "library-top")`: this is a "put on
     *  library" effect, not a counter, so it ignores `cantBeCountered` (CR
     *  113.6g shields only against COUNTER effects). Target must be a
     *  `type: "spell"` TargetSelection; no-op if it has left the stack
     *  (CR 608.2b). An ability on the stack (no card) just vanishes, mirroring
     *  `counter`. `position` is the owner's chosen library end. */
    putSpellOnLibrary: (
        target: TargetSelection,
        position: "top" | "bottom"
    ) => void;
    /** Player discards `amount` cards chosen uniformly at random (CR 701.9a).
     *  Capped at current hand size — no-op on an empty hand. Randomness is
     *  drawn from the game's seeded PRNG so replays reproduce the same picks.
     *  `requireType` restricts the candidate pool to cards whose printed types
     *  include that type (CR 701.9a — Rag Man: "discards a creature card at
     *  random"); the random pick is taken only from matching cards, and the
     *  effect is a no-op when none match. Returns the discarded cards'
     *  instance ids, in discard order (issue #1123 — the `discardAtRandom` Op's
     *  optional `bind` snapshots the first one so a later `if` can test what
     *  was discarded). */
    discardAtRandom: (
        playerId: string,
        amount: number,
        requireType?: CardType
    ) => string[];
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
     *  step/phase like normal mana (CR 500.5). */
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
     *      exiled.
     *    - "until-next-end-step" (issue #1557): "you may play that card
     *      until your next end step" (Inti, Seneschal of the Sun). Unlike
     *      "this-turn", this window is relative to `playerId` and can span
     *      PAST the current turn's cleanup when the grant is created outside
     *      `playerId`'s own turn/combat step (e.g. an opponent's-turn
     *      instant-speed discard) — see `untilNextEndStepTurn` in
     *      `gre/state.ts`. Stamps an absolute turn number, same underlying
     *      field (`castableFromExileUntilTurn`) as "this-turn".
     *
     *  `opts.withoutPayingManaCost` (CR 601.3e / 117.6, issue #1156) —
     *  ALSO waives the card's mana cost entirely (Dauthi Voidwalker: "you
     *  may play it this turn without paying its mana cost"), stamping
     *  `CardInstanceState.castFromExileWithoutPayingManaCost` alongside the
     *  permission flag. Omitted/false is the historical permission-only
     *  shape (Ice Cauldron, Robber of the Rich — cast for the normal
     *  printed cost).
     *
     *  `opts.includesLand` (CR 305.9, issue #1689) — true iff the GRANTING
     *  Oracle text says "play" rather than "cast" (Headliner Scarlett:
     *  "you may look at and play that card this turn"; Expressive
     *  Iteration; Elkin Bottle; Inti, Seneschal of the Sun; Laelia, the
     *  Blade Reforged; Dauthi Voidwalker). Stamps `CardInstanceState.
     *  castableFromExileIncludesLand` alongside the permission flag, the
     *  ONLY thing that makes a LAND under the grant a legal "play" source
     *  (`getLegalActions`'s land branch, `gre/rules.ts`). Omitted/false
     *  (the default) is a CAST-only grant (Ice Cauldron, Robber of the
     *  Rich, Ragavan, Nimble Pilferer) — a land under it exposes no action
     *  at all, matching CR 305.9's default posture that a land can only be
     *  played from hand unless an effect EXPLICITLY says otherwise. */
    grantCastFromExile: (
        cardInstanceId: string,
        playerId: string,
        zoneOwnerId?: string,
        window?: "this-turn" | "while-exiled" | "until-next-end-step",
        opts?: { withoutPayingManaCost?: boolean; includesLand?: boolean }
    ) => void;
    /** Play-from-graveyard grant for a SPECIFIC card (CR 601.3e /
     *  117.6-analog, issue #1344 — Malcolm, Alluring Scoundrel: "you may
     *  cast the discarded card without paying its mana cost"). The
     *  graveyard-zone twin of {@link grantCastFromExile} — same "grant a
     *  specific card cast permission, optional cost waiver" shape,
     *  generalized to a second zone rather than a new card-shaped primitive
     *  (ADR 0045 primitive reuse). Always SAME-PLAYER: no `zoneOwnerId`
     *  parameter, since no cross-player graveyard-cast primitive exists in
     *  this engine (`castZoneOwner`'s doc, `convex/game.ts`). Flags the card
     *  `cardInstanceId` — found in `playerId`'s OWN graveyard — as castable
     *  from there by `playerId`. No-op if the id isn't in that player's
     *  graveyard OR is a LAND (CR 116.2a — a land is PLAYED, never CAST, so a
     *  cast permission is inherently meaningless for one; also the explicit
     *  Malcolm ruling — "You may not play land cards discarded with
     *  Malcolm's last ability").
     *
     *  `window` (CR 514.2 / 608.2g) declares the expiry, mirroring
     *  `grantCastFromExile`'s own:
     *    - "while-in-graveyard" (default): open-ended — persists as long as
     *      the card stays in the graveyard.
     *    - "this-turn": an impulse window, revoked at the CLEANUP step of
     *      the turn it was granted, while the card stays in the graveyard.
     *    - "until-next-end-step" (issue #1557): mirrors
     *      `grantCastFromExile`'s same-named window — see its doc comment.
     *
     *  `opts.withoutPayingManaCost` (CR 601.3e / 117.6-analog, issue #1344)
     *  — ALSO waives the card's mana cost entirely, stamping {@link
     *  CardInstanceState.castFromGraveyardWithoutPayingManaCost} alongside
     *  the permission flag. Omitted/false grants permission only (the card
     *  is still cast for its normal printed mana cost) — no shipped card
     *  uses that shape yet, but it mirrors the exile primitive's dual usage
     *  for free. */
    grantCastFromGraveyard: (
        cardInstanceId: string,
        playerId: string,
        window?: "this-turn" | "while-in-graveyard" | "until-next-end-step",
        opts?: {
            withoutPayingManaCost?: boolean;
            /** issue #2380 — the granted cast exiles the card as it leaves the
             *  stack (Jace, Telepath Unbound's −3) rather than putting it into
             *  its owner's graveyard. */
            exilesOnResolve?: boolean;
        }
    ) => void;
    /** Value chosen for X at cast-time (CR 107.3, 601.2b). 0 if the spell
     *  has no X in its cost. Read by spells like Fireball on resolution. */
    getX: () => number;
    /** CR 702.33 — how many times ANY of this spell's Kicker costs was paid as
     *  it was cast (0 = not kicked; 1 for a single kicker; N for a paid-N-times
     *  Multikicker, CR 702.33e). A DERIVED sum over the per-Kicker payment
     *  record snapshotted on the stack item (`StackItem.kickerPayments`) at cast
     *  commit (ADR 0079). Read in DSL via the `{ kickerCount: true }` value;
     *  `> 0` is the "was it kicked at all" test (Overload, Burst Lightning, …). */
    getKickerCount: () => number;
    /** CR 702.33 — how many times the NAMED Kicker was paid as this spell was
     *  cast (0 = that Kicker was not paid). The per-Kicker read a two-Kicker
     *  card's intervening-ifs need ("if it was kicked with its {2}{U} kicker",
     *  the Planeshift Battlemage cycle) — `getKickerCount` cannot distinguish
     *  which of two was paid. Read in DSL via `{ kickerPaid: "<id>" }`. */
    getKickerPaidCount: (kickerId: string) => number;
    /** Mana value of a target (CR 202.3 / 202.3b). For a permanent target,
     *  returns the printed cost's mana value — X in the cost counts as 0
     *  because the chosen X is not currently preserved on the resulting
     *  permanent. For a spell target on the stack, X folds in the chosen
     *  value from the stack item. For a graveyard-card target (issue #680 —
     *  Reanimate's "lose life equal to that card's mana value"), looks the
     *  card up in its owner's graveyard and returns its printed mana value.
     *  For a hand-card target (issue #1101 — Reviving Vapors' "gain life
     *  equal to that card's mana value", the card `lookDistribute` just kept),
     *  looks the card up in its owner's hand the same way. Returns 0 for
     *  player / unknown targets. Used by Spell Blast ("counter target spell
     *  with mana value X"). */
    getManaValue: (target: TargetSelection) => number;
    /** Printed mana cost of a target (CR 202.1), the full `ManaCost` shape
     *  (colored pips + generic) rather than `getManaValue`'s single reduced
     *  number. Mirrors `getManaValue`'s per-target-shape resolution
     *  (permanent / stack spell / graveyard-card; X counts as 0 exactly as
     *  `getManaValue` documents — a permanent's chosen X isn't preserved,
     *  CR 202.3). Returns `undefined` for a player/unknown target or a card
     *  with no mana cost (a land). Used by a `mayPay` Op's dynamically-derived
     *  cost leg (issue #1150, Flash — "pay its mana cost reduced by {2}"),
     *  which needs the colored pips preserved while only the generic portion
     *  is reduced. */
    getManaCost: (target: TargetSelection) => ManaCost | undefined;
    /** Mana value snapshotted on the stack item when this spell's
     *  additional sacrifice cost (CR 118.8) was paid at cast time. Returns
     *  `undefined` for spells without an `additionalCosts.sacrificeFilter`.
     *  Used by Sacrifice ("Add an amount of {B} equal to the sacrificed
     *  creature's mana value") to read the captured value at resolve. */
    getAdditionalSacrificeMv: () => number | undefined;
    /** Subtypes snapshotted on the stack item when this spell's additional
     *  sacrifice/exile cost (CR 118.8 / 601.2f) was paid at cast time. Returns
     *  `undefined` for spells without an `additionalCosts` picker. Used by Soul
     *  Exchange ("Put a +2/+2 counter on that creature if the exiled creature
     *  was a Thrull") to read the exiled creature's subtypes at resolve. */
    getAdditionalCostSubtypes: () => string[] | undefined;
    /** Effective POWER snapshotted on the stack item when this ability's
     *  additional sacrifice cost (CR 118.8 / 613 layer 7c) was paid. Captured
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
    /** Devotion (CR 700.5, issue #2070) — `playerId`'s devotion to `color`:
     *  the number of mana symbols of that colour among the mana costs of
     *  permanents `playerId` controls (coloured pips + Phyrexian pips of
     *  `color` + hybrid pips containing `color`, CR 700.5/105.2). Read live
     *  at call time (CR 700.5a) via `countDevotion` (`gre/layers.ts`), the
     *  SAME `getInstanceManaCost` single authority the layer-5 colour system
     *  and mana-value reads share — so a copy effect / mana-cost override is
     *  honoured identically. Used by the tenth `EffectValue` grammar member
     *  (`{ devotion: { of, color } }`, Thassa's Oracle). */
    getDevotion: (playerId: string, color: Color) => number;
    /** CR 119.3 (issue #1457) — the total life `playerId` has GAINED so far
     *  this turn, 0 when none. Reads back `GameState.lifeGainedThisTurn`, the
     *  tally `gainLifeEmitting` maintains at the single life-gain choke point
     *  every sink funnels through (the `gainLife` primitive, the CR 702.15b
     *  lifelink gain, the DSL `gainLife` Op) — so this getter never scans or
     *  recomputes. A gain of 0, or one fully replaced away (CR 614), never
     *  enters the tally: "gained 0 life" is correctly NOT "gained life".
     *  Used by the `{ lifeGainedThisTurn: { of } }` EffectValue grammar member
     *  and by imperative "if you gained life this turn" conditions. */
    getLifeGainedThisTurn: (playerId: string) => number;
    /** CR 702.131b (Ascend, issue #1460) — true iff `playerId` holds the
     *  city's blessing designation. Reads the monotonic
     *  `GameState.cityBlessingIds` set (once granted, never revoked). Powers
     *  the `hasCityBlessing` Effect Script predicate ("if you have the city's
     *  blessing", Ocelot Pride #1461) and imperative reads alike. */
    hasCityBlessing: (playerId: string) => boolean;
    /** CR 122 / 603.3 (issue #1189) — how many times (1-indexed, counting
     *  this resolution) the CURRENTLY RESOLVING triggered ability has
     *  resolved this turn. Reads `GameState.abilityResolutionCounts`, keyed
     *  by `${triggerSourceId}:${triggeredAbilityId}`; 0 when the resolving
     *  stack item isn't a triggered ability (no key to read). The engine
     *  increments the tally exactly once per resolution, BEFORE the effect
     *  runs (`resolveTopOfStackInner`), so the first resolution reads 1.
     *  Used by the `{ abilityResolutionCount: true }` EffectValue grammar
     *  member (Omnath, Locus of Creation; Scythecat Cub's escalating
     *  branches) — read via this getter rather than duplicating the lookup
     *  in the interpreter, one execution path (ADR 0045). */
    getAbilityResolutionCount: () => number;
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
    /** Installs a prevent-the-next-N damage shield on each of the given
     *  targets, with `totalAmount` DIVIDED AS YOU CHOOSE among them — each
     *  chosen target getting at least 1 (CR 615.1 / 601.2d / 120.4). The third
     *  member of the divide-as-chosen primitive family: identical
     *  announcement-time split / deterministic-fallback rules to
     *  `dealDamageDividedAsChosen` and `distributeCountersAsChosen`, but the
     *  per-target amount sizes a SHIELD (`preventNextNDamageToTarget`) instead
     *  of a damage or counter event. Used by Pollen Remedy ("Prevent the next
     *  3 damage that would be dealt this turn to any number of targets,
     *  divided as you choose"). No-op if `targets` is empty or
     *  `totalAmount <= 0`. */
    preventNextNDamageDividedAsChosen: (
        targets: TargetSelection[],
        totalAmount: number,
        duration: DurationSpec
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
    /** CR 114 — create an emblem in the command zone, owned/controlled by
     *  `ownerId` (CR 114.3). `emblemId` keys the emblem registry
     *  (`convex/cards/emblems.ts`), whose definition carries the granted
     *  continuous/triggered abilities. Appends an {@link EmblemInstance} to
     *  `GameState.emblems`. Returns the new emblem's instance id. Throws if
     *  `emblemId` is not registered. */
    createEmblem: (emblemId: string, ownerId: string) => string;
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
     *  - `from-source-to-permanent-redirect`: the next time source X (or,
     *    when `sourceInstanceId` is unset, ANY source) would deal damage to
     *    creature C, that damage is dealt to `redirectTo` instead — a
     *    player (Jade Monolith's `{1}`, always the activator) or a
     *    permanent (Mirrorwood Treefolk's `{2}{R}{W}`, "any target"
     *    announced at activation, CR 115.4/601.2c/602.2b, issue #1939).
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
                  kind: "from-source-to-permanent-redirect";
                  /** undefined = any source (Jade Monolith / Mirrorwood
                   *  Treefolk both use the wildcard — neither filters by
                   *  source). */
                  sourceInstanceId?: string;
                  targetInstanceId: string;
                  /** Destination of the redirected damage — a player or a
                   *  permanent, reusing `TargetSelection`'s shape rather
                   *  than a bespoke type (primitive reuse). */
                  redirectTo:
                      | { type: "player"; id: string }
                      | { type: "permanent"; id: string };
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
    /** Registers a SOURCE-scoped prevention shield (CR 615): all damage — or
     *  all COMBAT damage when `combatOnly` is set — that the matched source
     *  would deal this turn is prevented, to ANY recipient. The one primitive
     *  behind the `preventDamage` Op's source-scoped modes; the shield's match
     *  arms (`sourceIds` for a resolution-locked source list, `match` for a
     *  live characteristic filter) are documented on
     *  {@link SourceDamagePreventionShield}. `markAssignsNoCombatDamage` is
     *  the CR 510.1c spelling of the same list. Turn-scoped: an unconsumed
     *  shield expires at CLEANUP (CR 514.2). */
    preventAllDamageFromSources: (shield: SourceDamagePreventionShield) => void;
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
     *  (CR 113.1, 611.2a). Appends to the target's `staticAbilities` so combat
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
     *  (CR 113.1, 611.2a). The template is looked up at activation time on the
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
    /** Grants an ACTIVATED ability to `target` with NO duration and NO aura
     *  link (CR 113.1 / 611.2c) — it persists for as long as the permanent
     *  stays on the battlefield, independent of the granting source still
     *  being in play. The template is looked up at activation time on the
     *  granting card's `grantTemplates[]` (`sourceCardId` + `abilityId`) by
     *  `getEffectiveActivatedAbilities`, so the permanent exposes it as if
     *  printed on it — including to the mana probes (issue #1880). The
     *  permanent (indefinite) sibling of `grantActivatedAbility`; both the
     *  phase-boundary purge and the aura-unapply pass skip entries lacking
     *  duration/auraId, so it is cleared only when the target leaves play.
     *  Idempotent, and a no-op if the target has left the battlefield
     *  (CR 608.2b). Used by Urza's Saga chapters I / II. */
    grantActivatedAbilityPermanent: (
        target: TargetSelection,
        sourceCardId: string,
        abilityId: string
    ) => void;
    /** Grants a triggered ability to `target` for a limited duration
     *  (CR 113.1, 611.2a). The template is looked up at trigger-scan time on
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
     *  permanent for a limited duration (CR 611.2a layer 6). Each removed
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
    /** CR 603.3c — creates a REFLEXIVE triggered ability from inside a
     *  resolving effect ("Sacrifice a creature. **When you do**, ~ deals X
     *  damage to any target"). Unlike `scheduleDelayedTrigger` there is no
     *  waiting-for-a-boundary: the reflexive trigger is queued right here and
     *  put on the stack (above the resolving object) the next time a player
     *  would receive priority, choosing its targets as it goes on the stack
     *  (CR 603.3d) — the SAME `placeTriggersOnStack` /
     *  `raiseTriggerTargetSelection` path an ordinary triggered ability
     *  takes, so APNAP ordering and target announcement are inherited whole.
     *
     *  The body is always INLINE (a pure-JSON Op list, ADR 0046) and the
     *  payload is re-bound as its initial binding environment at resolution
     *  through the same `runDelayedTriggerBody` seam an inline delayed
     *  trigger uses. `targetRequirement` rides ON the queued stack item (the
     *  ability has no card-def row to read it from). Controlled by the
     *  resolving object's controller (CR 603.3c). */
    pushReflexiveTrigger: (
        sourceCardId: string,
        oracleText: string,
        effects: readonly EffectOp[],
        payload: Record<string, string | string[]>,
        targetRequirement?: TargetRequirement
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
    /** CR 504.1 (issue #1097 — Elfhame Sanctuary's "you skip your draw step
     *  this turn") — marks `playerId` to skip their OWN draw step the next
     *  time it is reached this turn. A one-shot flag armed at whatever step
     *  the resolving effect runs (Elfhame Sanctuary arms it at upkeep,
     *  earlier in the SAME turn than the draw step it consumes) and
     *  CONSUMED — spliced back out — the first time `drawStep`
     *  (`gre/phases.ts`) reaches that player, which simply skips the draw
     *  outright (no replacement choice, no card drawn). Distinct from
     *  `drawStepReplacement` (Fasting, `CardDefinition`): that is a STATIC
     *  per-card flag re-evaluated every turn, offering an interactive
     *  may-skip choice AT the draw step itself via its own DRAW phase
     *  trigger; this is a plain per-turn player flag set by a DIFFERENT
     *  step's effect, with no choice left to make once armed. Idempotent;
     *  cleared unconditionally at CLEANUP as a safety net for turn 1 (CR
     *  103.8a skips only the DRAW step, not UPKEEP, so a flag armed on
     *  turn 1 would otherwise never be consumed and must not survive to a
     *  later turn). */
    skipDrawStepThisTurn: (playerId: string) => void;
    /** CR 601.3e — grants `playerId` a per-player casting-timing permission:
     *  they may cast spells whose printed types intersect `cardTypes` as though
     *  they had flash (Teferi, Time Raveler's +1: "Until your next turn, you
     *  may cast sorcery spells as though they had flash"). Adds an entry to
     *  `state.castTimingFlashGrants`, honored by the shared cast gate
     *  (`hasCastTimingFlashGrant`) and cleared at the start of that player's
     *  next turn (via `advanceTurn`), NOT at CLEANUP — mirroring
     *  `islandSanctuaryProtection`'s "until your next turn" boundary. `cardTypes`
     *  omitted grants flash for every spell. */
    grantCastTiming: (playerId: string, cardTypes?: CardType[]) => void;
    /** CR 305.1-analog / 601 (issue #1149) — grants `playerId` a turn-scoped,
     *  player-wide permission to play lands and/or cast spells from their OWN
     *  graveyard (Yawgmoth's Will: "Until end of turn, you may play lands and
     *  cast spells from your graveyard"). `zones` lists which card kinds the
     *  grant covers; `maxManaValue` optionally caps the spell half. Idempotent
     *  per player: a repeated grant UNIONS the zones and a broader
     *  (`undefined`) `maxManaValue` always wins over a narrower one. Cleared
     *  unconditionally at CLEANUP (CR 514.2), same boundary as
     *  `restrictSpellCasting`. See the `grantGraveyardPlay` Op doc
     *  (`convex/cards/types.ts`) for the full parameter shape. */
    grantGraveyardPlay: (
        playerId: string,
        zones: Array<"land" | "spell">,
        maxManaValue?: number
    ) => void;
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
    /** Grants `playerId` PROTECTION FROM EVERYTHING until their next turn
     *  (CR 702.16b/e/i applied to a player via CR 115.4 — The One Ring): they
     *  can't be the target of any spell or ability, and all damage that would
     *  be dealt to them is prevented. No source exception — their own spells
     *  and sources are barred too. Idempotent per player (CR 702.16m);
     *  the grant is dropped at the START of that player's next turn. */
    setPlayerProtectionFromEverything: (playerId: string) => void;
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
     *  it can't be regenerated for the rest of the turn (CR 701.19c). Suppresses
     *  both regeneration shields and the continuous `"auto-regenerate"`
     *  replacement on that permanent. Cleared at CLEANUP. No-op if the source is
     *  no longer on the battlefield. Used by Clergy of the Holy Nimbus's "{1}:
     *  This creature can't be regenerated this turn." */
    setSourceCantBeRegeneratedThisTurn: () => void;
    /** Marks a TARGET creature so it can't be regenerated for the rest of the
     *  turn (CR 701.19c — the target-scoped twin of
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
     *  (band-expanded, CR 702.22h). A pure read of combat state for effects
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
     *  resolving instead of going to a graveyard (CR 707.10a).
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
     *  graveyard (CR 707.10a). Pair with `requestCopyRetarget` to let the
     *  copy's controller choose new targets for it. Distinct from
     *  `copyStackItem`, which copies a DIFFERENT spell still on the stack.
     *
     *  `modifications.controllerId` reassigns the copy's controller when the
     *  effect names a specific copier other than this spell's controller (Chain
     *  Lightning: the player who paid {R}{R} controls and retargets the copy,
     *  CR 707.10). Defaults to this spell's controller. */
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
     *  object, not a copy (CR 115.7 — "change the target(s) of a spell"). Enters
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
        zone: "battlefield" | "hand" | "library" | "graveyard" | "exile";
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
        /** `kind: "look-distribute"` only (issue #1266, Narset) — the subset of
         *  the looked-at `candidateIds` that may be KEPT (to `keepTo`). The
         *  whole `candidateIds` window is shown face-up ("look at the top
         *  four"), but a card outside `eligibleIds` can only be placed on the
         *  BOTTOM (Narset's "noncreature, nonland" filter). Omit = every
         *  looked-at card is keep-eligible (Impulse, Stock Up). */
        eligibleIds?: string[];
        /** The player ids the chooser may pick as a target (CR 115.1a).
         *  Two consumers:
         *   - `kind: "choose-damage-target"` (CR 115.4 "any target" includes
         *     players) — the submission carries either a damageable permanent
         *     id (from `candidateIds`) OR one of these player ids. Cuombajj
         *     Witches ("1 damage to any target of an opponent's choice").
         *   - `kind: "choose-player"` — a trigger-time player pick with no
         *     permanent branch (Endurance's "up to one target player"). The
         *     submission is one of these ids, or empty for "none". */
        candidatePlayerIds?: string[];
        /** For `kind: "order-top"` only — the second zone the un-kept looked-at
         *  cards go to (`library-bottom` scry / `graveyard` surveil / `none`
         *  order-only). Prefer the higher-level {@link SpellContext.orderTop},
         *  which raises this choice and applies the split for you. */
        destination?: LibraryDestination;
        /** `kind: "look-distribute"` only (issue #2070) — where the KEPT cards
         *  land: `"hand"` (every card shipped before #2070 — Impulse, Stock
         *  Up, Narset) or `"library-top"` (Thassa's Oracle). Orthogonal to
         *  `destination` above (the UN-kept cards' target). Client-routing +
         *  labelling hint (the picker's keep-pile reads "Hand" or "Top of
         *  library"); the GRE applies the actual move via the `lookDistribute`
         *  Op's own `keepTo`, not by reading this back off the choice. Always
         *  set at the one raise site (`lookDistribute`) — never left to an
         *  implicit default. */
        keepTo?: "hand" | "library-top";
        /** `look-distribute` only — the un-kept cards go to `destination` in a
         *  RANDOM order, so the submitted second-zone order is discarded
         *  server-side. The client mounts the simple grid pick (nothing to
         *  order) instead of the two-zone drag picker. Raised by the
         *  `lookDistribute` Op when `randomBottom` is set (Narset). */
        randomizeRest?: boolean;
        /** `look-distribute` (issue #1364, Atraxa) / `choose-categorized`
         *  (issue #1945) — a CATEGORIZED pick: each entry names a category
         *  and the ids that match it. Legality is the bipartite matching in
         *  `gre/categorizedPick.ts`. Omit for an ordinary uncategorized dig
         *  (Impulse, Narset). */
        categories?: { label: string; cardIds: string[] }[];
        /** Which of `gre/categorizedPick.ts`'s two legality rules applies
         *  (issue #1945). Omit = the injective rule (`count.max` is the
         *  matching's size — Atraxa). `"cover"` = every non-empty category
         *  must be answered and one member may answer several at once (a dual
         *  land, a gold card), so `count.min` is the smallest covering set.
         *  See {@link PendingChoice.categoryRule}. */
        categoryRule?: "cover";
        /** Bot POLICY hint for a categorized pick (issue #1945): whether
         *  being picked is the good half (`"picked-kept"` — the picks
         *  survive) or the bad half (`"picked-removed"` — the picks are what
         *  leaves). Never read by the rules engine. See
         *  {@link PendingChoice.pickPolarity}. */
        pickPolarity?: "picked-kept" | "picked-removed";
        /** Client-routing hint for a `choose-hand-card` pick whose destination is
         *  the TOP of the chooser's library, in chosen order (Brainstorm's
         *  `putBack`, CR 401.4). Purely a UI discriminator — the submit path and
         *  the GRE semantics are the ordinary `choose-hand-card` (the ordered
         *  `cardInstanceIds` ARE the top order). When set, the client mounts the
         *  ordered HAND→TOP drag picker instead of the in-hand toggle. */
        putOnTop?: boolean;
        /** `kind: "search-library"` only (CR 701.23a, issue #788 re-review
         *  finding 1) — mark this as a GENUINE library search (look at the
         *  whole library, filtered by characteristics) as opposed to a "look
         *  at the top N, pick one" prompt that reuses this `kind` for its
         *  restricted-candidate picker UI (Expressive Iteration, Diabolic
         *  Vision). `emitLibrarySearchedEvent` (CR 701.19a/603.2) only fires
         *  for a choice with this flag set — see {@link PendingChoice.isSearch}
         *  for the full rationale. Every genuine search `resolve()` site must
         *  set it; a look-pick site must NOT. */
        isSearch?: true;
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
        options: { id: string; label: string; color?: Color }[];
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
     *  card name, then reveals the top card of their library …") and the
     *  `nameCard` Effect Op (issue #1085). `excludeBasicLand` (CR 201.3,
     *  Desperate Research's "choose a card name OTHER THAN a basic land card
     *  name") stamps the raised `PendingChoice.nameRestriction` so
     *  `applyNameCardSubmit` (`pendingChoiceSubmit.ts`) rejects a basic-land
     *  name at submit time — the chooser is asked again, exactly like every
     *  other illegal-choice rejection in that pipeline. */
    requestNameCard: (req: {
        playerId: string;
        choiceId: string;
        prompt: string;
        excludeBasicLand?: boolean;
    }) => string | undefined;

    /** The card name of an instance in any zone, read from the card registry
     *  (CR 108.1 / 201.1). Resolves the instance's definition id to its printed
     *  name. Returns undefined if the id isn't on any player's
     *  library/hand/graveyard/exile/battlefield or its definition is unknown.
     *  Used to compare a revealed card against a named card (Petra Sphinx).
     *  Also powers `EffectCardFilter.name`'s picks-ref resolution (issue
     *  #1104, `resolveNameRef` in `gre/effects/interpreter.ts`): the
     *  instance id a `choice` Op bound (Lobotomy's "the chosen card")
     *  resolves to a name here, distinct from the `nameCard` Op's own
     *  binding shape which stores the name STRING directly (never a live
     *  instance id, so this lookup harmlessly misses and the caller falls
     *  back to the raw string). */
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

    /** Private sibling of `revealRandomHandCard` (CR 400.2 look, NOT CR
     *  701.20 reveal — Urza's Bauble): picks a card at random from `ownerId`'s
     *  hand via the game's seeded PRNG (deterministic on replay, like
     *  `flipCoin` / `discardCardsAtRandom`) and stamps it known to `knowerId`
     *  ALONE (`grantKnowledge`), so the looker sees the real card on the wire
     *  while every other player still sees a nulled slot. Returns the
     *  looked-at instance id, or undefined when the hand is empty (CR 608.2b).
     *  MUST be called only in the final, non-suspending segment of a
     *  resolution (draw the random bit exactly once). Used by the
     *  `lookRandomHand` Op. */
    lookRandomHandCard: (
        ownerId: string,
        knowerId: string
    ) => string | undefined;

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
    /** How many permanents are currently PARKED on an "as it enters" choice
     *  (`GameState.stagedEntries`, ADR 0100 D2). Interpreter plumbing like the
     *  three above: `runOpList` reads it either side of every Op, and a rise
     *  means THIS Op's battlefield entry parked — the script must then suspend
     *  exactly as if the Op had enqueued the choice itself, so the permanent
     *  finishes entering before any later Op runs (CR 614.12a) and the resume
     *  checkpoint survives (CR 608.3 — earlier Ops never replay). */
    stagedAsEntersCount: () => number;

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

    /** CR 614.12 — persists an as-enters NAME choice onto the permanent that
     *  is entering (issue #1953, Meddling Mage: "As this creature enters,
     *  choose a nonland card name"). Sibling of `setSelfBody`, sharing its
     *  recipient resolution: during a permanent spell's `resolveSteps` the
     *  recipient is the spell still on the stack (about to enter), during a
     *  later re-choice it is the source permanent on the battlefield.
     *
     *  Deliberately NOT folded into `setSelfBody`: a name is not part of a
     *  creature's BODY (P/T, subtypes, keywords) and nothing about it feeds
     *  the layer pipeline — it is a stored choice, the open-ended twin of the
     *  `chosenModeId` a modal permanent carries. Any "name a card as this
     *  enters" permanent (Nevermore, Runed Halo, Pithing Needle) reads it back
     *  the same way: a `cast-restriction` / guard predicate comparing
     *  `source.chosenName` against a candidate's name. */
    setSelfChosenName: (name: string) => void;

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

    /** Sacrifices a permanent controlled by its current controller (CR 701.21).
     *  No-op if the id is not on the battlefield. */
    sacrifice: (cardInstanceId: string) => void;
    /** CR 702.30a — Echo: clears the resolving trigger source's `echoPending`
     *  flag once its echo cost has been paid, so the echo trigger's
     *  intervening-if never fires again on a later upkeep. No-op if the source
     *  has left the battlefield. Called only by the echo trigger template
     *  (`abilities/echo.ts`). */
    markEchoPaid: () => void;

    /** Discards a specific card from `playerId`'s hand (CR 701.9). No-op if
     *  the card is no longer in hand. */
    discardCard: (playerId: string, cardInstanceId: string) => void;

    /** Stacks a regeneration shield on a permanent (CR 701.19a). The next
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

    /** CR 701.3a/701.3c (ADR 0065, issue #1311) — attach `sourceInstanceId`
     *  to `newHostId` without it leaving the battlefield. Generalizes
     *  `reattachAura` to any attachable permanent (Reconfigure's Equipment,
     *  or a future plain-Equip card, #776) rather than just Auras: unapplies
     *  the source's own static effects (grants to its old host, and any
     *  self-gated effect like Reconfigure's "isn't a creature while
     *  attached") then re-applies them against the new host. Works for a
     *  FIRST attach too (the source's prior `attachedTo` may be undefined —
     *  unapplying a no-op grant set is harmless). Returns false if either
     *  permanent isn't on the battlefield. */
    attachTo: (sourceInstanceId: string, newHostId: string) => boolean;

    /** CR 701.3d (ADR 0065, issue #1311) — unattach `sourceInstanceId` from
     *  whatever it's currently attached to, LEAVING it on the battlefield
     *  unattached (Reconfigure's second activated ability, CR 702.151a — "…
     *  Unattach this permanent"). An Aura instead goes to the graveyard via
     *  `checkAuraAttachmentSBA` (CR 704.5m); callers on an Aura should not use
     *  this. Returns false (no-op) if the source isn't on the battlefield or
     *  isn't currently attached. */
    detachFrom: (sourceInstanceId: string) => boolean;

    /** CR 205 / 110.1 — true iff the referenced object's card types include
     *  at least one PERMANENT type (Artifact/Battle/Creature/Enchantment/
     *  Land/Planeswalker). Mirrors `getManaValue`'s per-target-shape dispatch
     *  (permanent / spell / graveyard-card / hand-card); a graveyard-card or
     *  hand-card target must still be found in its owner's zone array, so
     *  read it BEFORE the object moves (pair with a `bind` snapshot for a
     *  later ref, same idiom `getManaValue`'s SNAP_MANA_VALUE slot uses).
     *  Used by "if it was a permanent card" templates (Lion Sash, issue
     *  #1311, CR 300.1). */
    isPermanentCard: (target: TargetSelection) => boolean;

    /** CR 205 / 201.2 — the referenced object's live card TYPES, SUBTYPES and
     *  NAME, or undefined when the object cannot be found. Same
     *  per-target-shape dispatch as `isPermanentCard` / `getManaValue`
     *  (permanent / spell / graveyard-card / hand-card), and — for a
     *  battlefield permanent — read off the INSTANCE, so a type/subtype
     *  changing continuous effect (CR 613 layer 4) is honored rather than the
     *  printed card.
     *
     *  The point of having it is CR 608.2h last-known information: paired with
     *  a `bind` snapshot taken BEFORE the object moves, it answers "what WAS
     *  that object" after the object is gone. That is not a convenience over
     *  reading the graveyard — it is the only correct source, because a TOKEN
     *  that leaves the battlefield ceases to exist (CR 704.5d) and is never in
     *  a graveyard to read. Minsc & Boo's "if the sacrificed creature was a
     *  Hamster" is exactly this case: the Hamster it is built to sacrifice is
     *  a token. */
    getCharacteristics: (
        target: TargetSelection
    ) => { types: string[]; subtypes: string[]; name: string } | undefined;

    /** Taps all lands controlled by `playerId` (CR 701.26a). Used by Mana
     *  Short and Drain Power. No-op for lands already tapped. */
    tapAllLands: (playerId: string) => void;

    /** Empties `playerId`'s mana pool and returns the drained amounts as a
     *  ManaCost (CR 106.4). Used by Mana Short (tap + drain) and Drain
     *  Power (tap + drain + transfer to caster). */
    drainManaPool: (playerId: string) => ManaCost;

    /** Increments `playerId`'s pending skip COUNT by 1 (CR 614.10 / 614.10a —
     *  issue #1957). `PlayerState.skipNextTurn` is a count, not a flag: two
     *  calls against the same player (Time Vault's ability twice, or a
     *  kicked Waterspout Elemental stacked with Time Vault) accumulate, so
     *  that player skips their next TWO turn occurrences rather than
     *  collapsing to one (CR 614.10a). `advanceTurn()` (phases.ts) decrements
     *  by 1 each time it lands on a player with a pending count, clearing it
     *  only once it reaches 0. Used by Time Vault and the `skipNextTurn`
     *  Effect Op (Waterspout Elemental). */
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
     *  scry (CR 701.22), Surveil (CR 701.25) and order-only "put them back in any
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
            /** CR 701.29 fateseal (issue #1532) — the player who MAKES the
             *  top/bottom decision when it is NOT the library owner
             *  (`playerId`). Jace, the Mind Sculptor's +2 looks at the TARGET
             *  player's library and the CONTROLLER decides. Omitted/equal to
             *  `playerId` = the library owner chooses (ordinary Scry / Surveil),
             *  the original behavior. Reuses the `PendingChoice.zoneOwnerId`
             *  chooser≠zone-owner seam (Fact or Fiction / Demonic Hordes). */
            chooserId?: string;
        }
    ) => boolean;

    /** Reads back the SECOND ordered list of an `order-top` / `look-distribute`
     *  choice at the current resolution step (the `secondZoneIds` the player
     *  submitted, stored under the `${step}:${choiceId}:second` key). Returns an
     *  empty array when the choice carried no second list (e.g. a bot/auto path
     *  that submitted only the primary picks). Pair with `requestChoice` for the
     *  primary list: `lookDistribute` reads the hand picks via `requestChoice` and
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
     *  event clears it (e.g. a library shuffle, CR 701.24). Idempotent; no-op
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
        /** Full printed mana cost (issue #1881 — `EffectCardFilter.
         *  manaCostEquals`'s exact structural comparison, CR 202). `undefined`
         *  for a definition-less instance, an unprinted `manaCost`, OR a Land
         *  (CR 202.1 — no printed land has a mana cost; issue #1898 finding
         *  2, `manaCostForCardFilter` in `gre/state.ts`) — `{}` stays a
         *  DISTINCT real encoding of the printed cost `{0}` for a non-land
         *  card (Ornithopter — Mishra's Factory/Workshop are Lands, the
         *  OPPOSITE branch). `matchesCardFilter` fails CLOSED
         *  on `undefined`. */
        cost: ManaCost | undefined;
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
        /** Full printed mana cost (issue #1881 — `manaCostEquals`, CR 202).
         *  `undefined` for a definition-less instance, an unprinted
         *  `manaCost`, or a Land (see `getHandCards`'s `cost` doc for the
         *  full rationale, issue #1898 finding 2). This is the field Urza's
         *  Saga III's `choice(zone: "library")` search restriction reads. */
        cost: ManaCost | undefined;
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
        /** Full printed mana cost (issue #1881 — `manaCostEquals`, CR 202).
         *  `undefined` for a definition-less instance, an unprinted
         *  `manaCost`, or a Land (see `getHandCards`'s `cost` doc, issue
         *  #1898 finding 2). */
        cost: ManaCost | undefined;
    }>;
    /** CR 404 / 400.7 — owner of the graveyard currently holding `id`, or
     *  undefined when the card isn't in any graveyard. Lets the interpreter
     *  resolve a graveyard-source `$source` (Ashen Ghoul's self-reanimation)
     *  to a `graveyard-card` selection without a battlefield presence check. */
    getGraveyardCardOwner: (id: string) => string | undefined;

    /** CR 108.1 — exile card characteristics from the registry (issue #1156).
     *  Mirrors `getGraveyardCards`, PLUS `counters` (CR 122.6) — the ONE zone
     *  snapshot that carries counters, because it's the only public-zone
     *  `choice` source a card needs to filter by counter type today (Dauthi
     *  Voidwalker: "an exiled card ... with a void counter on it", tagged by
     *  the graveyard-bound replacement's `tagCounters`, `gre/replacements.ts`).
     *  Empty for an empty exile. */
    getExileCards: (playerId: string) => Array<{
        id: string;
        name: string;
        types: CardType[];
        subtypes: string[];
        manaValue: number;
        colors: Color[];
        counters: Record<string, number>;
        /** Full printed mana cost (issue #1881 — `manaCostEquals`, CR 202).
         *  `undefined` for a definition-less instance, an unprinted
         *  `manaCost`, or a Land (see `getHandCards`'s `cost` doc, issue
         *  #1898 finding 2). */
        cost: ManaCost | undefined;
    }>;
    /** CR 400.7 — owner of the exile zone currently holding `id`, or undefined
     *  when the card isn't in any exile. Mirrors `getGraveyardCardOwner`. */
    getExileCardOwner: (id: string) => string | undefined;

    /** CR 111 (issue #791) — stamp the per-source exile provenance link on a
     *  card that already sits in exile: it becomes "a card exiled with
     *  `sourceInstanceId`", enumerable later via {@link getCardsExiledWith}.
     *  Orthogonal to the zone move — compose it AFTER a `moveCardById(... →
     *  "exile")` (or `exileFaceDown`) so the exile itself stays a plain zone
     *  operation (Necropotence's discard→exile becomes Currency Converter's by
     *  appending this stamp). No-op for an id not currently in any exile. The
     *  card stays in its OWNER's exile (CR 400.7); the link records the
     *  battlefield source regardless of who owns the exile. Cleared when the
     *  card leaves exile. */
    linkExileToSource: (
        cardInstanceId: string,
        sourceInstanceId: string
    ) => void;

    /** CR 111 (issue #791) — every card currently in ANY player's exile that was
     *  stamped (via {@link linkExileToSource}) as "exiled with
     *  `sourceInstanceId`". The retrieval half of the per-source exile linkage:
     *  Currency Converter's "Put a card exiled with this artifact into its
     *  owner's graveyard" reads this to build its pick list. Each entry carries
     *  the exile's `ownerId` (CR 400.7 — the card goes back to ITS owner's
     *  graveyard, not the source controller's) alongside the same characteristic
     *  snapshot as {@link getExileCards}. Empty when nothing is linked. */
    getCardsExiledWith: (sourceInstanceId: string) => Array<{
        id: string;
        ownerId: string;
        name: string;
        types: CardType[];
        subtypes: string[];
        manaValue: number;
        colors: Color[];
        counters: Record<string, number>;
    }>;

    /** CR 400.7 / 607 (issue #1947) — pick ONE card at random from the same
     *  linked pile {@link getCardsExiledWith} enumerates, drawn from the
     *  game's seeded PRNG so replays reproduce the same pick (mirrors
     *  `discardAtRandom`'s determinism). Returns the picked card's instance
     *  id and its OWNER's player id (CR 400.7 — the destination is the
     *  card's own owner, which may differ from the activating player), or
     *  undefined when the pile is empty (CR 608.2b — the caller no-ops).
     *  Backs the `randomExileToHand` Effect Op (Skyship Weatherlight:
     *  "Choose a card at random that was exiled with Skyship Weatherlight.
     *  Put that card into its owner's hand."). */
    pickRandomCardExiledWith: (
        sourceInstanceId: string
    ) => { id: string; ownerId: string } | undefined;

    /** Uniform random pick of ONE id from a caller-supplied list, drawn from
     *  the game's seeded PRNG — the SAME source `discardAtRandom`,
     *  `revealRandomHandCard` and {@link pickRandomCardExiledWith} draw from,
     *  so a replay reproduces the pick. Deliberately zone-agnostic and
     *  filter-agnostic: the CALLER enumerates and filters (`getGraveyardCards`
     *  + `PERMANENT_TYPES`, `getExileCards`, `getCardsExiledWith`, …) and this
     *  supplies only the random bit, which is the one capability no other
     *  primitive exposes on its own. Every pre-existing "at random" primitive
     *  hard-codes BOTH the pool and the destination
     *  (`pickRandomCardExiledWith` reads one linked exile pile;
     *  `discardAtRandom` reads a hand and discards) — composing this with the
     *  existing zone readers and `moveCardById` covers "at random" over any
     *  public zone with any filter without another card-shaped primitive.
     *  Returns undefined for an empty list, so the caller no-ops
     *  (CR 608.2b). */
    pickAtRandom: (ids: readonly string[]) => string | undefined;

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
     *  X / modal / additional-cost casts (CR 107.3 / 700.2c / 118.8, #579) ride
     *  on the same `opts`, all decided by the Acting Player from the controlled
     *  opponent's resources:
     *   - `chosenX` — the value of X (CR 107.3); folded into the generic cost
     *     (honoring `xFactor`) and snapshotted on the stack item for `getX()`.
     *   - `chosenModeId` — the chosen mode (CR 700.2c); written onto the stack
     *     item so the mode's `resolve` runs and its `staticEffects` apply.
     *   - `additionalSacrificeId` — a permanent on the CONTROLLED OPPONENT's
     *     battlefield to sacrifice as an additional cost (CR 118.8). It is
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
            /** CR 608.2f (issue #1477) — the zone the card is cast FROM.
             *  Defaults to `"hand"` (Word of Command's controlled cast). The
             *  cast-during-resolution Op passes `"graveyard"` (Malcolm) or
             *  `"exile"`. */
            sourceZone?: "hand" | "graveyard" | "exile";
            /** CR 601.2b / 608.2f (issue #1477) — cast WITHOUT paying the mana
             *  cost (Malcolm's free cast). Skips auto-tap/payment entirely; X in
             *  a waived cost is 0 (CR 107.3b). Additional costs (e.g. sacrifice)
             *  still apply. Defaults to false (pay normally). */
            free?: boolean;
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
    /** ADR 0037 / CR 118.8 — the `additionalCosts.sacrificeFilter` of a card in
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
    /** CR 608.2f / 305.1 (issue #1477) — for the cast-during-resolution Op: is
     *  the card `cardInstanceId` present in `playerId`'s `sourceZone` AND a
     *  castable (nonland) card? Lands are PLAYED, not cast (the official Malcolm
     *  land ruling), so a discarded land reports false and the Op passes
     *  silently. Also false when the card is absent from that zone (empty
     *  source, CR 608.2b) or has no registered definition. */
    getChosenCardCastable: (
        playerId: string,
        cardInstanceId: string,
        sourceZone: "hand" | "graveyard" | "exile"
    ) => boolean;
    /** CR 116.2a / 305.2a / 305.3 / 305.2b (issue #1961) — the LAND twin of
     *  {@link getChosenCardCastable}, for a play-during-resolution permission
     *  whose Oracle text says "play" rather than "cast" (Hideaway's "you may
     *  play the exiled card"). True iff `cardInstanceId` is in `playerId`'s
     *  `sourceZone`, IS a land, and playing it right now is legal:
     *   - CR 305.3 — it must be `playerId`'s turn. Otherwise "ignore any part of
     *     an effect that instructs a player to [play a land]", so the caller
     *     passes silently rather than erroring or stalling the resolution.
     *   - CR 305.2b — a land drop must remain (one per turn plus any extra-drop
     *     grants); a land played during a resolution counts against it
     *     (CR 305.2a).
     *   - CR 614 — no land-play lock is active (Worms of the Earth).
     *  A land is never CAST (CR 116.2a), which is why this is a separate lookup
     *  rather than a boolean flag on the castable lookup: the two answer
     *  questions about two DIFFERENT game actions. */
    getChosenLandPlayable: (
        playerId: string,
        cardInstanceId: string,
        sourceZone: "hand" | "graveyard" | "exile"
    ) => boolean;
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
    /** CR 603.7 / 514.3a — "at the beginning of the next cleanup step". A
     *  phase-boundary timing like its five siblings above, but the ONLY one
     *  whose step normally grants no priority at all: CR 514.3 says "Normally,
     *  no player receives priority during the cleanup step", and CR 514.3a is
     *  the single exception — a triggered ability waiting to be put onto the
     *  stack there (explicitly "including those that trigger 'at the beginning
     *  of the next cleanup step'") is put on the stack, the active player gets
     *  priority, and once the stack empties and all players pass, ANOTHER
     *  cleanup step begins. `gre/phases.ts` implements the TRIGGERED-ABILITY
     *  half of that check: the CLEANUP arm fires this timing AFTER the 514.1
     *  discard and the 514.2 turn-based actions, opens the priority window
     *  when something landed, and re-enters CLEANUP once the window closes.
     *
     *  NOT the state-based-action half. CR 514.3a's condition is "any
     *  state-based actions would be performed AND/OR any triggered abilities
     *  are waiting"; `openCleanupPriorityWindow`'s condition is only "the
     *  stack grew". `checkStateBasedActions` is never called from
     *  `gre/phases.ts` at all — the engine's SBA seam sits in the `game.ts`
     *  mutation layer, i.e. after `advancePhase` has already returned — so the
     *  canonical SBA case (an "until end of turn" pump ending at 514.2 drops a
     *  creature to 0 toughness) opens no window and starts no additional
     *  cleanup step; the death lands in the next turn's UPKEEP instead. That
     *  is an engine-wide phase-machine gap rather than a property of this
     *  timing: no phase entry anywhere checks SBAs. Documented in
     *  `docs/findings/2472-cleanup-step-sba-half.md`.
     *
     *  NOT a synonym for `next-end-step`: the cleanup step happens after the
     *  end step (CR 514), so the two are different, ordered boundaries.
     *  Deliberately absent from the CLEANUP watch purge in `gre/phases.ts` —
     *  it is a step boundary, not a "this turn" instance watch, and a purge
     *  that swept it would delete the instance in the very step it fires in.
     *  Rejects `targetPlayer` and `watch` like every other phase-boundary
     *  timing (validate.ts). */
    | "next-cleanup-step"
    /** CR 603.7a / 603.10 — an INSTANCE-scoped, this-turn-bounded leave-watch:
     *  "When that creature leaves the battlefield this turn, …" (Kjeldoran
     *  Elite Guard, Kjeldoran Guard, Phantasmal Mount). Unlike the
     *  phase-boundary timings it fires on a `PERMANENT_LEFT` event for one
     *  specific watched instance (`DelayedTriggerInstance.watchInstanceId`),
     *  not at a step boundary; any instance still pending expires unfired at
     *  CLEANUP (the "this turn" bound, CR 514.2). */
    | "leaves-battlefield"
    /** CR 603.7a / 603.10 (issue #1470) — the INDEFINITE twin of
     *  `leaves-battlefield`: same instance-scoped watch (`watchInstanceId`,
     *  same `PERMANENT_LEFT` match in `gre/triggers.ts`, dequeued on firing),
     *  but with NO "this turn" bound — it is deliberately EXCLUDED from the
     *  CLEANUP purge in `gre/phases.ts`, so the watch survives end of turn and
     *  still fires on a later turn. Earthbend N's third reminder sentence
     *  ("When it dies or is exiled, return it to the battlefield tapped.") has
     *  no turn bound at all; the purge encodes the "this turn" CLAUSE of the
     *  Kjeldoran-Guard wording (CR 514.2), not a general rule about
     *  leave-watches. Fires on ANY departure (`PERMANENT_LEFT` is emitted for
     *  every zone change off the battlefield, including a
     *  `graveyardDestinationFor` graveyard → exile redirect), exactly once. */
    | "leaves-battlefield-indefinite"
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
    | "this-turn-creature-blocks"
    /** CR 720.2 (Forth Eorlingas!, issue #1199) — a REPEATING, this-turn-
     *  bounded, combat-damage watch: "Whenever one or more creatures you
     *  control deal combat damage to one or more players this turn, you
     *  become the monarch." Mirrors `this-turn-creature-blocks`'s shape
     *  exactly (stays queued, purged only at CLEANUP) but collapses EVERY
     *  matching `DAMAGE_DEALT` event within one `collectTriggers` batch into
     *  AT MOST ONE firing per delayed-trigger instance per batch — the "one or
     *  more creatures … one or more players" wording exists precisely to
     *  prevent a single damage step's several simultaneous hits from
     *  firing this ability more than once (official ruling: "this ability
     *  still triggers only once" for simultaneous damage). A LATER, separate
     *  damage step (an extra combat) fires it again — becoming monarch is
     *  idempotent (CR 720.2) so a redundant firing is harmless. Rejects
     *  `targetPlayer` / `watch` like `this-turn-creature-blocks`. */
    | "this-turn-creature-deals-combat-damage-to-player"
    /** CR 603.7a / 509.1h — an INSTANCE-scoped, this-turn-bounded
     *  UNBLOCKED-ATTACK watch: "This turn, when target creature you control
     *  attacks and isn't blocked, …" (Delif's Cone, Delif's Cube). Shares the
     *  leave-watch SHAPE rather than the repeating-combat-watch one: it names
     *  ONE watched instance (`DelayedTriggerInstance.watchInstanceId`, so
     *  `watch` is required), fires on that instance's `ATTACKER_UNBLOCKED`
     *  event — emitted once per unblocked attacker when blockers are confirmed
     *  (CR 509.1h) — and is DEQUEUED by firing ("when", not "whenever": it
     *  happens at most once). Any instance still pending expires unfired at
     *  CLEANUP (the "this turn" bound, CR 514.2).
     *
     *  The watched creature need not be attacking when the trigger is
     *  scheduled: the effect arms a watch for the rest of the turn, so a
     *  creature that attacks in a LATER combat phase this turn still fires it.
     *  The body reads the creature back through the normal capture path
     *  (`{ ref: "$c" }`) — the watched instance is still on the battlefield at
     *  fire time (unlike a leave-watch), so `runDelayedTriggerBody`'s
     *  battlefield seed re-snapshots it live and `{ ref: "$c.power" }` reads
     *  its EFFECTIVE power (CR 613) at resolution. `$event` stays illegal
     *  here, exactly as for the leave-watch timings. */
    | "attacks-unblocked"
    /** CR 606 / 603.7a / 506.2 (issue #2385) — a REPEATING window, bounded
     *  "until your next turn" rather than "this turn": "Until your next
     *  turn, whenever a creature attacks you or a planeswalker you control,
     *  …" (Tamiyo, Seasoned Scholar's +2). Shares `this-turn-creature-
     *  blocks`'s repeating SHAPE (stays queued after firing, the firing
     *  event is threaded onto the built StackItem so the body may read
     *  `$event` directly) but a DIFFERENT bound: it is deliberately excluded
     *  from the CLEANUP purge (`gre/phases.ts`) — same precedent as
     *  `leaves-battlefield-indefinite` for a timing surviving CLEANUP — and
     *  is instead purged at the START of the delayed trigger's OWN
     *  controller's next turn (`advanceTurn`, `gre/phases.ts`), the same
     *  "until your next turn" boundary `playerProtectionFromEverything` /
     *  `castTimingFlashGrants` use.
     *
     *  Fires once PER ATTACKER named in an `ATTACKERS_DECLARED` event whose
     *  `attackingPlayerId` is NOT this instance's controller — CR 506.2:
     *  during the combat phase of a two-player game, the nonactive player
     *  is the defending player, and only that player (or planeswalkers
     *  they control) may be attacked, so in this engine's 2-player scope
     *  "the attacking player isn't the instance's controller" already
     *  identifies every attacker in the batch as attacking the controller
     *  (or their planeswalker). Unlike
     *  `BLOCKERS_CONFIRMED` (already one event per attacker/blocker pair),
     *  `ATTACKERS_DECLARED` carries the WHOLE batch as one event
     *  (`attackerIds: string[]`) — `collectTriggers` (`gre/triggers.ts`)
     *  builds one synthetic single-attacker `ATTACKERS_DECLARED` event per
     *  attacker so the body can read `{ ref: "$event.soleAttacker" }`,
     *  reusing the EXISTING `soleAttacker` `EVENT_FIELD_REGISTRY` row (ADR
     *  0049) rather than adding a new one — a length-1 `attackerIds` array is
     *  exactly what that row already flattens. Rejects `targetPlayer` /
     *  `watch`, like the other repeating combat-event timings. */
    | "until-next-turn-creature-attacks-you";

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
     *  serialized references (ids) chosen at scheduling time. Mutually
     *  exclusive with `effects` (ADR 0045, issue #1280). */
    resolve?: (ctx: SpellContext, payload: Record<string, string>) => void;
    /** Effect Script alternative to `resolve` (ADR 0045, issue #1280): an
     *  ordered Op list run through `runDelayedTriggerBody`
     *  (`gre/effects/interpreter.ts`) — the SAME payload-binding + interpreter
     *  seam the Effect-Script-scheduled INLINE delayed-trigger body already
     *  uses (`delayedTrigger` Op, ADR 0048); this is the template-path twin
     *  for card defs that declare the trigger up front instead of scheduling
     *  an inline body. The captured scalar `payload` (template-path triggers
     *  never carry list-valued captures, ADR 0049) is bound into the
     *  interpreter's environment before the script runs. Mutually exclusive
     *  with `resolve`. */
    effects?: EffectOp[];
    /** AI-only SHADOW Effect Script for a `resolve()` body (PRD #1423, issue
     *  #1519 — extended to `delayedTriggers[]` by PR #2010's review, MINOR
     *  7): never executed, only walked by `OP_VALUERS` so the bot's value
     *  model can see what an imperative delayed-trigger body does. Same
     *  contract as `CardDefinition.aiEffects` / `ActivatedAbility.aiEffects`
     *  / `TriggeredAbility.aiEffects`. Meaningless alongside `effects` (a
     *  real script is already valued). */
    aiEffects?: EffectOp[];
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
    /** CR 702.122b — this creature's "crews Vehicles as though its power were N
     *  greater" bonus (`CardDefinition.crewPowerBonus`), carried on the VIEW so
     *  the client's crew affordability hint (`getStackAbilities`) can weigh a
     *  candidate exactly as the server does. Populated by
     *  `buildTriggerStateView` from the definition; absent = 0. */
    crewPowerBonus?: number;
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
    /** CR 400.7 — the turn number on which this object ENTERED the battlefield
     *  (`CardInstanceState.enteredOnTurn`, stamped by `markEnteredThisTurn`).
     *  Deliberately NOT interchangeable with {@link isSummoningSick}: gaining
     *  control of a permanent re-sets summoning sickness but is not entering
     *  the battlefield, and summoning sickness survives the whole of the
     *  opponent's turn. Compare against `StaticEffectStateView.turn` for an
     *  "entered this turn" gate (Chaos Lord's "can attack as though it had
     *  haste UNLESS it entered this turn"). Undefined on a permanent that
     *  carries no entry stamp (anything staged without going through
     *  `markEnteredThisTurn`) — that is "unknown", NOT "entered on an earlier
     *  turn". A gate reading this field MUST require it to be defined before
     *  concluding anything, and resolve the undefined case the conservative
     *  way: for a permission GRANT that means withholding the permission.
     *  `enteredOnTurn !== state.turn` alone is a fail-OPEN bug — `undefined`
     *  compares unequal to every turn number.
     *  Survives the wire projection: `SlimCardInstance` is
     *  `Omit<CardInstanceState, "card">`, so the stamp reads identically
     *  server-side and after `projectPublicState`. */
    enteredOnTurn?: number;
    /** CR 702.30a — Echo: true while this permanent still owes its echo cost
     *  (it came under its controller's control and has not yet had its first
     *  upkeep under that control). Read by the echo trigger's CR 603.4
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
    /** CR 614.12 as-enters NAME choice (issue #1953 — Meddling Mage: "As this
     *  creature enters, choose a nonland card name"). The open-ended twin of
     *  `chosenModeId`'s fixed-set pick: stamped onto the entering permanent by
     *  `SpellContext.setSelfChosenName` and read back by whatever continuous
     *  effect the name feeds — for Meddling Mage a `cast-restriction` static
     *  comparing it against the name of the spell about to be cast. Mirrors the
     *  `CardInstanceState` field. */
    chosenName?: string;
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
    /** CR 702.109a — true iff this permanent was cast for its Dash cost (set
     *  on the stack item at cast commit when the chosen alternative cost ===
     *  `CardDefinition.dash`; rides onto the entering permanent for free, the
     *  `escaped`/`evoked` precedent). Read by the `dashTrigger` template's
     *  `condition` ("if its dash cost was paid, it gains haste and is
     *  returned to hand at the next end step") — a check-time (CR 603.4)
     *  predicate, not an intervening-if: the flag cannot change between the
     *  ETB event firing and this trigger resolving, so no resolve-time
     *  re-check plumbing is needed. */
    dashed?: boolean;
    /** CR 307.1 / 117.1a / 601.3a — true iff this permanent was cast at a
     *  moment a sorcery couldn't have been cast (set on the stack item at
     *  cast commit from the shared `wasCastOffSorceryTiming` predicate,
     *  `convex/gre/phases.ts`; rides onto the entering permanent for free,
     *  the `escaped`/`evoked`/`dashed` precedent). A pure snapshot of board
     *  state at cast time, not a legality verdict. No shipped trigger reads
     *  this yet — the shape matches `evoked`/`dashed` exactly (a
     *  check-time, CR 603.4 `condition` on a permanent's own ETB trigger,
     *  Necromancy's "the controller of the permanent it becomes sacrifices
     *  it at the beginning of the next cleanup step" — issue #2392) and the
     *  field cannot change after ETB, so no resolve-time re-check plumbing
     *  will be needed there either.
     *
     *  FRONTEND WIRING — populated only on the ENGINE path, where a trigger
     *  receives the raw `CardInstanceState`. The CLIENT's view reducer
     *  `buildTriggerStateView` (`src/lib/card-utils.ts`) enumerates its
     *  battlefield fields explicitly and carries neither `evoked`/`dashed`
     *  nor this one, so a condition reading `self.castOffSorceryTiming`
     *  client-side reads `undefined` today. No shipped card is affected (no
     *  consumer exists yet), but #2392 MUST extend that reducer as part of
     *  its own change — it is exactly the drop class
     *  `.claude/rules/gre-development.md` § Frontend wiring analysis
     *  describes. */
    castOffSorceryTiming?: boolean;
    /** CR 106.4 / 202.3 — per-colour mana spent to CAST this permanent,
     *  snapshotted from the originating stack item's `notedManaSpent`
     *  (`StackItem`, populated when `CardDefinition.noteManaSpent` is set) the
     *  instant it enters the battlefield (`resolveTopOfStack`). Distinct from
     *  `notedManaSpent` (ephemeral, read via `ctx.getNotedManaSpent()` during
     *  THIS resolution only): this field is a PERSISTENT record on the
     *  permanent, readable by a LATER triggered ability's `condition` (CR
     *  603.4 check-time predicate) — e.g. "when this enters, if {R}{R} was
     *  spent to cast it, ...". The shipped readers are the ECL Elemental
     *  Incarnations — Vibrance/Deceit/Wistfulness (`cards/sets/ecl/multicolor.ts`,
     *  issue #1927) — each of which gates two ETB triggers on this snapshot;
     *  paying their GUILD-HYBRID evoke cost ({R/G}{R/G}) with two mana of ONE
     *  colour records that colour twice here, so the matching half fires and
     *  the other does not. This field is the tracking half of #900. Undefined
     *  when the card doesn't opt into `noteManaSpent`. */
    notedManaSpentOnCast?: Record<string, number>;
    /** CR 702.33 / 614.1c — true iff this permanent's spell was cast with its
     *  Kicker cost paid, snapshotted from the resolving stack item's
     *  `kickerCount` the instant it entered the battlefield
     *  (`finalizeSpellResolution`, `gre/state.ts`). A ONE-SHOT fact fixed at
     *  resolution (CR 702.33) — nothing in the CR revisits it afterward —
     *  unlike a `+1/+1` counter count, which can change at any later point
     *  (a pump spell, `-1/-1` annihilation, CR 704.5q). That difference is
     *  what lets a materialized `keyword-grant` `applies` predicate gate on
     *  this field directly, replacing the counter-count PROXY the guard
     *  allowlisted for Pouncing Kavu / Duskwalker (issue #1716,
     *  `cards/sets/inv/red.ts` / `cards/sets/inv/black.ts`) — see
     *  {@link CardInstanceState.wasKicked} (`gre/state.ts`) for the full
     *  doc. Mirrors `evoked`/`dashed` above. Undefined for a permanent cast
     *  unkicked / without a Kicker cost. */
    wasKicked?: boolean;
    /** CR 702.33 (ADR 0079, issue #1950) — the PER-KICKER-ID twin of
     *  `wasKicked`, exposed for a two-Kicker permanent's own CR 603.4
     *  intervening-if ("if it was kicked with its {2}{U} kicker" — the
     *  Planeshift Battlemage cycle): `wasKicked`'s single boolean can say
     *  "kicked at all" but never WHICH of two, so each Kicker's own
     *  intervening-if reads this map by id instead
     *  (`self.kickerPayments?.["<id>"]`). Snapshotted the same instant and by
     *  the same write as `wasKicked` — see
     *  {@link CardInstanceState.kickerPayments} (`gre/state.ts`) for the full
     *  doc. Undefined for a permanent cast without a Kicker cost. */
    kickerPayments?: Record<string, number>;
    /** CR 107.3 / 601.2b — the value chosen for {X} in this permanent's own
     *  casting cost, snapshotted from the resolving stack item's `chosenX` the
     *  instant it entered the battlefield (`finalizeSpellResolution`,
     *  `gre/state.ts`). The read handle for any check-time predicate that runs
     *  after the spell has finished resolving: Ravenous (CR 702.156a, Jacked
     *  Rabbit) gates its ETB draw on a CR 603.4 intervening-if — "if X is 5 or
     *  greater" — which the engine re-evaluates when the TRIGGER resolves, by
     *  which point the creature spell's stack item (and `ctx.getX()` with it)
     *  is long gone. Deliberately NOT the +1/+1 counter count, which any later
     *  effect can change (issue #1753). See
     *  {@link CardInstanceState.chosenXOnCast} (`gre/state.ts`) for the full
     *  doc. Mirrors `wasKicked` / `notedManaSpentOnCast` above. Undefined for a
     *  permanent whose cost had no {X}, or that never resolved as a spell. */
    chosenXOnCast?: number;
    /** Raw card definition reference — predicates read manaCost for color, etc. */
    card: Record<string, unknown>;
    /** CR 707.2 / 202.3 — instance-level mana-cost override (an Eternalize /
     *  Embalm token's "except it has no mana cost"). Carried on the VIEW because
     *  the two derivations it changes — mana value and cost-derived colour —
     *  are read here as well as server-side, and the wire projection forwards
     *  the field. See {@link CardInstanceState.manaCostOverride} (`gre/state.ts`)
     *  and `getInstanceManaCost` (`cards/registry.ts`), the single reader. */
    manaCostOverride?: ManaCost;
}

/** Minimal read-only view of the battlefield used by characteristic-defining
 *  abilities (CR 604.3) whose value depends on board state — e.g. Nightmare's
 *  "P/T equal to Swamps you control". Intentionally a subset of the engine's
 *  full GameState so layer computation stays pure. */
export interface StaticEffectStateView {
    players: ReadonlyArray<{
        /** Opaque player handle (`controllerId`/`ownerId`, CR 102.1) — exposed
         *  so a self-referential board-state condition can find "you" inside
         *  `players[]` rather than assuming array position (issue #1379:
         *  Carnage Interpreter's "as long as YOU have one or fewer cards in
         *  hand"). Required, NOT optional like `hand` below: both literal
         *  constructors of this view (`gre/constants.ts`'s `manaLayerView`,
         *  `src/lib/effective-stats.ts`'s `toLayerState`) always have a real
         *  player id on hand at their call site — unlike hand data, there is
         *  no call site that would have to fabricate one. */
        id: string;
        battlefield: ReadonlyArray<PermanentView>;
        /** Cards in this player's graveyard, exposed for graveyard-counting
         *  characteristic-defining abilities (CR 604.3) — e.g. Lhurgoyf, whose
         *  power equals "the number of creature cards in all graveyards".
         *  Only `types` is needed by current CDAs; the array survives the wire
         *  projection (`PublicGameState.players[].graveyard` keeps `.types`,
         *  stripping only `.card`), so the count is identical server-side and
         *  after `projectPublicState`. */
        graveyard: ReadonlyArray<{ readonly types: readonly CardType[] }>;
        /** This player's hand, exposed ONLY as a count (mirrors
         *  `TriggerStateView.hand`, issue #1379) for a "you have N or fewer
         *  cards in hand" board-state gate — e.g. a `pt-buff`/`keyword-grant`
         *  `condition` (CR 611.2c "as long as ..."). Survives the wire
         *  projection unchanged: `PublicGameState.players[].hand` is
         *  `(SlimHandCard | null)[]` for an opponent (identity hidden, but the
         *  SAME length) and `SlimHandCard[]` for the owner, so `.length`
         *  reads identically server-side and after `projectPublicState`.
         *
         *  OPTIONAL — same "read best-effort" shape as `activePlayerId` below
         *  — because NOT every call site building this view from scratch has
         *  real hand data to offer (`gre/constants.ts`'s `manaLayerView`
         *  builds a battlefields-only view for a mana ability's P/T read and
         *  has no hand to report). A fabricated `{ length: 0 }` placeholder
         *  here was a real bug, not an inert stand-in: 0 is the TRUE answer
         *  for "≤ N cards in hand" for any N ≥ 0, so a hand-size `condition`
         *  silently read as satisfied at a call site that never had hand data
         *  to check. Every `condition`/`canActivate` closure reading this
         *  field MUST treat `undefined` as "unknown" and resolve the gate to
         *  `false` — the conservative direction for a "you have this few
         *  cards" claim the engine cannot currently verify — never fall back
         *  to a numeric default that could flip the predicate true. */
        hand?: { readonly length: number };
    }>;
    /** The player whose turn it currently is (CR 102.1). Optional because the
     *  layer system reads it best-effort: it is a top-level `GameState` field
     *  that survives the wire projection (`PublicGameState` keeps every
     *  GameState key except `players`/`stack`), so turn-conditional
     *  characteristic-defining abilities — e.g. Angry Mob, whose P/T is
     *  "2 plus opponents' Swamps during your turn, 2 otherwise" — can read it
     *  identically server-side and after `projectPublicState`. */
    activePlayerId?: string;
    /** CR 114 — command-zone emblems (issue #1221). Their continuous static
     *  abilities are collected owner-scoped by the layer system with no
     *  permanent source. Optional/read best-effort: a top-level `GameState`
     *  field that survives the wire projection unchanged, so an owner-scoped
     *  anthem emblem reads identically server-side and after
     *  `projectPublicState`. */
    emblems?: ReadonlyArray<EmblemInstance>;
    /** `GameState.turn` — the global per-player-turn counter (turn 1 = player
     *  one's first turn, turn 2 = player two's first turn, …), exposed so a
     *  CR 611.2c "as long as ..." gate can compare it against a permanent's
     *  {@link PermanentView.enteredOnTurn} entry stamp (CR 400.7) — Chaos
     *  Lord's "can attack as though it had haste UNLESS it entered this turn".
     *  Survives the wire projection unchanged (a top-level `GameState` field
     *  `projectPublicState` copies verbatim), so the gate reads identically
     *  server-side and client-side.
     *
     *  OPTIONAL — the same "read best-effort" shape as `activePlayerId` /
     *  `hand` above, because not every literal constructor of this view has a
     *  turn number on hand (`gre/constants.ts`'s `manaLayerView` builds a
     *  battlefields-only view for a mana ability's P/T read). Every
     *  `condition` closure reading this field MUST treat `undefined` as
     *  "unknown" and resolve the gate the CONSERVATIVE way — for a keyword
     *  GRANT that means withholding the keyword, never handing out a
     *  permission the real board might not allow. */
    turn?: number;
}

/** Read-only board snapshot for a `CardDefinition.entersTappedUnless`
 *  predicate (CR 614.1c) — deliberately narrower than `GameState`, mirroring
 *  `StaticEffectStateView` / `TriggerStateView`, so the same predicate stays
 *  frontend-safe (a client-side "will this enter tapped?" hint reads the
 *  identical shape the server evaluates). `turn` is `GameState.turn`, the
 *  global per-player-turn counter (turn 1 = player one's first turn, turn 2 =
 *  player two's first turn, …), kept for predicates that only care about the
 *  raw sequence number.
 *
 *  `activePlayerId` and each player's `turnsTaken` (issue #1871) exist so a
 *  predicate needing the CONTROLLER'S OWN turn ordinal (CR 500.1 — "your
 *  first, second, or third turn") never has to reconstruct it from `turn`
 *  plus a fixed-seat-rotation assumption: that reconstruction breaks
 *  permanently the first time either player takes an extra turn (CR 500.7,
 *  Time Walk/Time Warp) or has a turn skipped (CR 614.10), both of which
 *  desynchronize `turn` from a strict per-seat alternation. `turnsTaken` is
 *  already exact across both (`advanceTurn`, `gre/phases.ts`) — read it
 *  directly instead. Both fields are OPTIONAL, the same "read best-effort"
 *  shape as `hand`/`turn` above, since not every literal constructor of this
 *  view has a full `GameState` on hand; a predicate reading either MUST treat
 *  `undefined` as "unknown" and resolve conservatively (Starting Town: no
 *  `activePlayerId` match ⇒ treat as off-turn ⇒ enters tapped). */
export interface LandEntryStateView {
    players: ReadonlyArray<{
        id: string;
        battlefield: ReadonlyArray<PermanentView>;
        /** Count of turns this player has taken so far in the game (CR
         *  500.1), mirroring `PlayerState.turnsTaken` — see the interface
         *  doc comment above. */
        turnsTaken?: number;
    }>;
    turn: number;
    /** Id of the player whose turn it currently is (`GameState.activePlayerId`,
     *  CR 500) — see the interface doc comment above. */
    activePlayerId?: string;
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
    /** Number of counters of `type` on `card` (CR 122.1), read from
     *  `PermanentView.counters`. Returns 0 when the card carries no counters
     *  of that type. Mirrors `SpellContext.getCounterCount` (the DSL/spell
     *  side) so a static-effect `applies`/`condition` predicate can be
     *  conditioned on a permanent's counters too — e.g. a layer-6
     *  `keyword-grant` gated on "as long as this has a stun counter on it"
     *  (issue #1318). Evaluated whenever the owning predicate is: at
     *  layer-application time (ETB / a new matching permanent entering,
     *  `applySourceStaticEffects` / `applyExistingGrantsTo`) for
     *  `keyword-grant`, and at every read for the continuously-recomputed
     *  `pt-buff` / `pt-cda` kinds. */
    getCounterCount: (card: PermanentView, type: string) => number;
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
    /** Optional source-level gate (CR 611.2c — "as long as ..."), mirroring
     *  `StaticPTBuff.condition` (issue #1095, generalize-don't-add). Evaluated
     *  once per source against the whole board: when present and false, the
     *  grant is skipped this evaluation regardless of `applies`. Use for a
     *  board-state-conditional keyword like Kavu Runner ("This creature has
     *  haste as long as no opponent controls a white or blue creature").
     *  Unlike `pt-buff`/`pt-cda` (recomputed at every read), `keyword-grant`
     *  is MATERIALIZED into `target.staticAbilities` at apply time
     *  (`applySourceStaticEffects` / `applyExistingGrantsTo`), so a `condition`
     *  additionally requires the source to be picked up by
     *  `refreshCounterGatedStatics`'s per-SBA-pass sweep (`gre/state.ts`) to
     *  stay live as the board changes — the sweep re-runs `applies` AND
     *  `condition` fresh on every stable transition, the same "as long as"
     *  staleness fix already shipped for `dependsOnCounters`. */
    condition?: (
        source: PermanentView,
        state: StaticEffectStateView,
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

/** Continuous static ability that REMOVES card type(s) from a permanent
 *  (CR 205, 611, 1.3 — layer 4 type-setting effects, the subtractive
 *  counterpart of `StaticTypeAdd`). Mutates the affected permanent's `types`
 *  array imperatively on apply (and restores on unapply) via a per-`(source,
 *  type)` origin list, so unapplying one source only restores a type when no
 *  other source still suppresses it, and a NON-printed type is never
 *  restored. Used by Reconfigure (CR 702.151b — "Attaching an Equipment with
 *  reconfigure to another creature causes the Equipment to stop being a
 *  creature until it becomes unattached", issue #1311): a Reconfigure
 *  permanent's own static ability removes its own "Creature" type while
 *  `source.attachedTo` is set (`applies: (target, source) => target.id ===
 *  source.id && !!source.attachedTo`, i.e. `EFFECT_AFFECTS_SELF` combined
 *  with an attached check) — self-targeting, but the shape is general enough
 *  for a future HOST-targeting type-loss effect too. Like `StaticTypeAdd`,
 *  `applies` is read at apply time (attach/detach), not continuously
 *  recomputed — sufficient for the shipped scope (no card revokes a
 *  type-remove mid-attachment without also detaching). */
export interface StaticTypeRemove {
    kind: "type-remove";
    /** Predicate: does this removal apply to `target` given `source`? */
    applies: (
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Types to strip from the target while `applies` holds. */
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

/** Battlefield-scanned CAP on how many creatures may be DECLARED as attackers
 *  (`side: "attack"`, CR 508.1a) or as blockers (`side: "block"`, CR 509.1a) in
 *  a single combat. Caverns of Despair ("No more than two creatures can attack
 *  each combat. No more than two creatures can block each combat.") and Dueling
 *  Grounds (the same shape at one) are expressed with it.
 *
 *  It is the count-cap analogue of `global-attack-restriction`: scanned across
 *  EVERY permanent on the battlefield (the cap's source is a free-standing
 *  enchantment, not the attacker), so a source can constrain creatures other
 *  than itself — but where `global-attack-restriction` is a per-creature
 *  forbid/allow predicate, this kind is judged over the COMPLETE declared set,
 *  which no per-creature predicate can see. It is DATA rather than a closure so
 *  the one declaration drives every consumer that needs the NUMBER and not just
 *  a yes/no: the incremental toggle gates (`convex/game.ts`), the
 *  confirmation-time set check (`validateDeclaredAttackers` /
 *  `validateDeclaredBlockers`), the bot's declaration enumeration
 *  (`convex/gre/moves.ts`), and the client's board affordance
 *  (`useBattlefieldVisualState`), all through the single scanner
 *  `combatDeclarationCap` (`convex/cards/attackRestrictions.ts`).
 *
 *  Several sources stack by taking the MOST RESTRICTIVE (smallest) `max` — each
 *  is an independent restriction and a declaration must obey them all
 *  (CR 508.1c / 509.1b).
 *
 *  A cap is a RESTRICTION, so it outranks a must-attack REQUIREMENT: CR 508.1d
 *  obeys the maximum number of requirements possible without violating any
 *  restriction, which is why the confirm-time auto-include of required
 *  attackers stops at the cap rather than pushing past it. */
export interface StaticCombatDeclarationCap {
    kind: "combat-declaration-cap";
    id: string;
    /** Which declaration the cap constrains: the declare-attackers step
     *  (CR 508.1a) or the declare-blockers step (CR 509.1a). A card capping
     *  both (Caverns of Despair, Dueling Grounds) declares two entries. */
    side: "attack" | "block";
    /** Inclusive upper bound on the number of DISTINCT creatures that may be
     *  declared. On the block side it counts blocking creatures, not blocking
     *  assignments — one creature blocking two attackers (Two-Headed Giant)
     *  consumes one slot. */
    max: number;
    /** The single Oracle sentence for this side, surfaced as the rejection
     *  reason when the cap binds. */
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

/** Battlefield-scanned landwalk-negation static (CR 509.1b / 702.14). The
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
     *  reduction. Defaults to nothing.
     *
     *  See {@link CostReductionAmount} for the three accepted shapes. All are
     *  resolved by the single `resolveCostReductionGeneric` helper in
     *  `gre/state.ts` so fixed, count-driven and Domain-driven consumers can
     *  never drift apart. */
    costReduction?: CostReductionAmount;
    /** Floor on the post-reduction TOTAL mana of the cost (sum of all pips),
     *  CR 601.2f / 118.7. Power Artifact's reminder text: "This effect can't
     *  reduce the cost to less than one mana", i.e. `minTotalMana: 1`. A
     *  reduction never takes the total below this; colored pips are never
     *  touched, so the floor only ever protects generic mana. Ignored when no
     *  `costReduction` is present. */
    minTotalMana?: number;
}

/** Count-driven CR 601.2f cost-reduction amount: `perCount`'s generic portion
 *  is subtracted once per `countFilter`-matching permanent, evaluated at cast
 *  announcement against the reduction's own player's battlefield (Emry,
 *  Lurker of the Loch, ADR 0063). Reuses `PermanentFilter` — the existing
 *  permanent-filter vocabulary already shared by triggers/targeting/costs —
 *  rather than inventing a card-shaped count primitive (CLAUDE.md § Primitive
 *  reuse): "for each artifact you control" is `{ types: "Artifact" }`, and a
 *  future "costs {N} less per creature you control" needs no new field, just
 *  a different filter. */
export interface CountDrivenCostReduction {
    /** Mana subtracted PER matching permanent (generic-only, CR 601.2f — a
     *  count-driven reduction can't touch colored pips either). */
    perCount: ManaCost;
    /** What counts as one matching unit, matched against the reduction's own
     *  player's OWN battlefield only (never the opponent's board — CR 601.2f
     *  "you control"). */
    countFilter: PermanentFilter;
}

/** Domain-driven CR 601.2f cost-reduction amount (issue #1958): `perCount`'s
 *  generic portion is subtracted once per BASIC LAND TYPE among the lands the
 *  reduction's own player controls — 0–5, CR 305.6 — evaluated at cast
 *  announcement (Draco: "This spell costs {2} less to cast for each basic land
 *  type among lands you control"; Stratadon: {1} less).
 *
 *  A SEPARATE shape from {@link CountDrivenCostReduction} rather than a
 *  `dedupe` flag on its `countFilter`, because the thing being counted is
 *  different in kind: a permanent filter counts PERMANENTS (three Forests are
 *  three matches), Domain counts distinct basic land TYPES (three Forests are
 *  ONE, and a single Tundra contributes TWO). No filter over permanents can
 *  express that, so the count MODE is what varies, not the filter.
 *
 *  Consumes the SAME `countDomain` scan (`cards/types.ts`) every other Domain
 *  site already uses — `SpellContext.getDomain` / the `{ domain: { of } }`
 *  EffectValue, the Domain-scaled `StaticPTCDA.compute` closures, Collective
 *  Restraint's `costPerAttacker` — rather than recomputing Domain in the cost
 *  path (one execution path, CLAUDE.md § Primitive reuse). That also means the
 *  land types are read from the LIVE `subtypes` array on each battlefield
 *  instance, which layer-4 `subtype-set` / `subtype-add` statics materialize
 *  onto the instance (`applySourceStaticEffects`, `gre/state.ts`) — so a land
 *  whose type was added or changed counts correctly, CR 613.1d. */
export interface DomainDrivenCostReduction {
    /** Mana subtracted PER distinct basic land type (generic-only, CR 601.2f —
     *  a Domain-driven reduction can't touch colored pips either). Draco:
     *  `{ X: 2 }`; Stratadon: `{ X: 1 }`. */
    perCount: ManaCost;
    /** Discriminant: count basic land TYPES among the reduction's own player's
     *  lands (CR 702 preamble "Domain"), never permanents. The only mode today;
     *  a future census-style count mode adds a member here rather than a
     *  parallel interface. */
    countMode: "domain";
}

/** The amount a CR 601.2f cost reduction takes off the GENERIC portion of a
 *  cost. Three shapes, one resolver (`resolveCostReductionGeneric`,
 *  `gre/state.ts`):
 *
 *   - a fixed literal `ManaCost` — Stone Calendar, Power Artifact, Mana
 *     Matrix, Planar Gate;
 *   - {@link CountDrivenCostReduction} — `perCount` × matching PERMANENTS
 *     (Emry, affinity, ADR 0063);
 *   - {@link DomainDrivenCostReduction} — `perCount` × distinct basic land
 *     TYPES (Draco, Stratadon, issue #1958).
 *
 *  Discriminated structurally: `countFilter` for the count-driven shape,
 *  `countMode` for the Domain-driven one; no `ManaCost` mana-symbol key
 *  collides with either. */
export type CostReductionAmount =
    | ManaCost
    | CountDrivenCostReduction
    | DomainDrivenCostReduction;

/** CR 601.2f SELF-HOST cost reduction (ADR 0063): a spell's OWN intrinsic
 *  reduction to its own cast cost, declared directly on its `CardDefinition`
 *  rather than discovered via the battlefield `staticEffects` scan that
 *  `StaticCostModifier.costReduction` normally uses — the spell being
 *  announced isn't a permanent yet, so no battlefield-carried effect can find
 *  it. Emry, Lurker of the Loch: "This spell costs {1} less to cast for each
 *  artifact you control" is `{ costReduction: { perCount: { X: 1 },
 *  countFilter: { types: "Artifact" } } }` — she never counts herself since
 *  she isn't on the battlefield (or an artifact) at announcement time. Reuses
 *  the same `costReduction` / `minTotalMana` shape as `StaticCostModifier` so
 *  both apply sites in `getCostModifiers` (`gre/state.ts`) share one
 *  reduction-amount resolver. Spell-only — an activated ability has no "self"
 *  spell object to self-reduce. */
export interface SelfCostReduction {
    costReduction: CostReductionAmount;
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

/** Battlefield-scanned, SOURCE-side unpreventable-combat-damage static
 *  (CR 615.12 — "Some effects state that damage 'can't be prevented'. If
 *  unpreventable damage would be dealt, any applicable prevention effects are
 *  still applied to it. Those effects won't prevent any damage... Existing
 *  damage prevention shields won't be reduced by damage that can't be
 *  prevented").
 *
 *  The MIRROR IMAGE of {@link StaticCombatDamagePrevention}, and the reason it
 *  is a separate kind rather than a flag on it. That kind is TARGET-side: it
 *  is carried by the creature taking the damage, so the engine can find it by
 *  reading that one creature's own definition. This kind is carried by a
 *  permanent that is neither the source of the damage nor its recipient, and
 *  it speaks about a WHOLE CLASS of sources ("creatures you control"), so it
 *  can only be found by scanning every battlefield — the same live-query scan
 *  `StaticGlobalAttackRestriction` / `StaticPermanentGuard` use.
 *
 *  Consumed by `isCombatDamageUnpreventable` (`gre/combatDamagePrevention.ts`),
 *  the SINGLE predicate every combat-damage prevention chokepoint consults;
 *  the resulting boolean is threaded into the ALREADY-EXISTING `unpreventable`
 *  parameter that `SpellContext.dealDamage` / `runDamageReplacement` use for
 *  Urza's Rage's kicked mode, so source-side immunity has exactly one
 *  vocabulary in the engine rather than two.
 *
 *  Questing Beast (ELD) — "Combat damage that would be dealt by creatures you
 *  control can't be prevented": `self` is Questing Beast, `damageSource` any
 *  creature, and the predicate is "the source is a creature controlled by
 *  `self`'s controller". The immunity is Questing Beast's, so it ends the
 *  instant Questing Beast leaves the battlefield (CR 611.2 — this is a live
 *  query, never a state entry with a duration). */
export interface StaticCombatDamageUnpreventable {
    kind: "combat-damage-unpreventable";
    /** Stable id (for debugging / oracle tracing). */
    id: string;
    /** Returns `true` when COMBAT damage dealt BY `damageSource` can't be
     *  prevented (CR 615.12). Scoped to combat damage by the caller — the
     *  predicate never sees a noncombat damage event, so a source's
     *  activated-ability ping stays preventable as normal.
     *  `self` = the permanent carrying this effect (Questing Beast).
     *  `damageSource` = the permanent about to deal the combat damage.
     *  `state` = live board + block graph.
     *  `ctx` = static-effect helpers (colors, types, subtypes, ...). */
    unpreventable: (
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

/** Battlefield-scanned, PLAYER-scoped casting-TIMING lock (CR 601.3a —
 *  "a player can cast spells only any time they could cast a sorcery"). The
 *  timing analogue of `StaticCastRestriction`: rather than forbidding a CLASS
 *  of spell outright, it narrows the affected player's casting-timing window to
 *  sorcery speed for EVERY spell (even instants / flash cards), the way Teferi,
 *  Time Raveler's static — "Each opponent can cast spells only any time they
 *  could cast a sorcery" — locks its controller's opponents.
 *
 *  Like `cast-restriction` it is a read-time gate (never mutates a permanent,
 *  so it carries no per-instance flag and auto-reverts when the source leaves
 *  play) evaluated by the shared cast gate (`isCastTimingSorcerySpeedLocked`,
 *  `convex/cards/castRestrictions.ts`) that both `getLegalActions` and the cast
 *  mutation call. A lock BEATS any flash the spell has or a
 *  `grantCastTiming` permission — a "can cast only when" restriction overrides
 *  a permission (CR 101.2). */
export interface StaticCastTimingLock {
    kind: "cast-timing-lock";
    id: string;
    /** Returns `true` when `caster` is restricted to sorcery-speed casting by
     *  `source` (note the same inverted polarity as
     *  `StaticCastRestriction.forbids` / `StaticGlobalAttackRestriction.forbids`).
     *  `caster` = id of the player attempting to cast.
     *  `source` = the permanent carrying this effect (Teferi). */
    locks: (
        caster: string,
        source: PermanentView,
        state: StaticEffectStateView,
        ctx: StaticEffectContext
    ) => boolean;
    /** Oracle text displayed as the restriction reason. */
    oracleText: string;
}

/** CR 613.5 / 122.1 — counter dependency declaration, carried by EVERY static
 *  effect kind (issue #1711).
 *
 *  The engine splits static effects in two by HOW they reach the game state:
 *
 *   - **Recomputed** kinds (`pt-buff`, `pt-cda`, and the restriction/guard
 *     predicates) are evaluated at every read, so a counter-gated predicate is
 *     live for free — Homarid's tide counters need nothing here.
 *   - **Materialized** kinds (`keyword-grant`, `activated-grant`,
 *     `triggered-grant`, `type-add`/`type-remove`, `subtype-set`/`subtype-add`,
 *     `supertype-set`, `color`, `keyword-remove`, `control-change`, …) are
 *     WRITTEN ONTO the target instance once, by `applySourceStaticEffects`, at
 *     the moment the source or the target enters the battlefield. Nothing
 *     re-runs them afterwards, so a predicate reading `target.counters` /
 *     `ctx.getCounterCount(...)` goes stale the instant a counter changes: the
 *     untap step and `getEffectiveActivatedAbilities` read the materialized
 *     arrays, so the grant is silently absent (or silently stuck on).
 *
 *  Setting `dependsOnCounters: true` enrolls the effect's SOURCE in
 *  `refreshCounterGatedStatics` (`gre/state.ts`), the recomputation tick that
 *  unapplies and re-applies its grants whenever counters move. Set it whenever
 *  an `applies` / `condition` predicate reads counters on EITHER the target or
 *  the source — it is harmless (and ignored) on a recomputed kind.
 *
 *  Enforced catalogue-wide by
 *  `convex/cards/__tests__/counterGatedStatics.test.ts`: a materialized-kind
 *  predicate that reads counters without this flag fails CI. */
export interface CounterGatedStatic {
    dependsOnCounters?: boolean;
}

export type StaticEffect = (
    | StaticPTBuff
    | StaticPTCDA
    | StaticKeywordGrant
    | StaticControlChange
    | StaticActivatedGrant
    | StaticTriggeredGrant
    | StaticTypeAdd
    | StaticTypeRemove
    | StaticSubtypeSet
    | StaticSubtypeAdd
    | StaticSupertypeSet
    | StaticColorGrant
    | StaticUntapRestriction
    | StaticBlockRestriction
    | StaticAttackRestriction
    | StaticDeclaredAttackRestriction
    | StaticDeclaredBlockRestriction
    | StaticCombatDeclarationCap
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
    | StaticCombatDamageUnpreventable
    | StaticKeywordRemove
    | StaticAbilityLoss
    | StaticCastRestriction
    | StaticCastTimingLock
) &
    CounterGatedStatic;

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

/** The five basic land types' landwalk keyword (CR 702.14 landwalk variants
 *  restricted to CR 305.6 basics — no "desertwalk", since Desert isn't a
 *  basic land type), keyed by basic land subtype. Lives in this
 *  dependency-free leaf (not `gre/constants.ts`, which imports the card
 *  registry, `../cards`) so cross-set card files can import it directly
 *  without the set↔registry eval-time cycle `gre/constants.ts` documents at
 *  its own `LANDWALK_KEYWORDS` (the same constraint `BASIC_LAND_SUBTYPES`
 *  above exists to avoid). `gre/constants.ts`'s `LANDWALK_KEYWORDS` (keyword
 *  → subtype, the inverse direction, plus the non-basic `desertwalk` entry)
 *  derives from this table so the two can't drift. Consumers: Magnigoth
 *  Treefolk (`cards/sets/pls/green.ts`, Domain landwalk fan-out) and
 *  Traveler's Cloak (`cards/sets/inv/blue.ts`, chosen-land-type landwalk
 *  fan-out) — both used to hand-author an identical local copy of this
 *  table before this export existed. */
export const LANDWALK_KEYWORD_BY_BASIC_TYPE: Readonly<Record<string, string>> =
    {
        Plains: "plainswalk",
        Island: "islandwalk",
        Swamp: "swampwalk",
        Mountain: "mountainwalk",
        Forest: "forestwalk",
    };

/** "Basic land card" (CR 205.4a + CR 305.6) — a card with the `Basic`
 *  SUPERTYPE and the `Land` type. NOT "a land with a basic land SUBTYPE": a
 *  dual land (Tundra — `Land — Plains Island`, no supertype) carries basic
 *  land types but is nonbasic, and must never satisfy a "search your library
 *  for a basic land card" clause (Path to Exile, Erode).
 *
 *  Canonical predicate for the `resolve()`-side twin of the DSL's
 *  `choice(zone: "library").filter = { type: "Land", supertype: "Basic" }` —
 *  a `resolve()` card precomputing its `candidateIds` allow-list from
 *  `getLibraryCards` must filter through THIS, never through
 *  `BASIC_LAND_SUBTYPES` (which is a subtype constant and answers a different
 *  question: Domain, Magical Hack, choose-a-basic-type modes). */
export function isBasicLandCard(card: {
    types: readonly CardType[];
    supertypes: readonly CardSupertype[];
}): boolean {
    return card.types.includes("Land") && card.supertypes.includes("Basic");
}

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

/** CR 613 board-wide colour census tie-break (issue #1943) — ties a
 *  caller-supplied per-colour counter to the colour(s) tied for the maximum,
 *  or `[]` when no colour has ANY representation (the "no coloured
 *  permanents in play" case). A thin, context-agnostic core so both a
 *  continuous static effect's `StaticEffectStateView` read (`mostCommonColors`
 *  below) and a resolve()/activated-ability's `SpellContext` read share ONE
 *  tie-break rule rather than each reimplementing "which colour(s) are tied
 *  for the max". */
export function tallyMostCommonColors(
    perColor: (color: Color) => number
): Color[] {
    const COLORS: Color[] = ["W", "U", "B", "R", "G"];
    const counts = COLORS.map((c) => [c, perColor(c)] as const);
    const max = Math.max(0, ...counts.map(([, n]) => n));
    if (max === 0) return [];
    return counts.filter(([, n]) => n === max).map(([c]) => c);
}

/** CR 613 board-wide colour census read through a continuous static effect's
 *  board view — every colour tied for most common among ALL permanents both
 *  players control, of every card type (not creatures only). A multicoloured
 *  permanent counts toward EACH of its colours; `ctx.getColors` already
 *  resolves the EFFECTIVE, post-layer-5 colour (CR 613.1d `colorOverride`,
 *  granted colours), so a colour-changing effect shifts the census for free.
 *  A colourless permanent counts toward none. Returns `[]` when no permanent
 *  in play has a colour — the caller decides what that means (Heroic
 *  Defiance: bonus applies; Goham Djinn / Tsabo's Assassin: the -2/-2 doesn't
 *  trigger, since `mostCommon.includes(color)` is false against `[]`).
 *
 *  Mirrors `countDomain`'s shape: a shared board-scan helper, not a per-card
 *  closure. Originally a private `inv/black.ts` pair (Goham Djinn / Tsabo's
 *  Assassin); promoted here on its 3rd consumer (Heroic Defiance,
 *  `cards/sets/pls/white.ts`) per the "generalize, don't add" primitive-reuse
 *  rule rather than a third near-duplicate copy.
 *
 *  No CR 613.8 dependency-loop risk: this reads `ctx.getColors` (layer 5,
 *  already resolved by the time a layer 7 P/T read runs) to compute a LATER
 *  layer's (7a `pt-cda` / 7d `pt-buff`) contribution — it never feeds back
 *  into colour derivation itself, so there is no self-referential dependency
 *  to order. */
export function mostCommonColors(
    state: StaticEffectStateView,
    ctx: StaticEffectContext
): Color[] {
    const allPermanents: readonly PermanentView[] = state.players.flatMap(
        (p) => p.battlefield
    );
    return tallyMostCommonColors(
        (color) =>
            allPermanents.filter((p) => ctx.getColors(p).includes(color)).length
    );
}

/** Metalcraft (CR 702 preamble ability word, Mechanics Registry `metalcraft`
 *  row) — true when `controllerId` controls three or more artifacts (Mox
 *  Opal's "Activate only if you control three or more artifacts."). Mirrors
 *  `countDomain`'s shape: a shared board-scan helper (not a per-card closure)
 *  so a future Metalcraft card reuses this rather than re-deriving the count.
 *  Counts EVERY permanent whose live `types` include "Artifact" and whose
 *  `controllerId` matches — the scanning permanent itself included, so a
 *  metalcraft-conditioned mana rock counts toward its own threshold exactly
 *  like the printed ruling intends. Reads `TriggerStateView`, the same
 *  minimal live-board shape `canActivate` predicates receive (issue #947,
 *  `getManaTapOptionsDetailed` / `hasManaAbility`). */
export function hasMetalcraft(
    state: TriggerStateView,
    controllerId: string
): boolean {
    let count = 0;
    for (const player of state.players) {
        for (const permanent of player.battlefield) {
            if (permanent.controllerId !== controllerId) continue;
            if (!permanent.types.includes("Artifact")) continue;
            count++;
            if (count >= 3) return true;
        }
    }
    return false;
}

/** CR 702.151b — "Attaching an Equipment with reconfigure to another
 *  creature causes the Equipment to stop being a creature until it becomes
 *  unattached." Canonical `applies` for a Reconfigure permanent's own
 *  `type-remove` static effect: applies to ITSELF (`EFFECT_AFFECTS_SELF`),
 *  gated on currently being attached. Shared so every Reconfigure card
 *  composes the SAME predicate rather than re-deriving it inline (issue
 *  #1311, Lion Sash — first user). */
export const RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED: StaticTypeRemove["applies"] =
    (target, source) => target.id === source.id && !!source.attachedTo;

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
    | "SPELL_KICKED"
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
    | "CARD_PUT_INTO_GRAVEYARD"
    | "LIFE_LOST"
    | "LIFE_GAINED"
    | "COUNTER_REMOVED"
    | "COUNTER_ADDED"
    | "BECAME_TARGET"
    | "TOKENS_CREATED"
    | "CARDS_EXILED"
    | "LIBRARY_SEARCHED";

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
    /** The dying creature's OWNER (CR 108.3 / 400.7 — a card is always put into
     *  ITS OWNER's graveyard, regardless of who controlled it). Distinct from
     *  `creatureControllerId` for a control-changed creature (Control Magic).
     *  Read by owner-scoped death triggers — Enduring Renewal's "whenever a
     *  creature is put into YOUR graveyard from the battlefield" (issue #735),
     *  which is owner-based, not controller-based. Optional so older event
     *  fixtures / serialized logs without the field deserialize gracefully
     *  (a `condition` reading it simply sees `undefined`). */
    creatureOwnerId?: string;
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
    /** CR 601.2i — true only when this permanent entered by resolving as a
     *  CAST spell (`finalizeSpellResolution`). Every non-cast zone change onto
     *  the battlefield (reanimation, tutor-to-battlefield, hand-cheat, a land
     *  played, token creation) leaves this false/undefined. Mirrors
     *  `EntersBattlefieldReplacementEvent.wasCast` (issue #1148, Containment
     *  Priest) — an ETB-TRIGGER-facing counterpart of the same fact, needed by
     *  an "if you cast it" trigger condition (CR 603.4 — Lutri, the
     *  Spellchaser's "When Lutri enters, if you cast it, ..."). Optional/
     *  absent (rather than a hard `boolean`) so every existing
     *  `emitPermanentEntered` call site that has no reason to think about
     *  casting stays untouched — only the true cast-resolution chokepoint
     *  passes `true`. */
    wasCast?: boolean;
    /** CR 305.2 / 305.9 — true ONLY when this permanent entered as a LAND PLAYED
     *  as a special action (the play-land chokepoints: `settleEnteredLand` and the
     *  bot search `play-land` case). Every other zone change onto the battlefield
     *  (a fetched / tutored / reanimated land put there by an effect, token
     *  creation, a cast permanent) leaves this false/undefined. Read by "whenever
     *  you play a land" triggers (Fastbond's self-damage, City of Traitors'
     *  sacrifice) which must NOT fire on a land that merely ENTERS — CR draws a
     *  sharp line between "play a land" (305.1) and "a land enters" (603.6a).
     *  Mirrors `wasCast`'s "true only at the one real chokepoint" shape. */
    wasPlayed?: boolean;
    /** Effective power/toughness (CR 613.4) of the entering permanent,
     *  snapshotted at `emitPermanentEntered` — present ONLY when `types`
     *  includes "Creature" (a noncreature has no meaningful P/T). Read by an
     *  ETB trigger condition that inspects the entering creature's size
     *  ("a 1/1 creature you control enters" — Sword of the Meek, issue
     *  #1965). CR 603.2 evaluates a trigger condition against the game state
     *  WITH continuous effects applied — a `matches` predicate reading the
     *  entering permanent's raw stored `.power`/`.toughness` off
     *  `TriggerStateView` instead would silently disagree with a `+1/+1`
     *  counter or an anthem already active at the moment of entry. Mirrors
     *  `CREATURE_DIED.creaturePower`/`.creatureToughness` (same layer
     *  functions, same "snapshot before the state can change under you"
     *  shape). Optional so every pre-existing `PERMANENT_ENTERED` fixture /
     *  serialized log without the field deserializes as "no P/T reads
     *  available" rather than throwing. */
    power?: number;
    toughness?: number;
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
    /** Card subtypes snapshotted at the moment of departure (CR 205.3, issue
     *  #1191). Lets a subtype-scoped LTB trigger ("whenever you sacrifice a
     *  Clue") filter without re-reading the registry — mirrors `types` above.
     *  Optional so older serialized event fixtures without the field
     *  deserialize as "no subtypes" (a `filter.subtypes` match then simply
     *  fails, fail-closed). */
    subtypes?: ReadonlyArray<string>;
    /** Whether the leaving permanent was an Aura (CR 303.4). */
    wasAura: boolean;
    /** Host id the leaving Aura was attached to (CR 303.4b). Read by
     *  Animate Dead's LTB-trigger to identify the reanimated creature to
     *  sacrifice. Undefined for non-Aura permanents or unattached Auras. */
    attachedToBeforeLeave?: string;
    /** CR 603.10 (issue #1350) — instance ids of the permanents that were
     *  ATTACHED TO the leaving permanent at the moment it left (its Auras and
     *  Equipment). The reverse direction of `attachedToBeforeLeave`: that
     *  field is the leaving object's own host, this one is the set of things
     *  it was hosting. Read by a trigger living on the ATTACHMENT that fires
     *  when its host dies (Skullclamp — "whenever equipped creature dies,
     *  draw two cards"), which cannot use `self.attachedTo` because the
     *  attachment SBA (CR 704.5m, `sba.ts`) detaches it. Omitted when nothing
     *  was attached. */
    attachmentsBeforeLeave?: ReadonlyArray<string>;
    /** Destination zone of the move. */
    toZone: "graveyard" | "exile" | "hand" | "library";
    /** Why the permanent left the battlefield (CR 603.10). `"sacrifice"` is set
     *  only when the permanent was sacrificed (CR 701.21); `"destroy"` (issue
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
    /** Per-player counterpart of `priorSpellCount` (issue #1343): tally of
     *  spells cast by THIS EVENT'S CASTER (not any player) BEFORE this one,
     *  this turn (`PlayerState.spellsCastThisTurn` read prior to increment).
     *  Storm's `priorSpellCount` is a GLOBAL tally and cannot tell "P1's 1st +
     *  P2's 1st spell = 2 total" apart from "P1's 2nd spell" — a rules
     *  violation if used for a per-caster condition like connive's "whenever
     *  a player casts their second spell each turn" (CR 701.50, Ledger
     *  Shredder). `nthSpellThisTurn` (`cards/abilities/triggers/
     *  spellCastTrigger.ts`) is the reusable `spellCastTrigger.condition`
     *  built on top of this field. Optional for the same reason
     *  `priorSpellCount` is — pre-existing hand-built fixtures stay valid;
     *  the real emitter always sets it. */
    casterSpellCountThisTurn?: number;
}

/** "A player kicks a spell" (CR 702.33d, issue #1097) — emitted as part of
 *  CASTING a spell for which at least one Kicker cost was paid. Backs
 *  "whenever a player kicks a spell" triggers (Saproling Infestation,
 *  `inv/green.ts`); distinct from the `wasKicked` / `{ kickerPaid }` STATE
 *  reads (`gre/kicker.ts`), which answer "is this spell kicked" at resolution
 *  rather than "did someone just kick one".
 *
 *  ONE EVENT PER KICK, not per spell. CR 702.33d: "If a spell's controller
 *  declares the intention to pay any of that spell's kicker costs, that spell
 *  has been 'kicked.' If a spell has two kicker costs or has multikicker, it
 *  may be kicked multiple times." A Multikicker paid three times is three
 *  kicks, so a "whenever a player kicks a spell" ability triggers three times
 *  — three separate stack objects, each independently counterable. The
 *  emitter (`buildSpellKickedEvents`, `gre/kicker.ts`) therefore pushes
 *  `paidKickers`-many events, one per payment, all identical but for nothing:
 *  no card distinguishes the Nth kick from the first.
 *
 *  A COPY of a kicked spell emits NOTHING (CR 707.10 — "a copy of a spell
 *  isn't cast"). The copy still carries the original's `kickerPayments` (so it
 *  IS kicked for "if this spell was kicked" purposes, CR 707.10's "additional
 *  or alternative costs" clause), but no player paid a kicker for it, so no
 *  player kicked it. Enforced structurally, not by a flag: only the CAST choke
 *  point (`emitSpellCastEvent`) emits, and `cloneSpellOntoStack` never calls
 *  it. */
export interface SpellKickedEvent {
    type: "SPELL_KICKED";
    /** Player who kicked the spell — its controller as it was cast
     *  (CR 702.33d: "a spell's CONTROLLER declares the intention to pay").
     *  Named to mirror {@link SpellCastEvent.casterId}: the same player, from
     *  the same stack item, emitted in the same step. */
    casterId: string;
    /** Stack item id of the kicked spell. */
    spellInstanceId: string;
    /** Card definition id of the kicked spell. */
    spellCardId: string;
    /** `KickerCost.id` of the Kicker whose payment this event represents
     *  (ADR 0079 — a card may declare several independently payable Kickers).
     *  Lets a future "kicked with its [A] kicker" trigger discriminate without
     *  re-reading the stack item, and keeps the N events of a Multikicker
     *  attributable to the Kicker that produced them. */
    kickerId: string;
    /** Card types of the kicked spell. Mirrors {@link SpellCastEvent} so a
     *  filtered variant ("whenever a player kicks a creature spell") needs no
     *  new field and no stack lookup. */
    spellTypes: ReadonlyArray<CardType>;
    /** Card subtypes of the kicked spell. */
    spellSubtypes: ReadonlyArray<string>;
    /** Colors derived from the kicked spell's mana cost (CR 202.2). */
    spellColors: ReadonlyArray<Color>;
}

/** Tap event emitted whenever a permanent transitions from untapped to
 *  tapped (CR 701.26a). Carries `forMana: true` when the tap is paying the
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

/** Emitted when a permanent transitions tapped → untapped (CR 701.26b "becomes
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
 *  intervening-if condition (CR 603.4) is false at that moment. The stack
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
    /** Effective colour of the attacker at block confirmation (CR 202.2,
     *  layer 5 — `colorOverride` / granted colours included). Read by
     *  colour-gated combat-pairing triggers — Amphibious Kavu ("one or more
     *  blue and/or black creatures"). Carried directly on the event (rather
     *  than requiring a `TriggerStateView` lookup) so `matches` doesn't
     *  depend on the caller passing a colours-annotated state view; the
     *  production `collectTriggers` call passes the raw `GameState`, whose
     *  `CardInstanceState` has no live `colors` field of its own. Optional
     *  only so synthetic test events can omit it; the engine always
     *  populates it. */
    attackerColors?: ReadonlyArray<Color>;
    blockerId: string;
    blockerControllerId: string;
    blockerTypes: ReadonlyArray<CardType>;
    blockerSubtypes: ReadonlyArray<string>;
    /** Effective toughness of the blocker at block confirmation (CR 613).
     *  Twin of `attackerToughness` for the becomes-blocked direction. */
    blockerToughness?: number;
    /** Effective colour of the blocker at block confirmation (CR 202.2, layer
     *  5). Twin of `attackerColors` for the "blocks" direction. */
    blockerColors?: ReadonlyArray<Color>;
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
    /** 0-based index of THIS draw among the drawing player's draws this turn
     *  (CR 121.1) — the trigger-side twin of
     *  `DrawReplacementEvent.drawIndexThisTurn`, which reads the same
     *  `PlayerState.drawnThisTurn` field at the earlier replacement-discovery
     *  seam. Stamped by `emitCardDrawn` (`gre/state.ts`) so a batch draw fans
     *  out indices n, n+1, n+2, ... rather than N identical copies. Feeds
     *  "whenever a player draws their Nth card each turn" trigger conditions
     *  (`nthDrawThisTurn`, `cards/abilities/triggers/drawTrigger.ts` —
     *  Faerie Mastermind, issue #781). Optional so a pre-#781 hand-built
     *  event literal (tests predating this field) still type-checks;
     *  `nthDrawThisTurn` treats `undefined` as the drawing player's FIRST
     *  draw (index 0), mirroring `nthSpellThisTurn`'s own fallback
     *  convention for `casterSpellCountThisTurn`. */
    drawIndexThisTurn?: number;
    /** True only for the turn-based draw-step draw (CR 504.1) — the ONE card
     *  the active player draws as the draw step's turn-based action. The
     *  trigger-side twin of `DrawReplacementEvent.isTurnBasedDrawStepDraw`
     *  (Hullbreacher's replacement reads that one); this is what lets a
     *  TRIGGER exempt it — Orcish Bowmasters' "whenever an opponent draws a
     *  card except the first one they draw in each of their draw steps".
     *
     *  Deliberately REQUIRED, not optional: it is the fail-closed
     *  discriminator for a semantic no other field carries.
     *  `drawIndexThisTurn === 0` is only an approximation of it (a turn with
     *  two draw steps, or any draw taken before the draw step, makes the two
     *  diverge), and an optional field would let a future producer leave it
     *  `undefined` and silently read as "not the draw-step draw". Every
     *  producer goes through `emitCardDrawn` (`gre/state.ts`), whose own
     *  parameter is required for the same reason. */
    isTurnBasedDrawStepDraw: boolean;
}

/** Emitted whenever a card is discarded — moved from a player's hand to their
 *  graveyard by a discard (CR 701.9). One event per card, emitted AFTER the
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
    /** Player who discarded the card (its owner — CR 701.9). */
    playerId: string;
    /** Instance id of the discarded card, now in `playerId`'s graveyard. */
    cardInstanceId: string;
    /** Card definition id of the discarded card, so type-based filters can run
     *  without re-reading the graveyard. */
    cardId?: string;
    /** WHY the card was discarded, when the reason is one the rules care about.
     *  Absent for an ordinary discard (a rummage effect, the CR 514.1 cleanup
     *  hand-size discard, a random discard, a non-cycling discard cost).
     *
     *  This is a payload field on the ONE discard event, deliberately not a
     *  second event type: CR 702.29d — "Some cards have abilities that trigger
     *  whenever a player 'cycles or discards' a card. These abilities trigger
     *  only once when a card is cycled." A `CARD_CYCLED` event emitted beside
     *  this one would make Marauding Mako's "whenever you discard one or more
     *  cards" fire twice. One event, one trigger; "when you cycle this card"
     *  (CR 702.29c) is a predicate on this field. Same shape as
     *  `CardDrawnEvent.drawIndexThisTurn` / `CardMilledEvent.types`. */
    cause?: DiscardCause;
}

/** Why a `CARD_DISCARDED` event happened, for the reasons the CR distinguishes.
 *  `"cycling"` = CR 702.29c — "When you cycle this card" means "When you discard
 *  this card to pay an activation cost of a cycling ability", which per
 *  CR 702.29f includes a typecycling ability. Undefined means "an ordinary
 *  discard": the union is FAIL-CLOSED, so a discard producer that knows nothing
 *  about this field can never wrongly look like a cycling cost payment. */
export type DiscardCause = "cycling";

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

/** Emitted whenever a card is put into a graveyard by a GENERAL zone move —
 *  the residual "put into a graveyard from anywhere" (CR 603.6) entries that no
 *  more specific event covers.
 *
 *  Scope, stated as an exclusion so it can never double-fire (the producer
 *  census that defines it): the only emitters are the two general zone-change
 *  primitives `SpellContext.moveZone` / `moveCardById` and the CR 614
 *  reveal-bin (`binRevealedTopCard`), all three funnelled through
 *  `moveCardWithGraveyardReplacement` in `gre/state.ts`. Those primitives take a
 *  `MovableZone` (`library | hand | graveyard | exile` — the battlefield is NOT
 *  a member), so this event can never describe a battlefield death, and neither
 *  the discard choke point (`discardToGraveyard`) nor the mill choke point
 *  (`millCards`) routes through it. The three more specific events therefore
 *  partition cleanly against it:
 *
 *  | zone change                                | event                      |
 *  | ------------------------------------------ | -------------------------- |
 *  | battlefield → graveyard                    | CREATURE_DIED / PERMANENT_LEFT |
 *  | hand → graveyard, as a DISCARD (CR 701.9)  | CARD_DISCARDED             |
 *  | library → graveyard, as a MILL (CR 701.17) | CARD_MILLED                |
 *  | any other general move into a graveyard    | **this event**             |
 *
 *  That last row is exactly the gap it closes: "reveal the top four cards …
 *  put the rest into your graveyard" (Malevolent Rumble's `lookDistribute` with
 *  `destination: "graveyard"`) is NOT a mill (CR 701.17a), so it emitted
 *  nothing and a "put into a graveyard from anywhere" trigger — Worldspine
 *  Wurm's shuffle-back, Blightsteel Colossus's — silently failed to fire.
 *
 *  Emitted AFTER the card has landed, so a self-trigger can locate it in its
 *  destination zone (the `CARD_DISCARDED` / `CARD_MILLED` discipline). NOT
 *  emitted when a CR 614 graveyard-bound replacement (Yawgmoth's Will, Dauthi
 *  Voidwalker) redirected the move to exile — the card was never put into a
 *  graveyard. */
export interface CardPutIntoGraveyardEvent {
    type: "CARD_PUT_INTO_GRAVEYARD";
    /** Owner of the card, whose graveyard it now sits in (CR 404.3 — a card
     *  always goes to its OWNER's graveyard). */
    ownerId: string;
    /** Instance id of the card, now in `ownerId`'s graveyard. */
    cardInstanceId: string;
    /** Card definition id, so type-based filters can run without re-reading the
     *  graveyard. */
    cardId?: string;
    /** Zone the card came from, for a trigger that cares (never
     *  `"battlefield"` — see the scope note above). */
    fromZone: MovableZone;
    /** Card types snapshotted at the moment of the move (CR 603.10 last-known
     *  information), for "whenever a permanent card is put into …"-style
     *  filters. */
    types?: ReadonlyArray<CardType>;
}

/** Emitted whenever a player loses life (CR 119.3 — a player's life total
 *  decreasing, whether from a "lose life" effect, a paid life cost, or damage
 *  dealt to that player). One event per life-loss, emitted AFTER the life total
 *  has actually dropped (and after any CR 614 lifeloss replacement such as
 *  Lich), carrying the ACTUAL amount lost (post-replacement, post-prevention).
 *  Used by "whenever you lose life" triggers (Oath of Lim-Dûl — "for each 1
 *  life you lost, ..."). Every life-loss path — the `loseLife` primitive, paid
 *  life costs (CR 119.4), and all damage-to-player sinks (CR 119.3 — combat,
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
 *  A general primitive: Vanishing (CR 702.63a) listens for `counterType:
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

/** Counter-placement meta-trigger event (issue #1319, CR 122.1) — emitted
 *  whenever one or more counters of any kind are ADDED to a permanent via
 *  `SpellContext.addCounter`. Distinct from the counter merely EXISTING
 *  (e.g. a static "has a +1/+1 counter on it" check): this fires once per
 *  placement occurrence, mirroring `CounterRemovedEvent`'s shape and choke
 *  point so future "whenever a +1/+1 counter is put on ~" cards (Emperor of
 *  Bones' counter-synergy cousins, Agatha's Cauldron — #917) can listen for
 *  it generically, for ANY counter type, not just +1/+1 — a card-specific
 *  filter narrows `counterType` itself. `types`/`subtypes` snapshot the
 *  permanent's characteristics at emit time (CR 603.10 last-known-info
 *  style, mirroring `PermanentTappedEvent`) so a scope+filter trigger
 *  factory can gate on them without a live battlefield re-scan. */
export interface CounterAddedEvent {
    type: "COUNTER_ADDED";
    /** Instance id of the permanent the counters were added to. */
    instanceId: string;
    /** Controller of that permanent at the moment of placement. */
    controllerId: string;
    /** Kind of counter added (e.g. "+1/+1", "charge", "time"). */
    counterType: string;
    /** How many counters were actually added (always >= 1 — a zero-or-fewer
     *  request never emits, matching `addCounter`'s early return). */
    added: number;
    /** How many counters of `counterType` the permanent has after the
     *  placement (>= `added`). */
    total: number;
    /** Card types of the permanent, snapshotted at emit time. */
    types: ReadonlyArray<CardType>;
    /** Card subtypes of the permanent, snapshotted at emit time. */
    subtypes: ReadonlyArray<string>;
}

/** Target-declaration event (CR 603.2b / 115.5) emitted once PER TARGET when a
 *  spell or ability's targets are locked onto its stack object — at cast
 *  (`emitSpellCastEvent`), at activated-ability commit, and at targeted-trigger
 *  announcement (CR 603.3d). Drives "whenever ~ becomes the target of a spell
 *  or ability" triggers (Leovold, Emissary of Trest — issue #1265). The event
 *  resolves the targeted object's controller at emit time so a trigger's
 *  `matches()` can test "you or a permanent you control" with a single
 *  comparison and filter to an opponent's source without a battlefield scan. */
/** Which sort of stack object announced the targets that raised a
 *  `BECAME_TARGET` event (issue #2360). Three shapes exist in the engine and
 *  each producer names its own:
 *   - `"spell"` — a spell being CAST locks its announced targets (CR 601.2c).
 *     `emitSpellCastEvent` is the only site; a spell COPY put onto the stack
 *     never reaches it (CR 707.10 — a copy isn't cast), so it never claims this
 *     kind.
 *   - `"activated-ability"` — an activated ability's targets lock as it is put
 *     onto the stack (CR 602.2b), immediately or after deferred payment.
 *   - `"triggered-ability"` — a triggered ability's targets are chosen as it is
 *     put onto the stack (CR 603.3d), by the player or auto-selected when
 *     exactly one legal target exists. */
export type BecameTargetSourceKind =
    | "spell"
    | "activated-ability"
    | "triggered-ability";

export interface BecameTargetEvent {
    type: "BECAME_TARGET";
    /** The object that became a target — a permanent or a player. */
    target: TargetSelection;
    /** What KIND of stack object announced this target (issue #2360). The
     *  event fires for every targeting source — a cast spell (CR 601.2c), an
     *  activated ability and a triggered ability all announce targets — but
     *  oracle text routinely scopes to only one of them ("whenever you CAST A
     *  SPELL that targets…", Dack Fayden's emblem). `sourceControllerId` alone
     *  cannot tell them apart, and `sourceInstanceId` is an opaque stack-item
     *  id, so the producer declares it explicitly. REQUIRED, so a new producer
     *  cannot inherit a permissive default: an emblem/keyword scoped to
     *  "spell" fails CLOSED for anything a future emitter forgets to classify.
     *  Ward (CR 702.21a, "spell or ability") deliberately ignores it. */
    sourceKind: BecameTargetSourceKind;
    /** Controller of the targeted object at emit time: for a permanent target
     *  its `controllerId`; for a player target the player id itself. So "you or
     *  a permanent you control" is `targetControllerId === self.controllerId`. */
    targetControllerId: string;
    /** Controller of the spell/ability that did the targeting (CR 109.5). An
     *  "an opponent controls" filter is `sourceControllerId !==
     *  self.controllerId`. */
    sourceControllerId: string;
    /** Stack-item id of the SPECIFIC spell/ability that performed this
     *  targeting (CR 603.2b) — the `StackItem.id` whose `.targets` were just
     *  locked, distinct from `sourceControllerId` (that object's controller).
     *  Lets a reflexive "counter that spell or ability" trigger (Ward, CR
     *  702.21a/e) pin its own target to the EXACT object that caused THIS
     *  trigger instance (`gre/rules.ts` `raiseTriggerTargetSelection`), rather
     *  than to any stack object that merely also targets the same permanent —
     *  the fix for issue #1361's two-simultaneous-targeters edge. */
    sourceInstanceId: string;
}

/** Token-creation meta-trigger event (issue #1345, CR 111 / 707.2) — emitted
 *  ONCE per `createTokenPermanents` call, i.e. once per "create N tokens"
 *  occurrence, NOT once per individual token. This is a deliberately
 *  NARROWER purpose-built event than a generic `PERMANENT_ENTERED` fan-out
 *  (tokens don't emit `PERMANENT_ENTERED` at all today — every
 *  `emitPermanentEntered` call site is a spell-resolution/search/playLand
 *  path, none of them token creation) — see #1345's design note. The
 *  natural batching (one call already creates `count` copies of the SAME
 *  `TokenSpec`) matches the real-card wording precisely: Staff of the
 *  Storyteller's "whenever you create one or more creature tokens" fires
 *  ONCE per resolution that creates tokens, regardless of how many. A
 *  `tokenCreatedTrigger`-scoped ability filters by controller relation
 *  (scope) and by the snapshotted `types`/`subtypes` (a creature-token
 *  filter), mirroring `CounterAddedEvent`'s last-known-info snapshot style
 *  so no live battlefield re-scan is needed. */
export interface TokensCreatedEvent {
    type: "TOKENS_CREATED";
    /** Controller of the newly created tokens (CR 111.2 — token owner is its
     *  creator; controller matches at creation). This is the "you" in
     *  "whenever YOU create ..." — the beneficiary player, not necessarily the
     *  trigger source's controller (relevant for a control-changed source). */
    controllerId: string;
    /** How many tokens this SINGLE call created (>= 1 — the batching count;
     *  `createTokenPermanents` never emits for a zero/negative count). */
    count: number;
    /** Card types of the created tokens, snapshotted at emit time. All tokens
     *  from one call share the same `TokenSpec`, hence the same types. */
    types: ReadonlyArray<CardType>;
    /** Card subtypes of the created tokens (CR 205.3), snapshotted at emit
     *  time. Mirrors `types`. */
    subtypes: ReadonlyArray<string>;
}

/** Exile-to-zone meta-trigger event (issue #1558, CR 400.1 / 603.3b / 608.2i)
 *  — emitted ONCE per exile OCCURRENCE (a single primitive call / resolving
 *  instruction that moves one or more cards into exile), NOT once per card.
 *  Mirrors `TokensCreatedEvent`'s already-established "one event per call"
 *  batching discipline (issue #1345) — the official Laelia, the Blade
 *  Reforged ruling states the same rule explicitly: "This ability triggers
 *  only once for each time cards are put into exile this way, no matter how
 *  many cards were exiled at the same time." Every card in `cards` moved to
 *  exile in the SAME occurrence (a mill-then-exile redirect, an
 *  `exileWithAttachments` host+Auras bundle, a `moveZone` dump). Each entry
 *  carries its own `fromZone` because a batch is not required to share a
 *  single source (a hypothetical "exile a card from your hand and a card
 *  from your library" effect would still be one occurrence, two different
 *  `fromZone`s) — Laelia's "from your library and/or your graveyard" clause
 *  discriminates per card on this field, not on the batch as a whole. */
export interface CardsExiledEvent {
    type: "CARDS_EXILED";
    /** Cards exiled by this single occurrence. Always >= 1 entries — no
     *  emitting primitive calls `emitCardsExiled` with an empty batch. */
    cards: ReadonlyArray<{
        /** Instance id of the exiled card, now in exile. */
        cardInstanceId: string;
        /** Card definition id, so type-based filters can run without
         *  re-reading the exile zone. */
        cardId?: string;
        /** Zone the card was exiled FROM (CR 400.1 zone taxonomy). */
        fromZone: "library" | "graveyard" | "battlefield" | "hand" | "stack";
        /** Owner of the exiled card (CR 400.2 — constant across zone
         *  changes). For a library/graveyard/hand source this is also that
         *  zone's owner (each player owns exactly one of each), so "cards put
         *  into exile from YOUR library" reads as `fromZone === "library" &&
         *  ownerId === self.controllerId`. For a battlefield source this is
         *  the exiled permanent's owner, which may differ from whoever
         *  controlled it at the moment it left. */
        ownerId: string;
    }>;
}

/** Library-search event (CR 701.23a "search a library", 603.2 trigger
 *  condition) — emitted ONCE per completed `search-library` PendingChoice
 *  commit (issue #788, residual of the trigger-condition trio started by
 *  `BecameTargetEvent`/#1265 and `TokensCreatedEvent`/#1345: "whenever an
 *  opponent searches their library", Wan Shi Tong, Librarian). The single
 *  choke point every library search funnels through
 *  (`applyPendingChoiceSubmit`, `gre/pendingChoiceSubmit.ts`) regardless of
 *  whether the search was authored as a DSL `choice(kind:
 *  "search-library")` Op or an imperative `resolve()` tutor closure — every
 *  shipped tutor and fetchland already routes through the same
 *  `SpellContext.requestChoice` / PendingChoice commit path, so this one
 *  emit site covers the whole catalogue with no per-card wiring. Fires even
 *  on a zero-pick "whiff" search (a fetchland with no basic land left still
 *  SEARCHED, CR 701.23a — the ACT of searching is the trigger condition,
 *  not the result).
 *
 *  Carries BOTH the searcher and the library's owner (bugfix, issue #788
 *  post-review) because they are NOT always the same player: Jester's Cap /
 *  Jester's Mask / Lobotomy have the ACTIVATING player search a TARGET
 *  player's library ("Search target player's library..."). A single
 *  `playerId` field cannot distinguish "an opponent searches THEIR OWN
 *  library" (the only condition any shipped `librarySearchedTrigger` card
 *  cares about, CR 701.23a "searches a library" always names whose library)
 *  from "the controller searches someone else's library" — collapsing them
 *  let Wan Shi Tong's own controller trigger a free counter+draw by casting
 *  Lobotomy. `librarySearchedTrigger`'s `matchesLibrarySearchedScope` gates
 *  on `playerId === libraryOwnerId` before applying scope, so a
 *  Jester's-Cap-shaped cross-library search never fires. */
export interface LibrarySearchedEvent {
    type: "LIBRARY_SEARCHED";
    /** The player who performed the search (CR 701.23a) — the ACTING
     *  searcher (the stack item's controller), not necessarily the library's
     *  owner. For the ordinary "target player searches THEIR library" case
     *  this equals `libraryOwnerId`; for a Jester's Cap/Lobotomy-shaped
     *  "search TARGET PLAYER's library" this is the caster, and
     *  `libraryOwnerId` is the target. */
    playerId: string;
    /** Owner of the library actually searched (CR 701.23a). The "opponent"
     *  in "whenever an opponent searches THEIR library" is judged against
     *  this field, relative to the trigger source's controller — and ONLY
     *  when it equals `playerId` (a genuine "searches their own library"),
     *  per the field-split rationale above. */
    libraryOwnerId: string;
}

export type GameEvent =
    | DamageDealtEvent
    | PhaseBeginEvent
    | CreatureDiedEvent
    | PermanentEnteredEvent
    | PermanentLeftEvent
    | SpellCastEvent
    | SpellKickedEvent
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
    | CardPutIntoGraveyardEvent
    | LifeLostEvent
    | LifeGainedEvent
    | CounterRemovedEvent
    | CounterAddedEvent
    | BecameTargetEvent
    | TokensCreatedEvent
    | CardsExiledEvent
    | LibrarySearchedEvent;

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
            /** P/T as the reader should weigh it. The frontend reducer
             *  (`buildTriggerStateView`) fills these with EFFECTIVE values —
             *  the CR 613.4 layer pipeline applied, counters (7c) and
             *  anthems/pump (7d) included — so an affordability hint agrees
             *  with the server's own `getEffectivePower` instead of diverging
             *  on base P/T (the Crew N divergence, CR 702.122a). */
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
            /** Tap state (CR 701.26a). Exposed so a frontend affordability hint
             *  for a `tapOtherFilter` activation cost (Hand of Justice) can
             *  count untapped matching permanents the controller controls. */
            isTapped?: boolean;
            /** Layer-5 colour override / printed colours, when derivable
             *  (CR 202.2 / 613.1d). Populated by the engine where available so a
             *  `tapOtherFilter` colour clause ("white creatures") reads the same
             *  colour the rest of the engine sees. */
            colors?: ReadonlyArray<Color>;
            /** CR 702.122b — "crews Vehicles as though its power were N
             *  greater" (`CardDefinition.crewPowerBonus`). Exposed so the
             *  frontend's Crew N affordability hint weighs a candidate exactly
             *  as the server's `tapOtherContribution` does. */
            crewPowerBonus?: number;
            /** CR 205.4a — LIVE supertypes (Basic/Legendary/Snow/World), for a
             *  `sacrificeFilter` activation-cost affordability hint that
             *  narrows by supertype (Sunstone's "Sacrifice a snow land",
             *  Glacial Crevasses' "Sacrifice a snow Mountain", Whiteout's
             *  "Sacrifice a snow land"). Populated by `buildTriggerStateView`
             *  via `liveSupertypesOf` (`convex/cards/snowReads.ts`) — printed
             *  supertypes overlaid by any `grantedSupertypes`/
             *  `removedSupertypes` mutation (Melting / Arcum's Weathervane),
             *  the SAME live authority the server resolves the cost with
             *  (`activateAbilityOnState`). Printed-only was a dead affordance:
             *  a Weathervane'd land activated server-side while this hint hid
             *  the ability client-side (issue #2235 review). The may-pay
             *  permanent-leg matcher (`toMatchablePermanent`,
             *  `src/lib/card-utils.ts`) still reads PRINTED-only supertypes —
             *  latent only (no shipped may-pay permanent-leg filter uses
             *  `supertypes`/`excludeSupertypes` yet), left as-is here; see
             *  that function's own comment. */
            supertypes?: ReadonlyArray<string>;
            /** CR 508/509 — combat-role filters (a `sacrificeFilter`/
             *  `tapOtherFilter` scoped to attackers/blockers). Mirrors
             *  `PermanentFilter.isAttacking`/`isBlocking`'s exact semantics
             *  (`card.isAttacking === true`). Populated from the raw
             *  `CardInstanceState` fields (issue #1951 review round 3). */
            isAttacking?: boolean;
            isBlocking?: boolean;
            /** CR 111 / 707.1 — token provenance, for a `sacrificeFilter`/
             *  `tapOtherFilter` cost scoped to "tokens created with <this>"
             *  (Tetravus-style). Populated from the raw
             *  `CardInstanceState.createdBy` field, which crosses the wire
             *  unchanged (issue #1951 review round 3). */
            createdBy?: string;
            /** CR 400.7 — "entered the battlefield this turn". Only
             *  populated when `buildTriggerStateView`'s optional
             *  `turnState` param is supplied (mirrors
             *  `toMatchablePermanent`'s identical turn-scoped derivation) —
             *  omitted otherwise, so a filter using it fails CLOSED rather
             *  than silently matching everything (issue #1951 review
             *  round 3). */
            enteredThisTurn?: boolean;
            /** CR 400.7 / Keldon Twilight (PLS) — "controlled since the
             *  beginning of the turn". Same `turnState`-gated population as
             *  `enteredThisTurn` above. */
            controlledSinceTurnStart?: boolean;
            /** CR 307.1 / 117.1a — the cast-time snapshot
             *  {@link PermanentView.castOffSorceryTiming}: this permanent's
             *  spell was cast at a moment a sorcery couldn't have been cast.
             *  Read by a CR 603.4 check-time condition on the permanent's own
             *  ETB trigger (Necromancy's "if you cast it any time a sorcery
             *  couldn't have been cast", issue #2392). Surfaced here because
             *  the CLIENT reducer `buildTriggerStateView`
             *  (`src/lib/card-utils.ts`) enumerates its battlefield fields
             *  explicitly: without it a client-side read of the flag is
             *  permanently `undefined` and the condition silently answers "cast
             *  at sorcery speed" for every permanent — the drop class
             *  `.claude/rules/gre-development.md` § Frontend wiring analysis
             *  describes. Populated from the raw `CardInstanceState` field,
             *  which crosses the wire unchanged. */
            castOffSorceryTiming?: boolean;
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
     *  CR 603.4 condition can gate on "if a creature died this turn"
     *  without waiting for resolve — Osai Vultures' end-step intervening-if
     *  reads it. Mirrors `GameState.deathsThisTurn`; undefined defaults to 0. */
    deathsThisTurn?: number;
    /** CR 506.3 / 508.1 — true once ANY player's creature has been declared as
     *  an attacker this turn. Exposed so a CR 603.4 intervening-if can
     *  answer "if no creatures attacked this turn" at BOTH trigger-check time
     *  and resolution — Keldon Twilight's end-step trigger reads
     *  `state?.creatureAttackedThisTurn !== true`. Mirrors
     *  `GameState.creatureAttackedThisTurn`; undefined means no attack has been
     *  declared this turn. Game-level, NOT a per-creature scan: CR 506.4 keeps
     *  a creature "having attacked" once it is removed from combat, and an
     *  attacker that died is no longer on any battlefield to be scanned. */
    creatureAttackedThisTurn?: boolean;
    /** Life gained by each player this turn (CR 119.3 tally, issue #1457),
     *  keyed by player id. Exposed so a CR 603.4 intervening-if can
     *  answer "if you gained life this turn" at BOTH trigger-check time and
     *  resolution — Crested Sunmare's end-step Horse trigger reads
     *  `state?.lifeGainedThisTurn?.[self.controllerId]`. Mirrors
     *  `GameState.lifeGainedThisTurn`; an absent entry means 0 (a player who
     *  gained no life, or gained exactly 0 — CR 119.3: not a life gain). */
    lifeGainedThisTurn?: Readonly<Record<string, number>>;
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

/** CR 714.2 — one Oracle chapter line on a Saga, declared as data (ADR 0078).
 *
 *  `chapters: [1, 2]` is CR 714.2c's "I, II —": ONE entry, therefore ONE
 *  synthesized `TriggeredAbility` and one Oracle line on the stack / in the
 *  inspector — the same "one Oracle line = one TriggeredAbility" standard the
 *  multi-event trigger convention enforces (two abilities would render the
 *  line twice).
 *
 *  DIVERGENCE, deliberate and bounded: because it is one ability, a placement
 *  that crosses SEVERAL of its chapters at once (0 → 2 lore counters in a
 *  single event) fires it ONCE, where CR 714.2c's expansion into two separate
 *  triggered abilities would fire it twice. Lore counters arrive one at a time
 *  on every path the engine has (the CR 714.3a entry counter, the CR 714.3c
 *  turn-based action, proliferate), so the multi-crossing case is unreachable
 *  in normal play; a Saga with SINGLE-chapter entries is unaffected and fires
 *  once per crossed chapter, which the expander's per-entry ability shape
 *  gives for free. Out of scope for the Saga framework slice — reopening it
 *  means a per-ability trigger multiplicity hook in `collectTriggers`. */
export interface ChapterAbilityDefinition {
    /** Chapter number(s) this line is introduced by (CR 714.2b/714.2c).
     *  `[1]` for "I —", `[1, 2]` for "I, II —". */
    chapters: number[];
    /** Oracle text of the chapter line, shown on the stack (CR 603.3a). */
    oracleText: string;
    /** The chapter's effect as an Effect Script (ADR 0045). */
    effects: EffectOp[];
}

/** A triggered ability's CR 603.4 check-time gate, RESTATED in a form a reader
 *  that is not the engine can reason about (issue #1936).
 *
 *  The gate itself is folded into `matches` by the trigger factories, where it
 *  is indistinguishable from the scope/filter checks — an opaque closure over
 *  an event the reader does not have. That opacity is a bug for the bot's
 *  Effect Script VALUE MODEL (`convex/gre/ai/cardScriptValue.ts`), which walks
 *  an ability's `effects[]`/`aiEffects[]` off the `CardDefinition` alone: with
 *  no view of the gate it values EVERY gated ability as if it always fires.
 *  The reference case is Evoke — a hard-cast Incarnation was charged the evoke
 *  self-sacrifice (−40) for a trigger that can never fire on it.
 *
 *  `matches` remains the SOLE execution authority: nothing in the GRE's trigger
 *  scan reads this field, so a stale or absent gate can never change which
 *  triggers fire. Two shapes, by what a reader can do with them:
 *
 *   • `{ onSelf }` — decidable from the SOURCE permanent alone (Evoke's "if its
 *     evoke cost was paid" = `self.evoked === true`, Dash's `self.dashed`). A
 *     reader holding the instance evaluates it exactly; one holding only the
 *     definition falls back to the weight.
 *   • `{ undecidable: true }` — genuinely gated, but on the firing event or
 *     wider board state a reader cannot reconstruct. Never decided, only
 *     weighted. */
export type TriggerGate =
    | { readonly onSelf: (self: PermanentView) => boolean }
    | { readonly undecidable: true };

/** The `TriggerGate` for a gate a reader cannot decide — a shared frozen
 *  singleton so the trigger factories all mark the same object. */
export const UNDECIDABLE_TRIGGER_GATE: TriggerGate = Object.freeze({
    undecidable: true as const,
});

export interface TriggeredAbility {
    id: string;
    /** Oracle text shown on the stack and in context menus. */
    oracleText: string;
    /** CR 603.4 check-time gate, restated for non-engine readers — see
     *  {@link TriggerGate}. Set by the trigger factories whenever the author
     *  supplied a `condition` / `conditionOnSelf`; absent means "this ability
     *  fires whenever its event matches", which is what a reader assumes by
     *  default. Never consulted by the engine (`matches` is the authority). */
    gate?: TriggerGate;
    /** Which event kind(s) can fire this ability — used to index-filter before
     *  `matches()`. A scalar for the common single-event case; an ARRAY when a
     *  single Oracle sentence spans several engine events (CR 603.2), e.g.
     *  "put into a graveyard from anywhere" = battlefield death (CREATURE_DIED)
     *  + discard (CARD_DISCARDED) + mill (CARD_MILLED). The trigger scan
     *  (`triggerHandlesEventType`, gre/triggers.ts) matches an event whose
     *  `type` equals the scalar or is a member of the array; `matches()` still
     *  discriminates per firing event. One ability = one Oracle line, shown
     *  once on the stack / in the inspector — never N near-duplicate entries.
     *  An Effect Script cannot read the firing event, so an array-`event`
     *  ability whose effect must inspect `$event` (ADR 0049) stays scalar +
     *  imperative. */
    event: GameEventType | GameEventType[];
    /** CR 603.3d (issue #1193) — a triggered ability's targets are chosen when
     *  it is PUT ON THE STACK (unlike a spell/activated ability, which chooses
     *  targets before it reaches the stack). When set, `placeTriggersOnStack`
     *  locks the target(s) at announcement via `raiseTriggerTargetSelection`
     *  (`gre/rules.ts`): a single legal target auto-selects, "up to" with none
     *  legal goes on the stack targetless, a required target with none legal
     *  removes the trigger (CR 603.3c), otherwise the controller is prompted
     *  through the SAME `PendingTarget` machinery as spells (`kind: "trigger"`).
     *  The resolving effect reads the announced slot via `{ target: 0 }` /
     *  `ctx.targets[i]`; `divideAsChosen` (Fury) and the `"spell"` type
     *  (Subtlety) compose with it. Absent → an untargeted trigger (the vast
     *  majority), unchanged. Reverses ADR 0002's "triggers carry no
     *  targetRequirement" simplification. */
    targetRequirement?: TargetRequirement;
    /** CR 603.3c / 700.2b (issue #2461) — a MODAL triggered ability ("When this
     *  creature enters, choose one — • … • …"). The controller announces
     *  exactly one mode as the ability is PUT ON THE STACK, before targets, and
     *  the pick never changes afterwards (CR 700.2f — changing a target can't
     *  change the mode); the chosen mode alone supplies the
     *  announcement-time `targetRequirement` (CR 700.2c) and the resolution
     *  body. A mode whose required targets have no legal candidates cannot be
     *  chosen, and when no mode can be chosen the ability is removed from the
     *  stack (CR 603.3c) — both enforced by `raiseTriggerModeAnnouncement`
     *  (`gre/rules.ts`), which raises a `kind: "trigger-mode"` PendingChoice
     *  for the controller when two or more modes are choosable and
     *  auto-announces when only one is.
     *
     *  Deliberately the SAME {@link AbilityMode} list `ActivatedAbility.modes`
     *  uses, riding the SAME `chosenModeId` plumbing (stack item → resolution
     *  dispatch) — a triggered ability's modes differ from an activated
     *  ability's only in WHEN the announcement happens (CR 700.2a as part of
     *  activating vs CR 700.2b as part of going on the stack), never in what
     *  a mode is. Cardinality is therefore whatever the shared announce-time
     *  mode-list model says (exactly one today; ADR 0094's `ModeSelection`
     *  applies here unchanged when it lands) — never a trigger-local variant.
     *
     *  MUTUALLY EXCLUSIVE with the ability-level body (`effects` / `resolve` /
     *  `resolveSteps`): the mode carries the body. Enforced statically by
     *  `validateAbilityEffectScript` (`gre/effects/validate.ts`) over the whole
     *  catalogue. NOT the resolve-time `optionChoice` Op (ADR 0089): a
     *  resolution-time pick has no response window and cannot lock a target at
     *  announcement. */
    modes?: AbilityMode[];
    /** Zone the source must be in for this ability to be scanned (CR 603.6e —
     *  abilities that function while the card is in a zone other than the
     *  battlefield). Defaults to the battlefield when omitted. `"graveyard"`
     *  opts the card into `collectTriggers`' graveyard scan path (Nether
     *  Shadow's upkeep self-reanimation). */
    zone?: "graveyard";
    /** CR 603.6e (issue #2319) — this ability functions while its own card is
     *  ON THE STACK as a spell, so it must be scanned there rather than on the
     *  battlefield: "When you cast this spell, …" (Emrakul, the Aeons Torn's
     *  extra turn; Mana Vortex's counter-unless-you-sacrifice-a-land).
     *
     *  A DEDICATED marker rather than a `zone: "stack"` member, because the two
     *  answer different questions. `zone` selects which pile
     *  `collectTriggers` sweeps for a source that is SITTING somewhere; a cast
     *  trigger is collected by `collectCastTriggers` at the single cast choke
     *  point (`emitSpellCastEvent`) against the ONE spell just announced, so
     *  the trigger lands above it in the same atomic step (CR 601.2i).
     *
     *  Set ONLY by `spellCastTrigger` for `scope: "self"`, never by an author
     *  by hand. The marker is deliberately FAIL-CLOSED: an ability without it
     *  is never scanned on the stack, so a battlefield permanent whose
     *  `scope: "any"`/"you" cast-watching trigger happens to fire on its own
     *  casting does NOT wrongly trigger from the stack (CR 603.6 — an ability
     *  functions only on the battlefield unless it says otherwise). */
    functionsFromStack?: true;
    /** CR 702.29c — this ability triggers off the discard of ITS OWN card, and
     *  is collected "from whatever zone the card winds up in after it's
     *  cycled": the graveyard normally, or exile when a CR 614 graveyard-bound
     *  replacement (Dauthi Voidwalker / Yawgmoth's Will) or Madness redirected
     *  it. `collectTriggers` sweeps that pile off the CARD_DISCARDED event
     *  itself, the same shape as the Madness reflexive trigger.
     *
     *  A DEDICATED marker rather than a `zone` member, for the same reason
     *  `functionsFromStack` is: `zone` selects which pile to sweep for a source
     *  SITTING somewhere and is fixed at authoring time, whereas the zone a
     *  discarded card wound up in is only known from the event. Set by the
     *  `cycledTrigger` factory (`cards/abilities/cycling.ts`), never by hand.
     *
     *  Deliberately FAIL-CLOSED: without it a card in the graveyard is never
     *  scanned for CARD_DISCARDED, so a battlefield "whenever you cycle or
     *  discard a card" ability (Marauding Mako) does NOT fire off its own
     *  discard from the graveyard (CR 603.6 — an ability functions only on the
     *  battlefield unless it says otherwise). */
    functionsFromOwnDiscard?: true;
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
    /** CR 603.2 per-turn TRIGGER cap — "This ability triggers only <N> time(s)
     *  each turn" (Nadu, Winged Wisdom: "only twice each turn"). Distinct from
     *  `ActivatedAbility.oncePerTurn` (CR 602.5, an ACTIVATION gate the player
     *  runs into when trying to activate): this bounds how many times the
     *  ability may TRIGGER, so once the cap is reached the ability simply does
     *  not fire — no stack item is created at all, and the fizzle/counter path
     *  is never involved.
     *
     *  Counted PER SOURCE OBJECT, not per card definition or per controller:
     *  the tally lives on `CardInstanceState.triggersThisTurn[abilityId]`
     *  (mirroring `activationsThisTurn`), so a battlefield-wide grant like
     *  Nadu's gives EACH creature you control its own two triggers per turn,
     *  which is what the Oracle text means. Incremented by `collectTriggers`
     *  (gre/triggers.ts) at the moment the ability triggers, and reset for
     *  every permanent at the turn boundary alongside `activationsThisTurn`
     *  (gre/phases.ts). A permanent that leaves and re-enters the battlefield
     *  is a NEW object (CR 400.7) and starts fresh.
     *
     *  Only meaningful for battlefield-zone abilities scanned by
     *  `collectTriggers`; a `zone: "graveyard"` ability, an emblem ability or a
     *  delayed trigger is not capped by this field. */
    maxTriggersPerTurn?: number;
    /** Intervening-if condition (CR 603.4). When defined, re-evaluated by
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
    /** AI-only shadow Effect Script for a `resolve()`/`resolveSteps` triggered
     *  ability (PRD #1423, issue #1431) — see `CardDefinition.aiEffects` for
     *  the full contract (never executed, valued by `OP_VALUERS` only). Not
     *  covered by the card-level catalogue guard in this ticket (scoped to
     *  spell-site `resolve()`, issue #1431) — provided so the same shadow-
     *  script mechanism is available at this site too. */
    aiEffects?: EffectOp[];
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
    /** CR 714.2 — the chapter number(s) this ability is introduced by on a
     *  Saga ("I —", "I, II —"). Set ONLY by the `chapterAbilities` expander
     *  (`convex/cards/abilities/sagas.ts`); never hand-written on a card.
     *
     *  Load-bearing twice over, which is why the tag lives on the ability
     *  rather than being re-derived: `finalChapter` (CR 714.2d) takes the max
     *  over the EFFECTIVE chapter-tagged abilities, and the CR 714.4 sacrifice
     *  SBA uses it to tell "a chapter ability of this Saga is on the stack"
     *  from "any trigger sourced from this Saga" (a granted trigger must not
     *  defer the sacrifice). Because the tag travels on the ability object, it
     *  survives copy, grant and ability-loss suppression for free. */
    chapterNumbers?: number[];
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

// --- Emblems (CR 114) ---
//
// An emblem is an object created by a resolving spell or ability (typically a
// planeswalker's ultimate loyalty ability) that lives in the COMMAND ZONE and
// has no characteristics other than a set of continuous and/or triggered
// abilities that affect the game "from outside" (CR 114.1, 114.3). An emblem
// can't be targeted, enchanted, equipped, destroyed, or otherwise interacted
// with, and it stays in the command zone for the rest of the game (CR 114.4) —
// so there is no permanent SOURCE for its abilities to leave play with.
//
// The abilities carry closures (`applies` / `matches` / `resolve`), so — like a
// card definition — an emblem is stored in game state only by KEY
// (`EmblemInstance.emblemId`); the closure-bearing definition lives in the
// central registry (`convex/cards/emblems.ts`) and is resolved at read time by
// the layer system (continuous abilities) and the trigger scanner (triggered
// abilities). This keeps `GameState` JSON-pure and serializable (ADR 0046),
// mirroring how a permanent references its `card.id`.

/** The closure-bearing definition of an emblem's granted abilities (CR 114.3).
 *  Registered by key in `convex/cards/emblems.ts`; never stored in game state
 *  directly (its closures aren't serializable). */
export interface EmblemDefinition {
    /** Stable key, referenced by `EffectOp` `{ op: "emblem", emblem }` and
     *  `EmblemInstance.emblemId`. */
    id: string;
    /** Display name shown in the command zone, e.g. "Sorin, Lord of Innistrad
     *  emblem". */
    name: string;
    /** Oracle text of the granted abilities, for display. */
    text: string;
    /** Scryfall print id of the emblem's own printed card (layout `emblem`,
     *  e.g. Sorin, Lord of Innistrad Emblem in `tdka`) whose art the UI
     *  renders. Mirrors a token's `TokenSpec.imagePrintId` — a bare Scryfall
     *  UUID that `src/lib/images.ts` turns into a CDN URL; absent means the
     *  client falls back to an in-app text placeholder. */
    imagePrintId?: string;
    /** Continuous static abilities the emblem contributes (CR 114.4, 611).
     *  Source-less: collected by the layer system with the emblem scoped to its
     *  owner (an owner-scoped anthem reads `source.controllerId` = the owner).
     *  Same shape as `CardDefinition.staticEffects`. */
    staticEffects?: StaticEffect[];
    /** Triggered abilities the emblem contributes (CR 114.4, 113.3, 603).
     *  Source-less: collected by the trigger scanner scoped to the owner. Same
     *  shape as `CardDefinition.triggeredAbilities`. */
    triggeredAbilities?: TriggeredAbility[];
}

/** A command-zone emblem object (CR 114) as it lives in `GameState.emblems`.
 *  Pure, serializable data — the abilities are resolved by key from the emblem
 *  registry at read time (see {@link EmblemDefinition}). */
export interface EmblemInstance {
    /** Deterministic id "emblem-N" from `GameState.nextEmblemSeq`. */
    id: string;
    /** The player who owns and controls the emblem (CR 114.3) — its abilities'
     *  "you" / "creatures you control". For continuous abilities this is the
     *  synthetic source's `controllerId`; for triggered abilities the trigger's
     *  controller. */
    ownerId: string;
    /** Key into the emblem registry (`convex/cards/emblems.ts`) — the analogue
     *  of a permanent's `card.id`. */
    emblemId: string;
    /** Denormalized display name (from the definition) so the wire projection is
     *  self-describing without the client resolving the registry. */
    name: string;
    /** Denormalized display oracle text of the granted abilities. */
    text: string;
    /** Denormalized Scryfall print id of the emblem's art (from the
     *  definition's `imagePrintId`), so the wire projection is self-describing
     *  and the client renders the emblem's real card art without resolving the
     *  registry. Absent → the client shows an in-app text placeholder. */
    imagePrintId?: string;
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
    | "graveyard-bound"
    | "enters-battlefield"
    | "draw";

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

/** Tap event: a permanent about to become tapped (CR 701.26a). Face-down
 *  permanents intercept this to turn face up first (CR 708, ADR 0013). The
 *  replacement does not cancel the tap — it turns the creature up and lets it
 *  become tapped as its real self. */
export interface TapReplacementEvent {
    kind: "tap";
    cardInstanceId: string;
}

/** Destroy event: a permanent about to be destroyed (CR 701.8). A
 *  replacement intercepts the destruction BEFORE it happens (CR 614),
 *  distinct from regeneration (CR 701.19, a specialised shield consulted
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
     *  rewrites this to `"exile"` to redirect the card (CR 614.1a), or to
     *  `"library"` for a self-referential "shuffle it into its owner's
     *  library instead" clause (Blightsteel Colossus, issue #2106) — see
     *  `ReplacementEffect.appliesFromAnyZone`. Unlike `"destroy"`, this event
     *  never fully cancels (`{kind:"consumed"}`) — the card always ends up
     *  SOMEWHERE, so redirection is expressed as a `"modified"` rewrite of
     *  `destination`, not a null result. */
    destination: "graveyard" | "exile" | "library";
    /** Counters to stamp on the card once it lands in `destination` (Dauthi
     *  Voidwalker's void counter). Only meaningful when `destination !==
     *  "graveyard"` — a card that lands in the graveyard normally is never
     *  tagged. NOTE: deliberately NO per-instance source link here — Dauthi's
     *  cast ability references ANY void-counter card, not "cards exiled with
     *  this Voidwalker", so pinning exiled cards under a specific instance
     *  would assert an ownership the rules don't have. */
    tagCounters?: Record<string, number>;
}

/** Enters-the-battlefield event: a permanent about to be placed on the
 *  battlefield (CR 110.5, 401/403/etc. zone changes that land an object
 *  there, CR 601.2i / 603.6 cast-resolution ETB). Fired at every chokepoint
 *  that pushes a permanent onto a `battlefield` array — a resolving cast
 *  permanent (`wasCast: true`, `finalizeSpellResolution`), a reanimated /
 *  library-tutored / hand-cheated-in permanent (`wasCast: false`, the shared
 *  `stageReanimatedOnBattlefield` helper behind `returnToBattlefield` /
 *  `putFromLibraryOntoBattlefield` / `putFromHandOntoBattlefield` / the
 *  graveyard-set batch path), and token creation (`wasCast: false`,
 *  `isToken: true`, `createToken`). Containment Priest's "if a nontoken
 *  creature would enter and it wasn't cast, exile it instead" (issue #1148)
 *  is the shipped consumer: its `appliesTo` filters on `!event.isToken &&
 *  !event.wasCast && event.types.includes("Creature")`. Unlike `"destroy"`
 *  this event never fully cancels — a permanent that would enter always ends
 *  up SOMEWHERE (battlefield or, replaced, exile) — so redirection is a
 *  `"modified"` rewrite of `destination`, mirroring
 *  `GraveyardBoundReplacementEvent` rather than `DestroyReplacementEvent`'s
 *  `{kind:"consumed"}` shape. A redirected permanent never actually touches
 *  the battlefield, so no ETB trigger observes it (matches the printed
 *  Containment Priest ruling). */
export interface EntersBattlefieldReplacementEvent {
    kind: "enters-battlefield";
    /** Instance id of the permanent about to enter. */
    cardInstanceId: string;
    /** CR 110.5 — the object's owner (stable across the zone change). */
    ownerId: string;
    /** The prospective controller once on the battlefield (CR 110.2). */
    controllerId: string;
    /** CR 111 — true for a token-creation entry. Containment Priest's
     *  "nontoken" clause exempts these regardless of `wasCast`. */
    isToken: boolean;
    /** CR 601.2i — true only at the cast-resolution chokepoint. Every
     *  non-cast zone change onto the battlefield (reanimation, tutor-to-
     *  battlefield, hand-cheat, token creation) passes `false`. */
    wasCast: boolean;
    /** Card types of the entering object (CR 300), read by type-scoped
     *  filters (Containment Priest's "creature"). Snapshotted directly onto
     *  the event rather than looked up via `ReplacementStateView.battlefield`
     *  because the entering object isn't on the battlefield yet at event
     *  time — it has nothing to be looked up FROM. */
    types: ReadonlyArray<CardType>;
    /** Mutable: destination once the replacement loop settles. Starts
     *  `"battlefield"`; a matching replacement rewrites this to `"exile"` to
     *  redirect the entry (CR 614.1a). */
    destination: "battlefield" | "exile";
}

/** Draw event: a player about to draw ONE card (CR 120.1 / 121.1). A
 *  first-class `ReplacementEventKind` (ADR 0061) discovered through the central
 *  replacement system but APPLIED at the single suspend-capable draw seam
 *  (`planDrawStep` / `commitDrawPlan` in `gre/state.ts`), never via the
 *  synchronous `ReplacementApplyContext` mutator path — a draw replacement may
 *  require a player choice (Zur's Weirding "may pay 2 life", dredge "may mill",
 *  CR 616.1 pick-which), so it resolves at the resumable seam. Fires once PER
 *  CARD at every draw site: the turn-based draw step, the DSL `draw` Op, and
 *  (after the #1264 migration) every effect draw. Its condition is an
 *  `applies(event, source)` predicate over this payload (ADR 0061 — predicate
 *  scope, no `controller | all-players | each-opponent` enum); its outcome may
 *  modify the count (draw N → N+1), redirect the draw, or prevent it. */
export interface DrawReplacementEvent {
    kind: "draw";
    /** CR 120.1 — the player who would draw. */
    drawingPlayer: string;
    /** 0-based index of THIS draw among the drawing player's draws this turn
     *  (CR 121.1), read from `PlayerState.drawnThisTurn.length` at event time.
     *  Feeds "the first card drawn this turn" / "each opponent's second and
     *  later draw" predicates (Leovold). */
    drawIndexThisTurn: number;
    /** True only for the turn-based draw-step draw (CR 504.1). Lets a
     *  replacement exempt the draw-step draw (Hullbreacher — "except the first
     *  one they draw in each of their draw steps"). */
    isTurnBasedDrawStepDraw: boolean;
    /** How many cards the originating draw instruction requested (CR 121.2 —
     *  "draw N cards"). The event fires once per card; this is the batch size
     *  the draw came from, read by hand-size / count-conditioned predicates. */
    requestedCount: number;
}

export type ReplacementEvent =
    | DamageReplacementEvent
    | LifeChangeReplacementEvent
    | DiscardReplacementEvent
    | LoseGameReplacementEvent
    | TapReplacementEvent
    | DestroyReplacementEvent
    | GraveyardBoundReplacementEvent
    | EntersBattlefieldReplacementEvent
    | DrawReplacementEvent;

/** Outcome of a matched draw replacement (ADR 0061), applied at the resumable
 *  draw seam. Distinct from the sync `ReplacementResult` because a draw
 *  replacement's application may suspend for a choice — so its outcome is a
 *  DATA descriptor the seam interprets, not a `replace()` mutator closure.
 *  - `reveal-type-to-graveyard` — reveal the top card; if it has `cardType`,
 *    put it into its owner's graveyard, otherwise draw it (deterministic —
 *    Enduring Renewal, creature → graveyard).
 *  - `reveal-others-may-pay-life` — reveal the top card; any OTHER player
 *    (APNAP, CR 101.4) may pay `life` to bin it, otherwise the drawing player
 *    draws it (interactive — Zur's Weirding, pay 2 life).
 *  - `prevent` — the draw simply doesn't happen: no card, no draw-from-empty
 *    loss (Leovold, "can't draw more than one card each turn").
 *  - `modify-count` — the single draw yields `1 + delta` cards instead of 1
 *    (Quantum Riddler, draw N → N+1). The extra cards are drawn raw and do NOT
 *    re-trigger the replacement (CR 616.1d — a replacement applies once per
 *    event). Built into the seam now (ADR 0061 story 16) though no shipping
 *    card uses it yet. */
export type DrawReplacementOutcome =
    | { kind: "reveal-type-to-graveyard"; cardType: CardType }
    | { kind: "reveal-others-may-pay-life"; life: number }
    | { kind: "prevent" }
    | { kind: "modify-count"; delta: number }
    /** The would-be draw is replaced entirely: the drawing player draws
     *  nothing (no card, no draw-from-empty loss) and the REPLACEMENT SOURCE's
     *  controller creates `count` copies of `token` (CR 614.1 redirect —
     *  Hullbreacher: "instead you create a Treasure token"). Deterministic (no
     *  player choice), so it commits inline at the draw seam without
     *  suspending. `token` carries closures (the Treasure mana ability), so a
     *  card declaring this outcome is a definition-level field, not a JSON-pure
     *  effect script. */
    | { kind: "redirect-to-token"; token: TokenSpec; count: number };

/** A continuous draw-event replacement (CR 614, ADR 0061) carried by a card
 *  definition. While ANY permanent with this declaration is on the
 *  battlefield, every draw an affected player would take is intercepted at the
 *  single draw seam (read live from the battlefield, like the sync
 *  `replacementEffects[]`, so it ends the instant the source leaves play).
 *  `applies` is the predicate scope (ADR 0061): `event.drawingPlayer !==
 *  source.controllerId` = "each opponent", hand-size conditions read `state`.
 *  Supersedes the retired `drawRevealReplacement` field (#735). */
export interface DrawReplacementEffect {
    id: string;
    oracleText: string;
    /** CR 614 — does this replacement intercept `event`? `source` is the
     *  permanent carrying it; `state` a read-only view for board-conditioned
     *  predicates. */
    applies: (
        event: DrawReplacementEvent,
        source: PermanentView,
        state: ReplacementStateView
    ) => boolean;
    outcome: DrawReplacementOutcome;
}

/** The resolved plan for ONE draw event, produced by `planDrawStep`
 *  (`gre/state.ts`) after replacement discovery + CR 616.1 ordering, and
 *  applied by `commitDrawPlan`. Splitting PLAN (pure compute + reveal) from
 *  COMMIT (the mutation) is what lets the single seam serve three call sites
 *  with different suspend idioms: the DSL `draw` Op (interpreter
 *  `requestMayPay`), the turn-based draw step (phase-level `draw-replacement`
 *  PendingChoice), and the synchronous `drawCards` primitive (no suspend — the
 *  legacy `resolve()`-closure path, migrated off in #1264).
 *  - `normal` — draw `count` cards via the raw primitive (count possibly bumped
 *    by a `modify-count` outcome; the extra cards are NOT re-replaced).
 *  - `prevent` — no draw at all (Leovold): no card, no draw-from-empty loss.
 *  - `bin` — deterministic reveal-then-graveyard (Enduring Renewal creature).
 *  - `may-pay-bin` — interactive: `chooserId` may pay `life` to bin the
 *    revealed top card, else the drawing player draws it (Zur's Weirding). */
export type DrawStepPlan =
    | { kind: "normal"; count: number }
    | { kind: "prevent" }
    | { kind: "bin" }
    | {
          kind: "may-pay-bin";
          chooserId: string;
          life: number;
          revealedCardId: string;
      }
    /** Deterministic redirect (Hullbreacher): the drawing player draws nothing
     *  and `beneficiaryId` (the replacement source's controller) creates
     *  `count` copies of `token`. Commits inline — no suspend, no PendingChoice
     *  — so it never round-trips through serialize. */
    | {
          kind: "create-token";
          beneficiaryId: string;
          token: TokenSpec;
          count: number;
      };

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
            /** Effective colors (CR 202.2, layer 5 — issue #1083). Read
             *  through `colorOverride`/granted colors exactly like
             *  `STATIC_EFFECT_CTX.getColors`, so a `setColor`'d creature (or
             *  one with a granted color) reads correctly here too. Lets a
             *  damage-replacement predicate read the TARGET creature's color
             *  by looking it up here (only the damage SOURCE's colors ride
             *  `DamageReplacementEvent.sourceColors` directly) — Well-Laid
             *  Plans' "prevent all damage... if they share a color" needs
             *  both sides. */
            colors: ReadonlyArray<Color>;
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
        /** Declared attacking bands (CR 702.22c). Read by Camel to extend its
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
    /** CR 614.1a self-referential "would be put into a graveyard from
     *  anywhere ... instead" clauses (Blightsteel Colossus, issue #2106):
     *  the replacement is intrinsic to the object itself, not to it sitting
     *  on a battlefield, so it must keep applying while the card is milled
     *  from a library, discarded from a hand, or resolving off the stack —
     *  none of which the normal `collectReplacements` battlefield scan can
     *  see. Set `true` ONLY on an `eventKind: "graveyard-bound"` effect
     *  whose `appliesTo` matches solely on `event.cardInstanceId === self.id`
     *  (never a broader scope like "any opponent's card" — that shape stays
     *  permanent-bound, e.g. Dauthi Voidwalker). Opt-in and defaults to
     *  `false`/undefined so every other `replacementEffects[]` entry keeps
     *  its existing battlefield-bound discovery unchanged. See
     *  `gre/replacements.ts`'s `collectReplacements`. */
    appliesFromAnyZone?: boolean;
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
 *    Sugar for `{ opponentOf: "controller" }` below — kept as its own literal
 *    because it is overwhelmingly the common case and predates the general
 *    form (issue #1568).
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
    /** The controller-relative complement of an ARBITRARY resolved player ref
     *  (issue #1568) — "each player OTHER THAN <ref>", generalizing
     *  `"opponent"` (which only ever complements the resolving `"controller"`)
     *  to any `EffectPlayerRef`, most importantly `{ controllerOf }` — "each
     *  player other than ITS controller" (Fractured Identity: "Exile target
     *  nonland permanent. Each player other than its controller creates a
     *  token that's a copy of it" — the target has no controller
     *  restriction, so its controller may be either seat). `"opponent"` is
     *  exactly `{ opponentOf: "controller" }`.
     *
     *  PRIMITIVE-REUSE NOTE: this generalizes the existing "opponent"
     *  primitive (parametrizing WHOSE opponent, rather than adding a second
     *  card-shaped selector) per the primitive-reuse mandate
     *  (`.claude/rules/gre-development.md` § Primitive reuse) — a
     *  `forEach`-with-exclusion alternative was considered and rejected: it
     *  would need a NEW per-player exclusion field on `EffectForEachSelector`
     *  (a second construct) to solve a problem this one-line ref variant
     *  already solves, and would still need `opponentOf`'s own resolution
     *  logic to compute the excluded id in the first place.
     *
     *  TWO-PLAYER SCOPE (CLAUDE.md § Out of Scope — no 3+ player
     *  multiplayer): this resolves to "the OTHER of exactly two seats", via
     *  `ctx.allPlayerIds.find(id => id !== resolved)` — the same lookup
     *  `"opponent"` already performs. It is NOT a genuine N-player
     *  complement (which would need to return a SET of players, not a single
     *  id) — read literally, "each player other than X" is a plural
     *  selector that only degenerates to one well-defined id because this
     *  engine never has a third seat. A future 3+ player mode would need a
     *  different (multi-valued) construct, not a bigger `allPlayerIds.find`. */
    | { opponentOf: EffectPlayerRef }
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

/** CR 404.3 (issue #1967) — a DETERMINISTIC POSITIONAL pick out of an ORDERED
 *  zone, with no player choice at all: "the TOP creature card of your
 *  graveyard" (Shallow Grave, `mir/black.ts`; Corpse Dance, `tmp/black.ts`).
 *
 *  The graveyard IS an ordered zone (CR 404.3 — "each graveyard is kept in a
 *  single face-up pile … order can be changed only …"), and this engine
 *  guarantees that order: every insertion site APPENDS (`moveCard` /
 *  `removePermanentTo` in `gre/state.ts` both `push`), so `player.graveyard`
 *  runs OLDEST-first and the LAST element is the TOP of the pile. `position`
 *  mirrors the library's own `"top" | "bottom"` grammar
 *  (`putSpellOnLibrary`) rather than inventing a second one (ADR 0045
 *  "generalize, don't add").
 *
 *  `filter` makes this a FILTERED positional scan, which is what the oracle
 *  wording actually asks for: "the top **creature** card of your graveyard"
 *  is the topmost card MATCHING the filter, NOT "the top card, if it happens
 *  to be a creature" — a Lightning Bolt sitting above a Griselbrand does not
 *  make Shallow Grave fizzle. Omitted, the unfiltered top/bottom card is
 *  taken. Matched through the SAME `matchesCardFilter` every other
 *  hidden-zone filter site uses.
 *
 *  `player` names whose graveyard is scanned; omitted it defaults to
 *  `"controller"` — both shipped cards say "YOUR graveyard". A no-match (or
 *  an empty graveyard) is a clean CR 608.2b no-op: the effect does as much as
 *  it can, and nothing happens.
 *
 *  Deliberately NOT a member of `EffectObjectSelector`: every other
 *  object-acting Op (destroy / exile / dealDamage / pump / counters) is
 *  battlefield-scoped, and widening the shared selector would make this shape
 *  validate — and then silently no-op — at all of them. It is accepted only
 *  by the `moveZone` Op, whose graveyard-card branch already knows how to act
 *  on a card sitting in a graveyard. */
export type EffectZonePositionSelector = {
    zone: "graveyard";
    position: "top" | "bottom";
    player?: EffectPlayerRef;
    filter?: EffectCardFilter;
};

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

/** CR 607 linked abilities (issue #783) — "the card(s) exiled with this
 *  permanent", i.e. every card in any exile zone stamped by
 *  `SpellContext.linkExileToSource` with the resolving ability's own source
 *  (`ctx.sourceInstanceId`). The selector shape a SECOND ability needs to reach
 *  what a FIRST ability on the same permanent exiled, across two separate
 *  resolutions (a `bind` cannot span them). Used by `grantCastFromExile`
 *  (Hideaway, CR 702.75 — "you may play the exiled card"). */
export type EffectExiledWithSourceSelector = { exiledWithSource: true };

/** count — the size of a declaratively-selected set of cards (ADR 0045),
 *  the "for each …" numeric construct (CR 122 counting). No object handles
 *  escape: only the cardinality is produced. */
export type EffectCount = { count: EffectCountSpec };

/** A declarative card-set selector for the `count` construct. Counts the cards
 *  in one zone controlled/owned by a player, optionally filtered. */
export interface EffectCountSpec {
    /** The zone whose cards are counted. `battlefield` counts permanents the
     *  player controls (CR 110); `graveyard` counts cards in the player's
     *  graveyard (CR 404); `library` counts cards in the player's library
     *  (CR 401, issue #783 — Shelldock Isle's "if a library has twenty or
     *  fewer cards in it"); `hand` counts cards in the player's hand (CR 402,
     *  issue #2006 — Dark Suspicions' "the number of cards in that player's
     *  hand"). Both `library` and `hand` are pure CARDINALITY reads: the zone
     *  is hidden (CR 401.2 / 402.2) but its SIZE is public information every
     *  player may count, so a `filter` is meaningless there (it would ask the
     *  engine to read cards the counting player may not see) and is rejected
     *  by the validator, as is the graveyard-only `countTypes`. */
    zone: "battlefield" | "graveyard" | "library" | "hand";
    /** Whose zone (CR 109.5 relative selectors). Required UNLESS
     *  `acrossAllPlayers` is set, in which case it is omitted (the count spans
     *  every player's zone, not one player's). */
    controller?: EffectPlayerRef;
    /** Count across ALL players' zones (CR 122 counting — the "in all
     *  graveyards" scope of Accumulated Knowledge, issue #985), summing each
     *  player's matching cards. Mutually exclusive with `controller`. */
    acrossAllPlayers?: boolean;
    /** The SMALLEST per-player count across all players' zones (CR 122
     *  counting, issue #783). The sibling of `acrossAllPlayers` — same
     *  all-players scope, MIN instead of SUM — and what makes an "a zone has
     *  N or fewer cards in it" clause expressible in ONE comparison rather
     *  than one duplicated `if` leg per player: `min(sizes) <= N` is exactly
     *  "SOME player's zone has N or fewer cards" (Shelldock Isle: "if a
     *  library has twenty or fewer cards in it" — the Oracle says "a library",
     *  i.e. ANY library including the controller's own). Mutually exclusive
     *  with both `controller` and `acrossAllPlayers`. */
    smallestAcrossPlayers?: boolean;
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
    /** Negative of `color` (CR 105.2, issue #1287) — a card matches only if
     *  it has NONE of the listed colors. Mirrors `excludeType`/
     *  `excludeSupertype`'s negation shape exactly (ADR 0045 "generalize,
     *  don't add" — a symmetric field on an existing primitive, not a new
     *  one). Krovikan Sorcerer's "Discard a NONBLACK card" is
     *  `excludeColor: "B"`. A single value is shorthand for one color; an
     *  uncolored card (empty `colors`) always matches (CR 105.2a — no color
     *  to exclude). AND with every other field. Like `manaValueAtMost`, this
     *  field is read only by `matchesCardFilter` — the hand/library/
     *  graveyard/exile branches of a `choice`/`count` construct — and does
     *  NOT propagate through `toPermanentFilter` onto a `zone: "battlefield"`
     *  choice; `PermanentFilter` has no exclude-colors counterpart yet (no
     *  shipped card needs a battlefield-scoped color exclusion). */
    excludeColor?: Color | Color[];
    manaValueAtMost?: number | EffectXValue;
    /** Exact mana-value match (CR 202.3, issue #1083) — a card matches only if
     *  its mana value equals `manaValueEquals` precisely, not merely "at
     *  most". Mirrors `manaValueAtMost`'s two shapes exactly (ADR 0045
     *  "generalize, don't add" — a symmetric sibling field, not a new
     *  primitive): a FIXED literal or a DYNAMIC `{ X: true }` (the chosen-cost
     *  X, resolved via `ctx.getX()` at the same `resolveValue` site
     *  `manaValueAtMost` already uses). Metathran Aerostat's "a creature card
     *  with mana value X from your hand" is `manaValueEquals: { X: true }`
     *  paired with `type: "Creature"` on a `choice(zone: "hand")` Op. An
     *  unresolvable dynamic value fails the filter closed (CR 608.2b),
     *  matching `manaValueAtMost`'s own fail-closed convention. AND with
     *  every other field, including `manaValueAtMost` itself (an unlikely but
     *  not-forbidden combination — the two are independent ceiling/exact
     *  constraints). */
    manaValueEquals?: number | EffectXValue;
    /** Exact structural MANA-COST match (CR 202, issue #1881, ADR 0078
     *  decision 8) — distinct from `manaValueEquals`, which folds a cost down
     *  to one number. Urza's Saga III reads "an artifact card with **mana
     *  cost** {0} or {1}", NOT mana value: `manaValueAtMost: 1` wrongly
     *  admits 141 cards — 18 costed `{X}` (Chalice of the Void, Engineered
     *  Explosives: mana value 0, cost `{X}`, never `{0}`) and 123 coloured
     *  mana-value-1 artifacts (cost `{W}`, never `{1}`). Compared structurally
     *  by `manaCostsEqual` (`gre/constants.ts`) against the card's FULL
     *  printed `ManaCost`, folding in every characteristic CR 202 cares
     *  about: WUBRGC pip counts, the combined fixed-generic total (a numeric
     *  `X` and `generic` are the SAME characteristic, split only to coexist
     *  with a variable `{X}` — see `ManaCost.generic`'s own doc comment),
     *  whether `X` is the VARIABLE marker `"X"` (a variable cost never
     *  equals a fixed one, CR 202.3b — `{X}` != `{0}`/`{1}`/anything fixed),
     *  its `xFactor` when variable (`{X}` != `{X}{X}`), and the
     *  `phyrexian`/`hybrid` pip multisets (CR 107.4f / 202.1a). `{0}` is
     *  `{}`, `{1}` is `{ X: 1 }` (or `{ generic: 1 }` — both normalize to the
     *  same fixed-generic total), `{X}` is `{ X: "X" }`. A single `ManaCost`
     *  or a non-empty ARRAY of them (OR, mirroring `subtype`'s own array
     *  semantics, issue #677); the `ManaCost | ManaCost[]` two-shape mirrors
     *  `manaValueEquals`'s `number | EffectXValue` naming convention — one
     *  scalar clause, or a disjunctive list of them. Meaningful only for a
     *  card shape that carries its FULL printed cost (today: hand/library/
     *  graveyard/exile snapshots via `matchesCardFilter`) — a CR 608.2h
     *  characteristics snapshot (`boundMatchesFilter`) has no cost slot and
     *  fails CLOSED (never matches), the same convention every other field
     *  here uses for a card shape that lacks the data it needs. ANDed with
     *  every other field, including `manaValueEquals` itself. */
    manaCostEquals?: ManaCost | ManaCost[];
    isToken?: boolean;
    /** "Entered the battlefield this turn" (CR 400.7, issue #1458) — a
     *  battlefield permanent matches if it ENTERED the battlefield during the
     *  current turn, read off the engine's per-permanent entry stamp
     *  `CardInstanceState.enteredOnTurn` (written by `markEnteredThisTurn` /
     *  `createTokenPermanents`, `gre/state.ts`) compared against
     *  `GameState.turn`.
     *
     *  Deliberately NOT `isSummoningSick`: that flag clears only at its
     *  CONTROLLER's untap step (so it stays true across the opponent's whole
     *  turn — an over-count for any effect resolving then), and it is re-set
     *  by `applyControlChange` on a permanent that never changed zones
     *  (gaining control is not entering, CR 400.7 / 603.6).
     *
     *  Battlefield-only, mirroring `isToken`'s own scope exactly:
     *  `matchesCardFilter` (the hand/library/graveyard hidden-zone matcher)
     *  does not check it — a hidden-zone card has no battlefield clock.
     *  Propagated onto `PermanentFilter.enteredThisTurn` by `toPermanentFilter`
     *  for the `count` construct and `forEach { set: "permanents" }` (and any
     *  future battlefield `choice`, since both route through the same
     *  `ctx.getBattlefieldIds`). Composes with every other clause, including
     *  `isToken` — Ocelot Pride's "a creature entered the battlefield under
     *  your control this turn" is `{ isToken: true, enteredThisTurn: true }`
     *  for its token-only variant, or `enteredThisTurn: true` alone for any
     *  creature. */
    enteredThisTurn?: boolean;
    /** "…that they controlled since the beginning of the turn" (Keldon
     *  Twilight, PLS) — a battlefield permanent matches if the player whose
     *  battlefield is being scanned has controlled it CONTINUOUSLY since this
     *  turn began. Read off `hasControlledSinceTurnStart`
     *  (`gre/controlContinuity.ts`), which combines the `enteredOnTurn` entry
     *  stamp with the turn-scoped `GameState.controlChangedThisTurn` ledger.
     *
     *  Strictly stronger than `enteredThisTurn: false`: that clause sees only
     *  ZONE changes, so a creature stolen (or handed back) mid-turn would slip
     *  through it. Use this one whenever the oracle text says "controlled
     *  since"; use `enteredThisTurn` for "entered the battlefield this turn".
     *
     *  Battlefield-only, exactly like `enteredThisTurn` / `isToken`:
     *  `matchesCardFilter` (the hidden-zone matcher) does not check it — a card
     *  in hand or a library has no controller at all (CR 108.4). Propagated
     *  onto `PermanentFilter.controlledSinceTurnStart` by `toPermanentFilter`,
     *  and admitted by the Effect Script validator ONLY at battlefield-
     *  guaranteed selector sites (`allowControlledSinceTurnStart`), so a
     *  hidden-zone script carrying it fails validation instead of silently
     *  matching everything. */
    controlledSinceTurnStart?: boolean;
    excludeType?: CardType | CardType[];
    /** Match cards by exact printed name (CR 201.2 — "each other card named
     *  Accumulated Knowledge", Relentless Rats' "cards named ~", issue #985). A
     *  FIXED literal name (matched case-sensitively against the registry
     *  name), OR a bare `{ ref: "$binding" }` naming EITHER (issue #1085) a
     *  `nameCard` Op's chosen-name binding — "put all of them with THAT name
     *  into your hand" (Desperate Research, CR 201.3 "chooses a card name") —
     *  OR (issue #1104) a `choice` Op's picks binding — "all cards with the
     *  same name as the CHOSEN CARD" (Lobotomy: "you choose a card ... Search
     *  ... for all cards with the same name as the chosen card"). Both share
     *  the identical picks-family bare-binding shape (validator-checked,
     *  mirrors the boolean bare-binding family); the interpreter resolves
     *  either at read time (`resolveNameRef`, `gre/effects/interpreter.ts`) —
     *  a `choice` binding's stored value is an INSTANCE ID (resolved to a
     *  live name via `SpellContext.getCardName`), a `nameCard` binding's is
     *  the name STRING already (never a live id, so the id lookup misses and
     *  the raw string is used as-is). An uncaptured binding (the naming/
     *  choice Op was skipped, CR 608.2b) fails the filter closed — nothing
     *  matches. ANDed with every other field. */
    name?: string | EffectRef;
    /** "With a <type> counter on it" (CR 122.6, issue #1156 — Dauthi
     *  Voidwalker: "an exiled card ... with a void counter on it"). Matches
     *  when the object carries at least `min` (default 1) counters of `type`.
     *  Meaningful only for a card-SHAPE that actually tracks counters — today
     *  only the `choice(zone: "exile")` branch's `getExileCards` snapshot
     *  carries a `counters` map (a hand/library/graveyard card has none, CR
     *  122.6 counters live only on objects that persist as a single "thing"
     *  in a zone that supports them — battlefield permanents and, per the
     *  graveyard-bound-replacement tag, exile); a filter shape with no
     *  `counters` field fails closed (0 counters of any type). ANDed with
     *  every other field. */
    hasCounter?: { type: string; min?: number };
    /** "With <keyword>" (CR 702, issue #1097 — Canopy Surge's "each creature
     *  with flying"). Matches a BATTLEFIELD permanent whose `staticAbilities`
     *  contains this keyword string, case-sensitively (mirrors
     *  `PermanentFilter.requireAbility`, `convex/cards/filters.ts`, which
     *  `toPermanentFilter` maps this field onto 1:1 — the `count`/`forEach
     *  { set: "permanents" }` battlefield sites). Reads the LIVE/EFFECTIVE
     *  ability set, not merely the printed one: a `staticAbilities` grant
     *  (`StaticKeywordGrant`, CR 611/113.1 — an Aura granting flying, a
     *  board-conditional keyword grant) is MATERIALIZED directly onto the
     *  permanent's `staticAbilities` array at apply time
     *  (`applySourceStaticEffects`, `gre/state.ts`), so a plain
     *  `card.staticAbilities.includes(...)` check — which is exactly what
     *  `matchesPermanentFilter` already does for `requireAbility` — observes
     *  a granted keyword with no separate "effective abilities" helper
     *  needed. Meaningful only for the battlefield shape (a hand/library/
     *  graveyard card in `matchesCardFilter` carries no `staticAbilities` on
     *  its structural type — this field is a no-op there, mirroring
     *  `isToken`/`enteredThisTurn`'s own battlefield-only scope). ANDed with
     *  every other field. Single keyword only (Canopy Surge needs no OR of
     *  keywords); a future OR-across-keywords need is `any` (already OR
     *  across filter dimensions) wrapping two single-`hasAbility` clauses. */
    hasAbility?: string;
    /** "That's attacking" (CR 508.1, issue #1097 — Tangle's "each creature
     *  that's attacking"). Matches a BATTLEFIELD permanent whose live combat
     *  role is attacker, mirroring `PermanentFilter.isAttacking`
     *  (`convex/cards/filters.ts`, already read by combat-scoped choice
     *  pickers) — `toPermanentFilter` maps this field onto it 1:1, and
     *  `CardInstanceState.isAttacking` is already spread verbatim into every
     *  `getBattlefieldIds` candidate, so no new engine read is needed, only
     *  the DSL filter surface. Meaningful only for the battlefield shape (a
     *  hand/library/graveyard card in `matchesCardFilter` has no combat role
     *  at all — this field is a no-op there), mirroring `hasAbility`'s own
     *  battlefield-only scope exactly. ANDed with every other field. A single
     *  boolean, not `"attacking" | "blocking"` like
     *  `TargetRequirement.combatRoleFilter`: no shipped card needs an
     *  attacking-OR-blocking forEach sweep yet (`any` already covers that
     *  disjunction if one ever does). */
    isAttacking?: boolean;
    /** Reflexive self-EXCLUDE (issue #2373, Gut, True Soul Zealot —
     *  "sacrifice ANOTHER creature or an artifact"): a battlefield permanent
     *  matches only if it is NOT the resolving ability's own source
     *  (`ctx.sourceInstanceId`). Mirrors `TargetRequirement.excludeSource` /
     *  the `forEach { set: "permanents" }` selector's own `excludeSource`
     *  (issue #1957, Waterspout Elemental) — the identical self-exclusion
     *  primitive, generalized onto the third site that needed it (ADR 0045
     *  "generalize, don't add"): a `choice` Op picking permanents off the
     *  battlefield had no way to say "another" at all. Propagated by
     *  `toPermanentFilter` onto `PermanentFilter.excludeInstanceIds`
     *  (`convex/gre/effects/interpreter.ts`), which both the candidate scan
     *  AND the submit-time legality re-check read — a `choice`'s
     *  `PermanentFilter` is the single authority for its pick, unlike
     *  `forEach`'s own flag (which only ever needs to drop the source once,
     *  at member-set-freeze time — nothing re-validates a forEach member
     *  against a player submission). Battlefield-only, like `isAttacking` /
     *  `hasAbility` right above: `matchesCardFilter` (the hidden-zone
     *  matcher) never reads it, so it is a no-op there, and the Effect
     *  Script validator rejects it outside `zone: "battlefield"` rather than
     *  silently accepting a field that would then match every card. */
    excludeSource?: boolean;
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
 *  Life / Fireball-style scripts whose amount is exactly `ctx.getX()`. On its
 *  own it reads back the one chosen number verbatim, nothing composing it (a
 *  card like Braingeyser drawing `X` cards, Drain Life dealing `X`) — but see
 *  `EffectScaledValue` (issue #2366) for the one place a fixed multiplier
 *  scales it ("twice X"). */
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

/** kickerPaid — how many times the NAMED Kicker of the resolving spell was paid
 *  as it was cast (CR 702.33 / 702.33e), a thin JSON-pure skin over
 *  `SpellContext.getKickerPaidCount`. The PER-KICKER sibling of
 *  {@link EffectKickerCountValue}: a card with two independently payable Kickers
 *  ("Kicker {A} and/or {B}" — the Planeshift Battlemage cycle) has one
 *  intervening-if per Kicker, and a single total cannot say WHICH was paid
 *  (ADR 0079). `>= 1` is "this Kicker was paid"; the raw count is that Kicker's
 *  own Multikicker tally.
 *
 *  Like `X` / `counters` / `kickerCount` it is NOT an Op and NOT a new
 *  STRUCTURAL construct — it reads back one number and nothing composes it, so
 *  it does not reopen ADR 0045. The string is the `KickerCost.id` declared on
 *  the card; a name matching no declared Kicker reads 0 (fail-closed — the
 *  clause simply does not fire), and `validateEffectScript` rejects an empty
 *  id at authoring time. */
export type EffectKickerPaidValue = { kickerPaid: string };

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

/** Devotion (CR 700.5, issue #2070) — a player's devotion to a color: the
 *  number of mana symbols of that color among the mana costs of permanents
 *  that player controls. Mirrors {@link EffectDomainValue} exactly: a
 *  player-scoped scalar, NOT an Op, backed by a thin `SpellContext.getDevotion`
 *  skin (CR 700.5a — computed live from the structured `ManaCost`, so a
 *  permanent that left the battlefield in response no longer contributes).
 *  `of` is a PLAYER selector like Domain's, unlike `counters`/`manaValue`'s
 *  object `of`. `color` names WHICH color's devotion is read — a coloured pip
 *  of that colour counts, a `phyrexian[color]` pip counts (CR 105.2 — still a
 *  coloured mana symbol), and every `hybrid` pair CONTAINING `color` counts
 *  ONE (a `[U,R]` pair counts toward devotion to blue AND to red). Generic,
 *  `{X}`/`xFactor`, and a permanent with no mana cost (a token, a land)
 *  contribute 0. Single-colour only for now (CR 700.5's two-colour devotion
 *  sentence — "devotion to [color 1] and [color 2]" — is deferred to the
 *  first card that needs it, per the extract-on-second rule) — no `times`
 *  multiplier either, since no shipped card scales it. */
export type EffectDevotionValue = {
    devotion: { of: EffectPlayerRef; color: Color };
};

/** One operand of a `difference` value (issue #2006). Deliberately a TERMINAL,
 *  never a full `EffectValue`: a literal integer or a single `count`. Making
 *  the operand type non-recursive is the whole defence — an expression TREE
 *  (`(a - b) - c`, `a - (b * c)`) is not merely discouraged, it is
 *  unrepresentable in the type system. Deliberately excludes `X` — see
 *  `EffectScaledOperand` (issue #2366) for the sibling terminal type that
 *  adds it, kept separate so this scope stays exactly what #2006 shipped. */
export type EffectDifferenceOperand = number | EffectCount;

/** difference — `from` MINUS `minus` (issue #2006), the one place the value
 *  grammar performs arithmetic between two operands.
 *
 *  Reason to exist: Dark Suspicions (PLS) is "that player loses X life, where
 *  X is the number of cards in that player's hand minus the number of cards in
 *  your hand" — two INDEPENDENT counts, which no refinement of a single
 *  `count` can express (`times` scales ONE count by a constant; there is no
 *  second count to scale). A catalogue survey found the same surface shape on
 *  The Rack (ATQ, "3 minus the number of cards in their hand") and Storm World
 *  (LEG, "4 minus the number of cards in their hand"), which is why both
 *  operands accept a literal as well as a count.
 *
 *  What this deliberately is NOT, and must not become:
 *  - NOT a fifth STRUCTURAL construct. The frozen set stays bind/ref/if/
 *    forEach (ADR 0045); this is a fourteenth `EffectValue` MEMBER, the same
 *    kind of addition as `X` (#852), `counters` (#1015), `domain` (#1066) and
 *    `lifeGainedThisTurn` (#1457), none of which reopened the ADR.
 *  - NOT an expression grammar. There is exactly ONE operator (subtraction),
 *    exactly TWO operands, and the operands are terminals — so the value
 *    grammar stays DEPTH-1. A card wanting `a + b`, `max(a, b)` or a nested
 *    difference does not get to write it here; that is a new design decision
 *    with its own issue, not an implied door this member opened.
 *  - NOT an Op. It earns no `EFFECT_OP_REGISTRY` row (see the value-grammar
 *    census in `convex/cards/mechanicsRegistry.ts`).
 *
 *  Sign (CR 107.1b): the result is SIGNED and may be negative — "you can't
 *  choose a negative number, deal negative damage, or gain negative life", but
 *  a calculated game value can be less than zero. The clamping belongs at the
 *  CONSUMING Op, which every amount-taking Op already does (`amount <= 0`
 *  returns), and that is exactly the Oracle ruling for Dark Suspicions: when
 *  the opponent holds fewer cards than you, X is negative and no life is lost
 *  — it never becomes a life GAIN. */
export interface EffectDifferenceValue {
    difference: {
        /** Minuend — the value subtracted FROM. */
        from: EffectDifferenceOperand;
        /** Subtrahend — the value subtracted. */
        minus: EffectDifferenceOperand;
    };
}

/** One operand of a `scaled` value (issue #2366). Deliberately a SIBLING of
 *  `EffectDifferenceOperand`, not a widening of it: this type adds
 *  `EffectXValue` to the literal-or-`count` terminal set (the whole reason
 *  `scaled` exists — "twice X" needs X as a scalable operand), while
 *  `difference` stays exactly as narrow as issue #2006 shipped it. Widening
 *  `EffectDifferenceOperand` in place instead of adding this sibling would
 *  have silently re-opened `difference` to an `X` operand it was deliberately
 *  never given — `validateEffectScript`'s own difference test rejects
 *  `{ difference: { from: { X: true }, minus: 1 } }` today
 *  (`validate.test.ts`, "rejects a NESTED difference"), and that rejection is
 *  the difference member's own frozen scope, not an oversight to fix here.
 *  Still a TERMINAL, never a full `EffectValue`: an expression tree is
 *  unrepresentable in the type system, exactly as `EffectDifferenceOperand`
 *  documents. */
export type EffectScaledOperand = number | EffectCount | EffectXValue;

/** scaled — a fixed positive-integer multiplier times a terminal value (issue
 *  #2366), the value grammar's multiplication counterpart to `difference`'s
 *  subtraction. A FOURTEENTH `EffectValue` grammar member; like `difference`
 *  it IS new grammar (arithmetic), but like every member since `X` (#852) it
 *  is NOT an Op and NOT a new STRUCTURAL construct — the frozen set stays
 *  bind/ref/if/forEach (ADR 0045).
 *
 *  Reason to exist: Pest Infestation ("create twice X 1/1 Pest tokens", C21,
 *  #2369) needs `2 * X`. `EffectXValue`'s own doc comment says plainly
 *  "nothing composes it" — reading X back verbatim was the whole contract.
 *  `EffectDomainValue.times` is the nearest shipped precedent for a
 *  fixed-literal multiplier (Wandering Stream's "gain TWO life for each
 *  basic land type"), but it is baked into ONE member (Domain) and cannot
 *  scale an arbitrary terminal — generalizing THAT shape, rather than
 *  minting a card-shaped `{ twiceX: true }`, is "generalize, don't add"
 *  (`.claude/rules/gre-development.md` § Primitive reuse) applied here: the
 *  `{ of/value, times }` scaling shape already shipped once, this reuses it
 *  for the general terminal-operand grammar instead of one player-scoped
 *  read.
 *
 *  Depth-1 discipline (ADR 0045's frozen-grammar defence, matching
 *  `EffectDifferenceValue`'s own doc comment verbatim): exactly ONE
 *  operator (multiplication), exactly ONE non-literal operand, and that
 *  operand is a TERMINAL (`EffectScaledOperand`) — never a full
 *  `EffectValue`. `{ scaled: { value: { scaled: {...} }, times: n } }` is
 *  grammatically impossible: `EffectScaledOperand` does not include
 *  `EffectScaledValue`. `times` itself is a plain positive-int literal
 *  (mirrors `EffectCountSpec.times` / `EffectDomainValue.times`, issue
 *  #999's rule) — never a ref/X/nested value, for the identical reason a
 *  second value slot there would reopen the expression grammar.
 *
 *  Parametrizing `EffectDifferenceValue` instead was considered and
 *  rejected: `difference` SUBTRACTS two independent terminals — there is no
 *  multiplication to parametrize onto it, and "twice X" is one operand
 *  scaled by a constant, not two operands combined.
 *
 *  CR 107.1b: unlike `difference`, no sign clamp is needed here — every
 *  `EffectScaledOperand` case is non-negative by construction (a positive-int
 *  literal, a `count`'s cardinality, or CR 107.3's non-negative chosen X) and
 *  `times` is a positive int, so the product is always non-negative. */
export interface EffectScaledValue {
    scaled: {
        /** The terminal value being scaled. */
        value: EffectScaledOperand;
        /** Fixed positive-integer multiplier. */
        times: number;
    };
}

/** divide — a terminal DIVIDED by a fixed positive-integer divisor, rounded
 *  toward the stated direction (issue #2385, Tamiyo, Seasoned Scholar's
 *  ultimate: "Draw cards equal to half the number of cards in your library,
 *  rounded up"). A FIFTEENTH `EffectValue` grammar member, `scaled`'s
 *  division counterpart (`difference` subtracts, `scaled` multiplies,
 *  `divide` divides) — same non-Op, non-ADR-0045-reopening status as every
 *  member since `X` (#852): a value member, not a structural construct.
 *
 *  Operand type is `EffectDifferenceOperand` (a literal or a `count`), NOT
 *  `EffectScaledOperand` — no shipped divide card needs `X` as the dividend,
 *  so the operand stays as narrow as `difference`'s (mirrors why `scaled`
 *  needed its OWN wider operand type rather than widening
 *  `EffectDifferenceOperand` in place: adding X here "just in case" would
 *  silently reopen a type nothing asks for). Still a TERMINAL — depth-1,
 *  matching `difference`/`scaled`.
 *
 *  `by` is a plain positive-integer literal divisor (mirrors `scaled.times` —
 *  literal only, never a ref/X/nested value; dividing by a VARIABLE amount is
 *  a different, unimplemented feature). `rounding` is mandatory, no default:
 *  CR 107.1a — "if a spell or ability could generate a fractional number, the
 *  spell or ability will tell you whether to round up or down" — MTG never
 *  rounds to nearest or truncates toward zero, so the field forces every card
 *  author to say which the Oracle text specifies rather than silently picking
 *  one.
 *
 *  CR 107.1b: unlike `difference`, the dividend here is a `count` or a
 *  non-negative literal (never negative by construction — cardinalities and
 *  positive-int literals only), so the quotient is always non-negative and
 *  needs no sign clamp. */
export interface EffectDivideValue {
    divide: {
        /** The terminal value being divided. */
        value: EffectDifferenceOperand;
        /** Fixed positive-integer divisor. */
        by: number;
        /** CR 107.1a — which way to round a fractional result. */
        rounding: "up" | "down";
    };
}

/** A runtime numeric parameter of an Op (ADR 0045): a literal count, a `ref`
 *  reading a bound object's numeric property, a `count` of a selected set, the
 *  chosen-cost `X` (issue #852), a `counters` count on a selected object
 *  (issue #1015), a selected object's `manaValue` (issue #680), a player's
 *  `domain` (issue #1066), a permanent's `escaped` flag (issue #695), the
 *  currently-resolving triggered ability's `abilityResolutionCount` (issue
 *  #1189), the `difference` of two terminals (issue #2006), a terminal
 *  `scaled` by a fixed multiplier (issue #2366), or a terminal `divide`d by a
 *  fixed divisor with explicit rounding (issue #2385). The value grammar is
 *  capped at these — beyond `difference`'s subtraction, `scaled`'s
 *  multiplication and `divide`'s division, none of them nestable, there is no
 *  arithmetic and there are no expressions (the frozen-grammar defence, ADR
 *  0045). */
export type EffectValue =
    | number
    | EffectRef
    | EffectCount
    | EffectXValue
    | EffectCountersValue
    | EffectKickerCountValue
    | EffectKickerPaidValue
    | EffectManaValueValue
    | EffectDomainValue
    | EffectDevotionValue
    | EffectEscapedValue
    | EffectAbilityResolutionCountValue
    | EffectLifeGainedThisTurnValue
    | EffectDifferenceValue
    | EffectScaledValue
    | EffectDivideValue;

/** lifeGainedThisTurn — the total life a PLAYER has gained so far this turn
 *  (CR 119.3, issue #1457), a thin JSON-pure skin over
 *  `SpellContext.getLifeGainedThisTurn`. A THIRTEENTH `EffectValue` grammar
 *  member; like `domain` (issue #1066) and `abilityResolutionCount` (issue
 *  #1189) it is NOT an Op and NOT a new STRUCTURAL construct — it does not
 *  reopen ADR 0045.
 *
 *  `of` is a PLAYER selector (`EffectPlayerRef`) — this is a per-player
 *  scalar, exactly like `domain`'s `of` and unlike `counters`/`manaValue`'s
 *  object `of`. Resolves through the same `resolvePlayerRef` path every
 *  player-scoped Op uses, so `"controller"`, an announced slot and `$each`
 *  all work; an unresolvable player yields undefined (CR 608.2b).
 *
 *  Its reason to exist is the RETROSPECTIVE lifegain question the LIFE_GAINED
 *  event cannot answer: "if you gained life this turn" (CR 603.4 — Crested
 *  Sunmare, Ocelot Pride, Resplendent Angel), written as an `if` predicate
 *  `{ left: { lifeGainedThisTurn: { of: "controller" } }, op: "gt", right: 0 }`.
 *  Gaining 0 life never enters the tally, so that predicate is false — as the
 *  rules require. Also composes with every amount-taking Op as a magnitude
 *  ("draw cards equal to the life you gained this turn"). */
export type EffectLifeGainedThisTurnValue = {
    lifeGainedThisTurn: { of: EffectPlayerRef };
};

/** CR 702.138b — resolves to 1 if the referenced permanent ESCAPED (was cast
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

/** abilityResolutionCount — how many times (1-indexed, COUNTING this
 *  resolution) the CURRENTLY RESOLVING triggered ability has resolved this
 *  turn (CR 122 / 603.3, issue #1189), a thin JSON-pure skin over
 *  `SpellContext.getAbilityResolutionCount()`. An ELEVENTH `EffectValue`
 *  grammar member; like `domain` (issue #1066) and `escaped` (issue #695) it
 *  is NOT an Op and NOT a new STRUCTURAL construct — it does not reopen ADR
 *  0045.
 *
 *  No `of` selector: unlike `counters`/`manaValue` (object-scoped) or
 *  `domain` (player-scoped), this value is scoped to the RESOLVING STACK
 *  ITEM itself — there is exactly one "currently resolving triggered
 *  ability", so there is nothing to select. The engine tallies the count in
 *  `GameState.abilityResolutionCounts`, keyed by
 *  `${triggerSourceId}:${triggeredAbilityId}`, incremented by
 *  `resolveTopOfStackInner` exactly once per resolution — BEFORE the effect
 *  runs, so "the first time" reads 1, "the second time" reads 2, and so on.
 *  Reset to absent (0) at CLEANUP (CR 514.2) — the tally is scoped to "this
 *  turn". Composes with the comparison predicate
 *  (`{ left: { abilityResolutionCount: true }, op: "eq", right: 1 }`) to
 *  drive an escalating-branch effect (Omnath, Locus of Creation's
 *  first/second/third-resolution modes; Scythecat Cub's "double on the
 *  second time" clause). Only meaningful at a TRIGGERED-ability effect
 *  site — the engine only increments the tally on the triggered-ability
 *  resolution path (`gre/state.ts`); reading it anywhere else (a spell, an
 *  activated ability) always resolves to 0 (no `triggerSourceId` /
 *  `triggeredAbilityId` to key by). */
export type EffectAbilityResolutionCountValue = {
    abilityResolutionCount: true;
};

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
 *  to animate the outcome). `effects` is an Op list, run through the SAME
 *  `runOpList` path an `if` branch / `optionChoice` mode uses, so it composes
 *  bind / ref / if / forEach and even a further suspending Op. `effects` MAY
 *  be EMPTY — a deliberate no-op branch (issue #1367): a card whose flip does
 *  something on only ONE outcome (Mana Crypt — "if you LOSE, deal 3 damage",
 *  the win branch does nothing) sets the other branch to `effects: []` rather
 *  than being padded with a placeholder Op. `runOpList` iterates the list, so
 *  an empty one is a clean no-op — no interpreter special-casing needed. */
export interface EffectCoinFlipBranch {
    /** One-liner previewed on the WIN/LOSE reveal overlay ("Create a 5/5
     *  Djinn"). Required — `requestCoinFlip` shows it as the landed face's
     *  consequence. */
    consequence: string;
    /** Ops run when the flip lands on this branch's outcome. May be empty
     *  (a deliberate no-op branch, issue #1367). */
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
          /** Reflexive self-EXCLUDE (issue #1957, Waterspout Elemental —
           *  "return all OTHER creatures to their owners' hands"): when
           *  `true`, drops the resolving ability/spell's own source
           *  (`ctx.sourceInstanceId`) from the frozen member set. Mirrors
           *  `TargetRequirement.excludeSource` exactly (ADR 0045 "generalize,
           *  don't add" — a symmetric field on an existing pattern, not a new
           *  primitive), just exposed on the non-targeted mass-sweep selector
           *  a `forEach` uses instead of an announced target set. Applied
           *  AFTER `filter`/`controller` narrow the candidate set, so it
           *  composes with either. A no-op when the source is not itself a
           *  member of the selected set. */
          excludeSource?: boolean;
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
    | { set: "bound"; ref: string }
    /** Iterate the CURRENTLY-RESOLVING spell/ability's announced targets
     *  (issue #1083) — the variable-N companion to a fixed-slot `target: N`
     *  `EffectObjectSelector`. Closes the "X-multi-target" gap: a
     *  `TargetRequirement.count: "X"` (Distorting Wake's "Return X target
     *  nonland permanents") or a `{ min: 0 }` "any number of target creatures"
     *  (Sway of Illusion) requirement announces a VARIABLE number of targets
     *  into ONE requirement slot, all landing in `ctx.targets` — but
     *  `EffectObjectSelector`'s `{ target: N }` only ever names ONE fixed
     *  index. `{ set: "targets" }` iterates the WHOLE announced set instead:
     *  every entry of `ctx.targets` whose kind is a permanent (CR 608.2b —
     *  a non-permanent entry, unreachable for the shipped target types this
     *  selector pairs with, is skipped rather than erroring). `$each` binds a
     *  permanent snapshot exactly like the `permanents` set (object positions
     *  take the bare `{ ref: "$each" }`). No `controller`/`filter` — the
     *  member set is already exactly what `TargetRequirement`/target
     *  legality picked at announcement (CR 601.2c), so a SECOND filter here
     *  would be redundant; unlike `permanents` (a fresh battlefield SCAN),
     *  this selector reads the targets already chosen. No fixed size — it
     *  spans however many targets were actually announced (0 for a declined
     *  "any number", up to X for a variable-count spell). */
    | { set: "targets" };

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
 *    to all players (CR 701.21) as the selector resolves (Fact or Fiction).
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
    | "choose-graveyard-card"
    // Dauthi Voidwalker (issue #1156) — pick ONE card from an EXILE zone,
    // filtered via `EffectCardFilter.hasCounter` ("an exiled card an
    // opponent owns with a void counter on it"). See `ZonePickKind`
    // (`gre/types.ts`) for the full design note.
    | "choose-exile-card";

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
/** One mode of the RESOLVE-TIME `optionChoice` Op. Deliberately carries NO
 *  `targetRequirement`: targets of a printed modal spell/ability are declared
 *  at announcement (CR 601.2c), which is what `SpellMode` / `AbilityMode`
 *  model — see the `optionChoice` Op's own note and ADR 0089. */
export interface EffectMode {
    label: string;
    effects: EffectOp[];
    id?: string;
    /** Set when this mode IS a choice of color (CR 105.1) — e.g. one mode per
     *  color in `colorChoiceModes` / `protectionColorModes` (ADR 0045's
     *  `optionChoice` composing "choose a color of five/six"). Threaded
     *  verbatim onto the resulting `PendingChoice.options[].color` so the
     *  frontend renders a `ManaSymbol` icon instead of a plain text button —
     *  never set for a non-color modal choice (Primal Clay's body modes). */
    color?: Color;
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
          /** CR 120.1 — the source of the damage. By default (omitted) the
           *  damage is sourced from the resolving spell/ability (the stack
           *  item), which is correct for the vast majority of "deal N damage"
           *  cards. When set, it names a bound PERMANENT (e.g. a `$c` snapshot
           *  from a preceding `tapUntap`/`destroy` bind) that is the CR-120.1
           *  source instead — Backlash ("Tap target untapped creature. THAT
           *  creature deals damage equal to its power to its controller"): the
           *  tapped CREATURE is the source, not the B/R spell, so
           *  infect/lifelink, source-colour prevention/protection and "a source
           *  deals damage" triggers all key off the creature's identity (CR
           *  120.1). Routed through the permanent-source pipeline
           *  (`SpellContext.dealDamageFromPermanent` →
           *  `dealDamageFromPermanentToPlayer`); only meaningful with a
           *  `{ player: … }` recipient. No-op if the named permanent has left
           *  the battlefield (CR 608.2b). */
          source?: EffectObjectSelector;
          /** CR 615 — when true, the damage skips prevention shields (Urza's
           *  Rage's kicked mode: "the damage can't be prevented"). Omitted/false
           *  is the default preventable path every other `dealDamage` card
           *  uses. See `SpellContext.dealDamage`'s doc comment for exactly
           *  which CR 615 checks this suppresses (CR 614 replacement and CR
           *  702.16 protection are unaffected). */
          unpreventable?: boolean;
      }
    /** CR 601.2d / 120.4 — deal `total` damage DIVIDED AS YOU CHOOSE among the
     *  spell/ability's announced targets (Arc Lightning, Fiery Justice, Meteor
     *  Shower, Fury, Arc Mage, Fire Covenant). The per-target split is chosen at
     *  ANNOUNCEMENT (`targetRequirement.divideAsChosen`, each target ≥1) and
     *  snapshotted onto the stack item's `targetAmounts`; this Op reads that
     *  snapshot back at resolution. A thin declarative skin over the single
     *  `SpellContext.dealDamageDividedAsChosen` primitive over the WHOLE
     *  announced target group (`ctx.targets`) — unlike the single-`to`
     *  `dealDamage` Op — one execution path (ADR 0045). `total` reuses the exact
     *  `divideAsChosen.total` vocabulary (`number | "X" | "X+1"`): a fixed
     *  amount, the announced {X} (`getX()`, Fire Covenant's pay-X-life), or X+1
     *  (Meteor Shower's "X plus 1 damage"). Must MIRROR the card's
     *  `divideAsChosen.total` — the two are the announcement/resolution halves of
     *  the same value. No-op if there are no targets or the total is ≤0. */
    | { op: "dealDamageDividedAsChosen"; total: number | "X" | "X+1" }
    /** CR 121.1 — `player` draws `count` cards. */
    | { op: "draw"; player: EffectPlayerRef; count: EffectValue }
    /** CR 119.3 — `player` gains `amount` life. */
    | { op: "gainLife"; player: EffectPlayerRef; amount: EffectValue }
    /** CR 122.1 — "you get {E}": `player` gets `amount` energy counters. A thin
     *  declarative skin over `SpellContext.addEnergy` (mirroring `gainLife`),
     *  one execution path (ADR 0045). Energy is a player-owned resource counter
     *  (not on an object), so `player` is a player ref — never an object slot.
     *  Skipped when the player cannot be resolved (CR 608.2b). */
    | { op: "getEnergy"; player: EffectPlayerRef; amount: EffectValue }
    /** CR 119.3 — `player` loses `amount` life (not damage — no
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
    /** CR 614.10 (issue #1957, Waterspout Elemental) — `player` skips their
     *  next turn. A thin declarative skin over `SpellContext.setSkipNextTurn`,
     *  one execution path (ADR 0045): the same primitive Time Vault's
     *  pre-DSL activated-ability `resolve()` already calls (`lea/colorless.ts`)
     *  and the `PlayerState.skipNextTurn` COUNT `advanceTurn` (phases.ts)
     *  decrements at each turn boundary. `player` is an announced target slot,
     *  the resolving controller, or a relative player. Skipped when the
     *  player cannot be resolved (CR 608.2b).
     *
     *  COUNT, not boolean (CR 614.10a): "If two effects each cause a player
     *  to skip their next occurrence, that player must skip the next two;
     *  one effect will be satisfied in skipping the first occurrence, while
     *  the other will remain until another occurrence can be skipped." Two
     *  resolutions of this Op against the same player accumulate — the
     *  primitive INCREMENTS `skipNextTurn` rather than setting a flag, so a
     *  player hit twice skips two turns, never collapsing to one. Mirrors
     *  `extraTurns`' own queue shape (CR 500.7) for the same reason: a turn
     *  effect that can legitimately stack more than once cannot be a
     *  boolean. */
    | { op: "skipNextTurn"; player: EffectPlayerRef }
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
    /** CR 504.1 / 500.8 (issue #1097 — Elfhame Sanctuary's "you skip your
     *  draw step this turn"). A thin declarative skin over
     *  `SpellContext.skipDrawStepThisTurn`, one execution path (ADR 0045):
     *  `player` names whose draw step to skip — the resolving controller for
     *  every shipped card, but an announced slot / relative player is not
     *  precluded by the grammar. The player's id is added to
     *  `state.skipDrawStepThisTurn`, consumed by `advancePhase`
     *  (`gre/phases.ts`) the next time the DRAW step is entered for that
     *  player this turn — per CR 500.8 a skipped step doesn't happen at all,
     *  so the whole step (turn-based draw, CR 504.2 delayed triggers, and
     *  CR 603.6a beginning-of-step triggers like Howling Mine) is bypassed,
     *  not merely the draw — and cleared unconditionally at CLEANUP as a
     *  turn-1 safety net. Skipped when the player cannot be resolved (CR
     *  608.2b). Distinct from `drawStepReplacement` (`CardDefinition`,
     *  Fasting): that is a static per-card flag offering an interactive
     *  may-skip choice AT the draw step itself; this Op arms a plain
     *  one-shot flag from a DIFFERENT step's effect, with no choice left
     *  once armed. */
    | { op: "skipDrawStepThisTurn"; player: EffectPlayerRef }
    /** CR 601.3e (Teferi, Time Raveler +1: "Until your next turn, you may cast
     *  sorcery spells as though they had flash") — grant `player` a per-player
     *  casting-timing PERMISSION: they may cast spells whose printed types
     *  intersect `cardTypes` at instant speed (as though they had flash). A
     *  thin declarative skin over `SpellContext.grantCastTiming`, one execution
     *  path (ADR 0045). The player's id is added to
     *  `state.castTimingFlashGrants`, read by the shared cast gate
     *  (`hasCastTimingFlashGrant`, `convex/cards/castRestrictions.ts`) that
     *  both the GRE `getLegalActions` and the client legal-actions view honor.
     *  Cleared at the START of that player's next turn (via `advanceTurn`) —
     *  the "until your next turn" boundary (CR 514.2 analogue), NOT CLEANUP,
     *  mirroring `islandSanctuaryProtection`. `cardTypes` narrows the grant to
     *  the listed card types (Teferi: `["Sorcery"]`); omitted grants flash for
     *  every spell. Skipped when the player cannot be resolved (CR 608.2b). The
     *  inverse of `restrictCasting` (a timing lock) — a permission, not a
     *  restriction; a sorcery-speed LOCK on the same player overrides it. */
    | {
          op: "grantCastTiming";
          player: EffectPlayerRef;
          cardTypes?: CardType[];
      }
    /** CR 305.1-analog / 601 (issue #1149) — grant `player` a turn-scoped,
     *  player-wide permission to play lands and/or cast spells from their OWN
     *  graveyard (Yawgmoth's Will: "Until end of turn, you may play lands and
     *  cast spells from your graveyard"). A thin declarative skin over
     *  `SpellContext.grantGraveyardPlay`, one execution path (ADR 0045).
     *  `zones` lists which card kinds the grant covers — `"land"` and/or
     *  `"spell"`; omitted defaults to BOTH (the Yawgmoth's Will shape).
     *  `maxManaValue` optionally caps the SPELL half's mana value (unused by
     *  Yawgmoth's Will — lands have no mana cost and are unaffected — but the
     *  SAME parametrized shape a future SCOPED grant would reuse, mirroring
     *  how `grantedFlashback` generalizes Snapcaster's single-card case).
     *  Read live off `state.graveyardPlayPermissionThisTurn` by
     *  `canPlayLandsFromGraveyard` (the land half) and `getLegalActions` /
     *  `locateCastSource` (the spell half); cleared unconditionally at
     *  CLEANUP (CR 514.2), the same boundary as `restrictCasting` /
     *  `restrictActivation`. Skipped when the player cannot be resolved
     *  (CR 608.2b). */
    | {
          op: "grantGraveyardPlay";
          player: EffectPlayerRef;
          zones?: Array<"land" | "spell">;
          maxManaValue?: number;
      }
    /** CR 614 (issue #1145 / #1149) — arms a turn-scoped "if a card would be
     *  put into `player`'s graveyard from anywhere this turn, exile that card
     *  instead" redirect (Yawgmoth's Will's second clause). A thin
     *  declarative skin over `SpellContext.armGraveyardRedirectThisTurn`
     *  (shipped by issue #1145 as engine infra with no Op skin yet), one
     *  execution path (ADR 0045). Distinct from a permanent-bound
     *  `replacementEffects[]` entry with `eventKind: "graveyard-bound"`
     *  (Dauthi Voidwalker) — that lasts only as long as its source stays on
     *  the battlefield, while this survives the casting spell leaving the
     *  stack. Cleared unconditionally at CLEANUP (CR 514.2). Skipped when the
     *  player cannot be resolved (CR 608.2b). */
    | { op: "armGraveyardRedirect"; player: EffectPlayerRef }
    /** CR 601.3e / 117.6 (issue #1156) — grant `player` permission to cast/play
     *  the EXILE card a preceding `choice(zone: "exile")` Op picked (a bare
     *  picks ref, `card`), optionally ALSO waiving its mana cost. A thin
     *  declarative skin over `SpellContext.grantCastFromExile`, one execution
     *  path (ADR 0045) — the "close to free" wrap issue #1145's addendum
     *  comment flagged as a follow-up once the redirect-replacement (Dauthi
     *  Voidwalker's first ability) shipped. `card`'s owner (looked up via
     *  `getExileCardOwner`, since the picked card may sit in an OPPONENT's
     *  exile per CR 400.7) becomes `grantCastFromExile`'s `zoneOwnerId` —
     *  this is what makes the grant work CROSS-PLAYER (Robber of the Rich's
     *  shape) without a separate Op. `window` mirrors the primitive's own
     *  (`"this-turn"` / `"while-exiled"`, default `"while-exiled"`); Dauthi
     *  Voidwalker passes `"this-turn"` ("you may play it THIS TURN").
     *  `withoutPayingManaCost` (default false) is Dauthi's differentiator
     *  from Ice Cauldron/Robber of the Rich, which grant permission only.
     *  `includesLand` (default false, CR 305.9, issue #1689) — true when
     *  the granting Oracle text says "play" rather than "cast" (Dauthi
     *  Voidwalker: "you may play it this turn..."); only then does a LAND
     *  under the grant become playable — see `SpellContext.grantCastFromExile`'s
     *  doc. Skipped when `player` can't be resolved, the picks binding was
     *  never captured, or the picked card is no longer in any exile (CR
     *  608.2b). */
    | {
          op: "grantCastFromExile";
          /** Which exiled card the permission reaches. Two shapes:
           *   - a bare PICKS ref (`{ ref: "$picked" }`) — the card a preceding
           *     `choice(zone: "exile")` Op bound (Dauthi Voidwalker);
           *   - `{ exiledWithSource: true }` (CR 607 linked abilities, issue
           *     #783) — the card(s) the SOURCE permanent itself exiled and
           *     stamped via `SpellContext.linkExileToSource`, read back through
           *     `getCardsExiledWith(ctx.sourceInstanceId)`. This is the shape a
           *     LINKED pair of abilities needs ("look at the top N, exile one
           *     face down" + "you may play THE EXILED CARD"): the grant must
           *     reach exactly the card the first ability exiled, with no player
           *     choice and no binding to carry across two separate abilities'
           *     resolutions. Skipped when the source linked nothing (CR
           *     608.2b). */
          card: EffectRef | EffectExiledWithSourceSelector;
          player: EffectPlayerRef;
          window?: "this-turn" | "while-exiled";
          withoutPayingManaCost?: boolean;
          includesLand?: boolean;
      }
    /** CR 601.3e / 117.6-analog (issue #1344) — grant `player` permission to
     *  cast a GRAVEYARD card, optionally ALSO waiving its mana cost. `card`
     *  names it in either of the two shapes an effect can reach one
     *  (`EffectObjectSelector`, issue #1650):
     *   - a bare PICKS ref (`{ ref: "$discarded" }`) — the card a preceding
     *     Op bound, typically the just-discarded card from a
     *     `choice(kind: "choose-hand-card")` + `discard` pair (Malcolm);
     *   - an announced TARGET slot (`{ target: 0 }`, CR 601.2c) — the
     *     graveyard card the ability targeted (Emry, Lurker of the Loch:
     *     "{T}: Choose target artifact card in your graveyard. You may cast
     *     that card this turn."). The slot must hold a `graveyard-card`
     *     selection; anything else (or a vanished slot) skips the Op
     *     (CR 608.2b).
     *  A thin declarative skin over
     *  `SpellContext.grantCastFromGraveyard`, one execution path (ADR 0045)
     *  — the graveyard-sourced twin of `grantCastFromExile` (issue #1156),
     *  generalizing the SAME per-card grant shape to a second zone rather
     *  than adding a card-shaped primitive (Malcolm, Alluring Scoundrel: "If
     *  there are four or more chorus counters on Malcolm, you may cast the
     *  discarded card without paying its mana cost"). Always SAME-PLAYER
     *  (`player`'s own graveyard) — no `zoneOwnerId`, since no cross-player
     *  graveyard-cast primitive exists (`castZoneOwner`'s doc,
     *  `convex/game.ts`). `window` mirrors the exile primitive's own
     *  turn-scoping (`"this-turn"` / `"while-in-graveyard"`, default
     *  `"while-in-graveyard"`).
     *
     *  DIVERGENCE (issue #1344, out of scope): Malcolm's Oracle ruling
     *  requires the free cast to happen immediately, as part of the
     *  triggered ability's own resolution ("you can't wait to cast the
     *  spell later in the turn," ignoring the discarded card's own timing
     *  restrictions). This Op instead grants an ordinary `"this-turn"`
     *  impulse cast window — the SAME simplification every other
     *  impulse-cast card in this engine already relies on (Expressive
     *  Iteration, Headliner Scarlett via `grantCastFromExile`), none of
     *  which need the stricter "during resolution, ignore timing"
     *  behaviour their own Oracle text doesn't ask for. A forced-inline,
     *  timing-restriction-ignoring cast is a distinct engine capability
     *  with no other consumer yet — out of scope for this issue.
     *
     *  `withoutPayingManaCost` (default false) waives the mana cost
     *  entirely — OMIT it for an ordinary "you may cast that card this turn"
     *  grant that still charges the card's own costs (Emry). Skipped when
     *  `player` can't be resolved, the picks binding was never captured /
     *  the target slot is empty or non-graveyard, or the named card is no
     *  longer in that player's graveyard (CR 608.2b). */
    | {
          op: "grantCastFromGraveyard";
          card: EffectObjectSelector;
          player: EffectPlayerRef;
          window?: "this-turn" | "while-in-graveyard";
          withoutPayingManaCost?: boolean;
          /** CR 614.1 / 400.7 (issue #2380) — the granted cast also EXILES the
           *  card as it leaves the stack instead of putting it into its
           *  owner's graveyard: Jace, Telepath Unbound's −3, "You may cast
           *  target instant or sorcery card from your graveyard this turn. If
           *  that spell would be put into your graveyard, exile it instead."
           *  Routes through the SAME `exileOnResolve` stack-item flag
           *  Flashback's CR 702.34a exile uses (`graveyardCastStackFlags`,
           *  `convex/game.ts`) — one exile-as-it-leaves-the-stack path, not a
           *  second parallel one. Orthogonal to `withoutPayingManaCost`. */
          exilesOnResolve?: boolean;
      }
    /** CR 608.2g (issue #1477) — PLAY a card as PART OF THIS resolution: a
     *  "you may cast/play <card>" permission with NO stated duration, which per
     *  CR 608.2g exists ONLY during the resolution of the ability that grants
     *  it. The controller (`player`) is offered an optional Cast/Decline prompt
     *  and, if they accept, the card (`card`, a bare picks ref to a bound card
     *  such as Malcolm's just-discarded card) is cast INLINE — put onto the
     *  stack right below the resolving ability, collecting its own
     *  targets/modes/X through the resolve-time suspend/resume seam. Crucially,
     *  distinct from `grantCastFromGraveyard`/`grantCastFromExile` (which stamp
     *  a later-in-turn impulse window): no priority is granted between the
     *  offer and the inline cast, the card CANNOT be saved for later, and the
     *  card's own timing / card-type restrictions are ignored — CR 117.1a /
     *  302.1 / 307.1 grant their timing permissions to "a player WHO HAS
     *  PRIORITY", and casting during a resolution happens outside priority, so
     *  the effect itself is the permission (a creature or sorcery is effectively
     *  castable at instant speed, including on the opponent's turn). A
     *  resolve-time mini-cast reusing `SpellContext.castChosenSpell` (ADR 0037,
     *  self-cast: actingPlayer == controller).
     *
     *  `source` is the zone the card is played FROM (`"graveyard"` — Malcolm; or
     *  `"exile"`). `free` (default false) waives the mana cost entirely
     *  (Malcolm's "without paying its mana cost"); omit it for a pay-normal-cost
     *  cast — the paid path prompts for X / additional costs and auto-taps the
     *  card's real mana cost, treating an unpayable cost as a decline (CR
     *  601.2g). Silent pass (CR 608.2b — no prompt, nothing played) when
     *  `player` can't be resolved, the card selector resolved to nothing, or the
     *  card is no longer in `source`.
     *
     *  Two mutually-exclusive card SOURCES (issue #1478):
     *   - `card` + `source` — the card selector, cast from its graveyard/exile
     *     zone. Either a bare PICKS ref to a card an earlier Op in the SAME
     *     script bound (Malcolm's just-discarded card), or — for a CR 607 LINKED
     *     pair of abilities, where a `bind` cannot span two separate resolutions
     *     — `{ exiledWithSource: true }` (issue #1961), the card(s) this
     *     ability's own source permanent exiled and stamped via
     *     `SpellContext.linkExileToSource` (Hideaway's "you may play the exiled
     *     card"; `source` must be `"exile"`). Exactly the selector
     *     `grantCastFromExile` already accepts.
     *   - `fromTopOfLibrary: true` — exile the top card of the caster's library
     *     UNCONDITIONALLY (CR 608.2g) and offer THAT card, cast from exile; a
     *     decline / unpayable cost leaves it in exile (Chandra, Torch of
     *     Defiance's +1). `card`/`source` are omitted in this shape.
     *
     *  `includesLand` (default false, CR 116.2a / 305, issue #1961) — set it
     *  ONLY when the granting Oracle text says "PLAY" rather than "cast"
     *  (Hideaway). Playing a land is a SPECIAL ACTION, not casting (CR 116.2a),
     *  so with `includesLand` unset a land silently passes — the official Malcolm
     *  land ruling, deliberately preserved for every "cast" grant. With it set,
     *  a land named by the selector is offered as a resolve-time land PLAY, and
     *  the land branch is genuinely NARROWER than the cast branch rather than
     *  instant-speed:
     *   - CR 305.2a — a land played during a resolution counts against the
     *     player's land drop, so playing it CONSUMES the drop;
     *   - CR 305.3 — a player can't play a land when it isn't their turn, so a
     *     hidden land is simply not playable on the opponent's turn;
     *   - CR 305.2b — nor playable at all once the drop is spent.
     *  In each of those cases the Op passes SILENTLY ("ignore any part of an
     *  effect that instructs a player to do so", CR 305.3) — no dead prompt, no
     *  error, and the resolution completes cleanly. CR 305.9: a card that is
     *  both a land and another type can only be PLAYED as a land, never cast, so
     *  the land branch always wins for such a card.
     *
     *  `resultBind` (optional, issue #1478) names a BOOLEAN outcome binding — set
     *  `true` only when a spell actually reached the stack (or a land actually
     *  entered), `false` on decline / silent pass / unmeetable-or-unpayable cost
     *  — that a downstream `if` predicate reads (Chandra's "If you don't [cast
     *  it], Chandra deals 2 damage to each opponent": `{ not: { binding:
     *  "$cast" } }`). Mirrors `mayPay`'s `["yes"]`/`["no"]` payload. */
    | {
          op: "castDuringResolution";
          card?: EffectRef | EffectExiledWithSourceSelector;
          player: EffectPlayerRef;
          source?: "graveyard" | "exile";
          fromTopOfLibrary?: boolean;
          free?: boolean;
          includesLand?: boolean;
          resultBind?: string;
      }
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
     *  regeneration-shield replacement (CR 701.19c) while indestructible
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
    /** CR 608.2 (issue #1097) — the resolving spell instructs itself to be
     *  EXILED instead of going to its owner's graveyard (CR 608.2m default),
     *  as the last thing it does ("Exile ~", Recall / Restock). A thin
     *  declarative skin over the pre-existing SpellContext primitive
     *  `exileSelf` (previously reachable only from a `resolve()` closure —
     *  Recall, `leg/blue.ts`), one execution path (ADR 0045). No
     *  parameters — the primitive flags the CURRENTLY-RESOLVING stack item
     *  (`exileOnResolve`), which `finalizeSpellResolution` (`gre/state.ts`)
     *  checks BEFORE the normal graveyard placement; no-op for an ability (no
     *  card to move) or a spell copy (CR 707.10 — a copy ceases to exist, it
     *  is never exiled). Mirrors `shuffleSelfIntoLibrary` (issue #898)
     *  exactly, but redirects to exile instead of a shuffled library. */
    | { op: "exileSelf" }
    /** CR 603.7a / 701.13 / ADR 0028 — exile the announced target permanent
     *  keyed to `$source` (the resolving ability's source), arming an
     *  exile-and-return bundle a later `returnExiledForSource` Op restores.
     *  The O-Ring / Banishing Light / Oblivion Ring / Tawnos's Coffin family.
     *  A thin declarative skin over `SpellContext.exileWithAttachments`, ONE
     *  execution path (ADR 0045); the bundle's `sourceId` is ALWAYS
     *  `ctx.sourceInstanceId` (never author-supplied — the return must key to
     *  the resolving source, so it is not a field). `returnTapped` returns the
     *  host tapped (default false). `includeAttachments` bundles the host's
     *  Auras/Equipment to travel WITH it into exile and return re-attached (CR
     *  701.13 — Tawnos's Coffin / Safe Haven); default FALSE — the host-only
     *  O-Ring behaviour where the host's Auras die to the orphan-aura SBA (CR
     *  704.5n) and its Equipment detaches and stays on the battlefield. No-op
     *  if the target has left the battlefield (CR 608.2b). */
    | {
          op: "exileWithAttachments";
          target: EffectObjectSelector;
          returnTapped?: boolean;
          includeAttachments?: boolean;
      }
    /** CR 603.7a / ADR 0028 — return every exile-and-return bundle keyed to
     *  `$source` (armed by an earlier `exileWithAttachments` Op): the host
     *  re-enters under its owner's control (tapped if the bundle noted so,
     *  carrying its noted counters) and any bundled Auras re-enter attached
     *  (CR 303.4). A thin declarative skin over
     *  `SpellContext.returnExiledForSource(ctx.sourceInstanceId)`, ONE
     *  execution path (ADR 0045); carries no parameters — the source is always
     *  the resolving ability's own source. Lives on the source's "leaves the
     *  battlefield / becomes untapped" trigger. No-op if `$source` holds no
     *  bundle (the return trigger's `holdsExileBundle` condition normally gates
     *  it, but a stale fire is harmless). */
    | { op: "returnExiledForSource" }
    /** CR 701.3a/701.3c (ADR 0065, issue #1311) — attach `$source` to the
     *  announced target permanent, without `$source` leaving the
     *  battlefield. A thin declarative skin over `SpellContext.attachTo`, one
     *  execution path (ADR 0045). Reconfigure's first activated ability (CR
     *  702.151a — "[Cost]: Attach this permanent to another target creature
     *  you control"); a future plain-Equip card (#776) reuses the SAME Op —
     *  Equip is just the ability shell (`sorcerySpeedOnly` + `targetRequirement`),
     *  this Op is the CR 701.3 keyword action underneath it. No-op if the
     *  target has left the battlefield (CR 608.2b). */
    | { op: "attach"; target: EffectObjectSelector }
    /** CR 701.3d (ADR 0065, issue #1311) — unattach `$source` from whatever
     *  it's currently attached to, leaving it on the battlefield unattached.
     *  A thin declarative skin over `SpellContext.detachFrom`, one execution
     *  path (ADR 0045). Reconfigure's second activated ability (CR 702.151a
     *  — "[Cost]: Unattach this permanent"); carries no target (CR 702.151a's
     *  unattach ability targets nothing — legality that it's CURRENTLY
     *  attached is enforced by the ability's `canActivate` gate, not by this
     *  Op). No-op if `$source` isn't currently attached. */
    | { op: "unattach" }
    /** CR 400.7 — move a card between zones (issue #839). A thin declarative
     *  skin over the SpellContext zone-movement primitives
     *  (`returnToHand` / `moveCardById` / `returnToBattlefield`), one execution
     *  path (ADR 0045). `target` names the object to move: an announced target
     *  slot (a battlefield permanent — Unsummon, Boomerang — or a graveyard
     *  card — Raise Dead, Resurrection) or a bare snapshot ref (`$source` for a
     *  self-bounce, Blinking Spirit). Its CURRENT zone is INFERRED from its kind
     *  (a permanent is on the battlefield; a graveyard-card is in the
     *  graveyard) — the Op carries no `from`. `to` is the destination:
     *  - a permanent → `hand` returns it to its owner's hand (CR 400.7;
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
     *  graveyard-card move.
     *
     *  RETURN-A-DEPARTED-OBJECT (issue #1469). A `ref` naming a snapshot bound
     *  by an EARLIER `destroy` / `exile` / `sacrifice` in the same script (the
     *  "return each card put into a graveyard THIS WAY" linkage — Sorin, Lord
     *  of Innistrad's −6) refers to an object that is no longer on the
     *  battlefield, so its zone cannot be inferred from the snapshot's kind.
     *  `from` is the explicit discriminator for that case and is valid ONLY on
     *  the `target` shape with `to: "battlefield"`:
     *  - `from: "graveyard"` (the default when omitted, so every pre-existing
     *    script keeps its inferred behaviour) — re-derive the id in a
     *    graveyard at EXECUTION time;
     *  - `from: "exile"` — re-derive it in an exile zone instead (a
     *    `graveyardDestinationFor` redirect, or an `exile` Op's own bind).
     *  The re-check is the whole point: an object that never reached that zone
     *  (an indestructible / regenerated target that survived the `destroy`, a
     *  graveyard → exile replacement redirect, a token that ceased to exist —
     *  CR 704.5d) is simply not found and the Op no-ops (CR 608.2b — the
     *  effect does as much as it can). `tapped: true` (CR 110.5a) makes the
     *  returned permanent enter tapped; valid only with `to: "battlefield"`. */
    | {
          op: "moveZone";
          target: EffectObjectSelector;
          to: EffectMoveZone;
          from?: "graveyard" | "exile";
          bind?: string;
          controller?: EffectPlayerRef;
          tapped?: boolean;
          /** issue #1726 — battlefield → library at a POSITION (1-based from
           *  the top; 3 = "third from the top", Teferi, Hero of Dominaria's
           *  −3). Valid only with `to: "library"` on this shape
           *  (validator-enforced). Omitted, a battlefield permanent goes on
           *  TOP (position 1 — the "put on top of its owner's library"
           *  default), and a graveyard-card target keeps the historical
           *  `moveCardById` path (Worldspine Wurm's shuffle-in). Routes
           *  through the SpellContext primitive
           *  `putIntoLibraryFromBattlefield` (the same LTB funnel as a
           *  bounce); a library shorter than the position puts the card on
           *  the bottom (the official Teferi ruling). */
          position?: number;
          /** CR 400.7 / 607 (issue #1947, generalized #1323) — stamp
           *  `linkExileToSource` on the moved card, valid ONLY alongside
           *  `to: "exile"` (validator-enforced). The SINGLE-target twin of
           *  the `cards`-shape's own `linkToSource` (issue #1947, Skyship
           *  Weatherlight's arbitrary-count sweep): "exile up to one target
           *  card from a graveyard" (Emperor of Bones) needs the ONE exiled
           *  card linked back to the exiling permanent so its OWN later
           *  ability can name exactly this card (`getCardsExiledWith` /
           *  this Op's own `exiledWithSource` target shape below) — a
           *  "generalize, don't add" parametrization of this EXISTING
           *  announced-target shape rather than a new Op. */
          linkToSource?: boolean;
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
     *  front. `bind` (issue #1151, closing #1120 gap 3) snapshots the
     *  permanent that just entered the battlefield — valid only alongside
     *  `to: "battlefield"` (validator-enforced) — for a follow-up Op to act on
     *  it: a haste grant, a `delayedTrigger` capture ("You may put a creature
     *  card from your hand onto the battlefield. That creature gains haste.
     *  Sacrifice it at the beginning of the next end step.", Sneak Attack /
     *  Cauldron Dance's hand-side clause). The picked-card idiom this shape
     *  serves is always a `count: { min: 0, max: 1 }` choice, so exactly one
     *  entry (or none) actually enters; when a future card's `choice` allows
     *  more than one pick, `bind` snapshots the LAST permanent that entered
     *  (each loop iteration overwrites the same binding name) — a caveat
     *  documented here rather than validator-enforced, since the linked
     *  `choice` Op's `count` lives in a separate Op the validator does not
     *  cross-reference. */
    | {
          op: "moveZone";
          cards: EffectRef;
          player: EffectPlayerRef;
          from: "library" | "hand" | "graveyard";
          to: EffectMoveZone | "library-top";
          tapped?: boolean;
          bind?: string;
          /** CR 400.7 / 607 (issue #1947) — stamp `linkExileToSource` on
           *  every moved card, valid ONLY alongside `to: "exile"`
           *  (validator-enforced). "Search your library for any number of
           *  artifact and/or creature cards, exile them" (Skyship
           *  Weatherlight) needs every exiled card linked back to the
           *  exiling permanent so a LATER ability can name exactly this pile
           *  (`getCardsExiledWith` / `pickRandomCardExiledWith`) — the same
           *  CR 607 link `hideaway` already stamps for its own single
           *  exiled card, generalized here to an arbitrary-count tutor
           *  sweep (a "generalize, don't add" parametrization of this
           *  EXISTING shape rather than a new Op). */
          linkToSource?: boolean;
      }
    /** CR 400.7 (issue #1279) — the THIRD `moveZone` shape: a bulk WHOLE-ZONE
     *  move. Every card currently in `from` moves to `to` — no announced
     *  `target`, no `choice`-picked `cards`, no per-card selection at all
     *  ("shuffles their hand and graveyard into their library", Timetwister /
     *  Echo of Eons; "shuffles the cards from their hand into their library",
     *  Winds of Change). A thin declarative skin over the SpellContext
     *  primitive `ctx.moveZone(playerId, from, to)`, which ALREADY takes no
     *  card selector (it always moves the entire zone) — this shape is the
     *  direct Op wrapper that primitive was always missing (ADR 0045
     *  "generalize, don't add": the primitive already existed, only the DSL
     *  skin was absent). Discriminated from the other two shapes by carrying
     *  neither `target` nor `cards`; `player`/`from` are both required
     *  (mirroring the `cards`-shape's own `player`/`from` fields, since a
     *  whole-zone move is equally a `player`-scoped, `from`-sourced
     *  operation). Restricted to the four PLAIN zones (`MovableZone` —
     *  library/hand/graveyard/exile) on BOTH `from` and `to`: unlike the
     *  `cards`-shape, there is no `to: "battlefield"` reanimation branch (a
     *  bulk graveyard→battlefield sweep is the existing `forEach { set:
     *  "graveyard" }` + `simultaneous` idiom, not this shape) and no `to:
     *  "library-top"` (that destination's ordering guarantee is meaningless
     *  without a specific pick list to place in order). No `bind` — there is
     *  no single object to snapshot when moving an entire zone; no `tapped`/
     *  `controller` for the same reason (both are meaningful only for a
     *  card entering the battlefield, which this shape never does). Skipped
     *  when `player` cannot be resolved (CR 608.2b); a `from === to` no-op is
     *  handled by the underlying primitive itself. */
    | {
          op: "moveZone";
          player: EffectPlayerRef;
          from: MovableZone;
          to: MovableZone;
      }
    /** CR 400.7 (issue #1104) — the FOURTH `moveZone` shape: a FILTER-DRIVEN
     *  bulk sweep across one or more zones, no player choice at all. Every
     *  card in `player`'s listed `fromZones` matching `filter` moves to `to`
     *  — "Search that player's graveyard, hand, and library for all cards
     *  with the same name as the chosen card and exile them" (Lobotomy). The
     *  "generalize, don't add" continuation of the `cards`-shape's
     *  single-zone SEARCH sweep (issue #677) in two directions at once: (a) a
     *  `filter` decides membership instead of a prior `choice`'s picks — the
     *  filter's own `name` field (issue #1104's `resolveNameRef`) is what
     *  makes "the SAME NAME as the card chosen by an earlier Op" expressible
     *  at all; (b) MULTIPLE zones are swept in ONE pass instead of one Op per
     *  zone. Each listed zone is read via the SAME zone-scoped card readers
     *  (`getHandCards` / `getLibraryCards` / `getGraveyardCards`) the
     *  `choice` Op's candidate precompute already uses, filtered through the
     *  SAME `matchesCardFilter` matcher every other filter site shares, and
     *  each match moves via the SAME `moveCardById` primitive the `cards`
     *  shape's non-battlefield branch already calls — no new SpellContext
     *  primitive. Discriminated from the `cards` shape by carrying
     *  `fromZones` (plural, no prior `choice` binding required) instead of
     *  `cards`, and from the whole-zone shape by carrying `filter` (an
     *  UNFILTERED bulk zone move already has its own shape above).
     *  Restricted to the four PLAIN zones on `to` (no `to: "battlefield"`
     *  reanimation branch — a filtered bulk graveyard→battlefield sweep is
     *  the existing `forEach { set: "graveyard" }` idiom, not this shape; no
     *  `to: "library-top"` — meaningless with no ordered pick list). Skipped
     *  when `player` cannot be resolved (CR 608.2b); a zone with zero
     *  matches simply contributes nothing (no error). */
    | {
          op: "moveZone";
          player: EffectPlayerRef;
          fromZones: MovableZone[];
          filter: EffectCardFilter;
          to: MovableZone;
      }
    /** CR 404.3 / 400.7 (issue #1967) — the FIFTH `moveZone` shape: a
     *  DETERMINISTIC POSITIONAL pick out of the ordered graveyard, no player
     *  choice. "Return the top creature card of your graveyard to the
     *  battlefield" (Shallow Grave, `mir/black.ts`; Corpse Dance,
     *  `tmp/black.ts`) — the topmost card MATCHING `target.filter` (a
     *  filtered scan from the top of the pile, per the oracle wording), moved
     *  to `to`.
     *
     *  Discriminated from the other four shapes by carrying a `target` whose
     *  value is an `EffectZonePositionSelector` (`{ zone, position, … }`)
     *  rather than an announced slot / bare ref — see that type for the
     *  ordering guarantee, the `filter` semantics and the `player` default.
     *  Once the card is located, execution funnels into the EXACT same
     *  graveyard-card branch the announced-target shape uses
     *  (`returnToBattlefield` for `to: "battlefield"`, `moveCardById`
     *  otherwise) — no new SpellContext primitive, and `bind` / `controller`
     *  / `tapped` keep their existing meanings there. An empty graveyard or a
     *  filter that matches nothing is a clean no-op (CR 608.2b). `position`
     *  (the numeric 1-based library insert, issue #1726) is NOT valid on this
     *  shape — a positional graveyard pick never targets a library slot. */
    | {
          op: "moveZone";
          target: EffectZonePositionSelector;
          to: EffectMoveZone;
          bind?: string;
          controller?: EffectPlayerRef;
          tapped?: boolean;
      }
    /** CR 607 (issue #1319 foundation, generalized #1323) — the SIXTH
     *  `moveZone` shape: put "a[n] [X] card exiled with this permanent" onto
     *  the battlefield (or another zone) — Emperor of Bones' "put a creature
     *  card exiled with this creature onto the battlefield under your
     *  control with a finality counter on it." Mirrors the FIFTH
     *  (positional-graveyard) shape's own precedent exactly: `target` is the
     *  existing `EffectExiledWithSourceSelector` (`{ exiledWithSource: true
     *  }`, issue #783 — previously wired ONLY into `castDuringResolution`'s
     *  `card` field, generalized here into `moveZone`'s own object-selecting
     *  grammar), read at resolution from
     *  `SpellContext.getCardsExiledWith(ctx.sourceInstanceId)` — every card
     *  in ANY player's exile currently linked to the resolving ability's OWN
     *  source (CR 400.7 — the pile may span owners; a card exiled from an
     *  opponent's graveyard stays in THEIR exile).
     *
     *  Optional sibling `filter` (the SAME `EffectCardFilter` field the
     *  FOURTH shape's `fromZones` sweep already carries — reused, not
     *  duplicated) narrows by type ("a CREATURE card exiled with ~").
     *  DELIBERATELY NOT a player choice when multiple cards qualify: the
     *  topmost-of-an-ordered-pile precedent the FIFTH shape set (Shallow
     *  Grave, "deliberately NOT a player choice: substituting one would
     *  diverge from the modern oracle text") extends here the same way —
     *  the first filter-matching entry in `getCardsExiledWith`'s stable
     *  return order (players in seat order, then each player's exile in
     *  insertion/link order) is used. An exile zone carries no CR-defined
     *  order the way a graveyard does (CR 404.3), so this is a documented
     *  simplification of the general CR 601.2c/608.2 "the appropriate
     *  player chooses" default for an unresolved multi-candidate tie,
     *  scoped to the shape this ticket introduces (issue #1323) — the
     *  common case is 0 or 1 linked card at resolution time.
     *
     *  Once located, execution funnels into the EXACT SAME graveyard-card
     *  branch every other `target`-carrying shape uses (`returnToBattlefield`
     *  for `to: "battlefield"`, re-deriving the source pile as exile via the
     *  branch's existing owner-lookup fallback — no new SpellContext
     *  primitive); `bind` / `controller` / `tapped` keep their existing
     *  meanings there. `controller` is the field Emperor actually needs
     *  ("under YOUR control" — the linked card may be owned by either
     *  player). An empty or filter-matching-nothing linked pile is a clean
     *  CR 608.2b no-op. `from` / `position` are validator-rejected on this
     *  shape (the source zone is intrinsic — always exile — and a positional
     *  library insert is meaningless with no announced slot). */
    | {
          op: "moveZone";
          target: EffectExiledWithSourceSelector;
          filter?: EffectCardFilter;
          to: EffectMoveZone;
          bind?: string;
          controller?: EffectPlayerRef;
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
     *  requested state (CR 701.26a/b).
     *
     *  `bind` (issue #1416) snapshots the tapped/untapped permanent's
     *  power/toughness/controller as last-known information (CR 608.2h) via
     *  the same `bindSnapshot` path `destroy`/`exile`/`moveZone` use, WITHOUT
     *  a zone change — Backlash ("Tap target untapped creature. That creature
     *  deals damage equal to its power to its controller.") reads `$bound.power`
     *  for a trailing `dealDamage` to `{ ref: "$bound.controller" }`. The
     *  snapshot is a normal `"snapshot"` binding (bindingKindOf's default), so
     *  `$bound.power`/`.toughness`/`.controller` refs validate. */
    | {
          op: "tapUntap";
          action: "tap" | "untap";
          target: EffectObjectSelector;
          bind?: string;
      }
    /** CR 302.6 / 502.1 (PRD #795) — a permanent "doesn't untap during its
     *  controller's next untap step" (Barl's Cage, Elvish Hunter, the Homarid
     *  dive cycle, Goblin Rock Sled). A thin declarative skin over the
     *  SpellContext primitive `skipNextUntap`, one execution path (ADR 0045):
     *  it stamps a one-shot `skipNextUntap` flag consumed by (and cleared
     *  after) exactly one untap step. No amount / duration — the one-shot
     *  scope is intrinsic. `target` names the permanent: an announced target
     *  slot, the resolving source (`$source` — a permanent locking itself), or
     *  the current member of a `forEach` set (`{ ref: "$each" }`). Skipped when
     *  the permanent is gone (CR 608.2b). Distinct from the still-planned
     *  `lockUntapWhileSourceTapped` (a continuous source-linked lock), not this
     *  one-shot flag. */
    | {
          op: "skipNextUntap";
          target: EffectObjectSelector;
      }
    /** CR 611.2a / 613.1f (layer 6, issue #843) — grant an ability to a
     *  permanent for a limited duration. A thin declarative skin over the
     *  SpellContext primitives `grantStaticAbility` / `grantActivatedAbility` /
     *  `grantTriggeredAbility`, one execution path (ADR 0045). Exactly one of
     *  three payloads:
     *  - `ability` — a keyword static ability ("flying", "trample", "haste",
     *    "banding", …; a free-form keyword read at combat / rules-check time,
     *    Berserk's "target creature gains trample").
     *  - `grantedActivatedId` — the `id` of an activated-ability template on the
     *    RESOLVING source's `grantTemplates[]` (issue #738, Touch of Vitae's
     *    "gains '{0}: Untap this creature. Activate only once.'"). The template
     *    carries its own cost / effects / `oncePerTurn` cap.
     *  - `grantedTriggeredId` — the `id` of a triggered-ability template on the
     *    RESOLVING source's `triggeredGrantTemplates[]` (issue #1665, Guardian
     *    Scalelord's Backup 1 granting the attack trigger printed below it, CR
     *    702.165c). `effectiveTriggeredAbilities` unions the template into the
     *    recipient's triggers, so the trigger collector scans and resolves it as
     *    if printed on the recipient (its `matches(event, self)` and any
     *    `$source`-relative effect therefore read the RECIPIENT, not the
     *    granting card).
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
          /** CR 611.2 — the phase boundary at which the grant expires. OMITTED
           *  is INDEFINITE (CR 611.2b, issue #1746): the ability persists for
           *  as long as the permanent stays on the battlefield — "it becomes a
           *  … Avatar with … flying and first strike" (Figure of Destiny), the
           *  Cocoon-style permanent gain; for `grantedTriggeredId` it routes to
           *  `grantTriggeredAbilityPermanent` (Balduvian Shaman's "gains
           *  'Cumulative upkeep {1}'"); for `grantedActivatedId` it routes to
           *  `grantActivatedAbilityPermanent` (CR 611.2c, issue #1880 — Urza's
           *  Saga chapters I / II, whose grant is generated by a RESOLVING
           *  chapter ability and so never expires on its own). Routes to
           *  `SpellContext.grantStaticAbilityPermanent` for a keyword. */
          duration?: DurationSpec;
          ability?: string;
          grantedActivatedId?: string;
          grantedTriggeredId?: string;
      }
    /** CR 613.1d (layer 4, issue #1194) — adds `subtype` to a target permanent
     *  INDEFINITELY, in addition to its other types (Guide of Souls: "It
     *  becomes an Angel in addition to its other types"). A thin declarative
     *  skin over the single SpellContext primitive `addSubtype`, one
     *  execution path (ADR 0045). Distinct from the aura-style
     *  `StaticEffect.kind === "subtype-add"` (a CONTINUOUS static effect tied
     *  to a live source): this Op's effect is generated by a RESOLVING
     *  ability (CR 611.2c) and does NOT depend on its source remaining on the
     *  battlefield — the target keeps the subtype after the granting
     *  permanent leaves play. `target` is an announced target slot, the
     *  resolving source (`$source`), or the current member of a `forEach` set
     *  (`{ ref: "$each" }`). No `duration` — always indefinite (mirrors
     *  `setSupertype`'s CR 205.4a pattern). Skipped when the referenced
     *  permanent is gone (CR 608.2b). */
    | {
          op: "addSubtype";
          target: EffectObjectSelector;
          subtype: string;
          /** CR 303.4 — the enchant restriction the target gains TOGETHER with
           *  the subtype ("it becomes an Aura with enchant creature"). Only
           *  valid when `subtype` is `"Aura"` — the validator rejects it
           *  otherwise (`OP_SCHEMAS.addSubtype.check`). It is stamped on the
           *  instance as `CardInstanceState.grantedEnchantRestriction` and
           *  read by `resolveEnchantRestriction`, the single predicate behind
           *  the CR 303.4c / 704.5m attachment SBA and the CR 303.4f host
           *  scan, alongside any printed clause (CR 702.5c — all instances of
           *  enchant apply). Without it a permanent flipped to an Aura
           *  has NO restriction the SBA can read and is binned the instant it
           *  attaches. `host` is an object selector resolved AT GRANT TIME to
           *  the instance id it names (the CR 303.4 "specific object" form —
           *  the reanimated creature bound earlier in the same script), so the
           *  stored restriction is plain JSON, not a live ref. */
          enchantRestriction?: {
              types?: CardType[];
              players?: boolean;
              host?: EffectObjectSelector;
          };
      }
    /** CR 613.1e (layer 5, issue #1083) — sets a target's color(s), replacing
     *  all other color derivation. A thin declarative skin over the single
     *  SpellContext primitive `setColorOverride`, one execution path (ADR
     *  0045). `target` is an announced target slot (a permanent OR a spell —
     *  "target spell or permanent becomes the color of your choice", Blind
     *  Seer), the resolving source (`$source` — a self-color-change activated
     *  ability, Rainbow Crow / Tidal Visionary / Metathran Transport), or the
     *  current member of a `forEach` set (`{ ref: "$each" }` — Sway of
     *  Illusion's "any number of target creatures", paired with the new
     *  `forEach { set: "targets" }` selector). `colors` is the new color set
     *  (CR 105.1 — the five colors; an empty array is legal, "becomes
     *  colorless"). `duration` (issue #1065) is meaningful for a PERMANENT
     *  target only — a temporary override that reverts to whatever
     *  colorOverride the target carried before, at the given phase boundary
     *  ("… until end of turn", every card in this batch); omitted is
     *  indefinite (ignored for a spell target, which resolves/leaves the
     *  stack well before any phase boundary). Skipped when the referenced
     *  object is gone (CR 608.2b — `resolveObjectRef` returns undefined). A
     *  "choose one of five colors, then set it" modal effect composes with
     *  the pre-existing `optionChoice` Op — one mode per color, each a
     *  single-Op `setColor` body — no new choice-kind construct needed (ADR
     *  0045 "generalize, don't add"). */
    | {
          op: "setColor";
          target: EffectObjectSelector;
          colors: Color[];
          duration?: DurationSpec;
      }
    /** CR 305.7 (layer 4, issue #1083) — replaces a target land's subtypes for
     *  a limited duration. A thin declarative skin over the single
     *  SpellContext primitive `setSubtypesUntil`, one execution path (ADR
     *  0045). Distinct from `addSubtype` (which ADDS a subtype INDEFINITELY,
     *  keeping the printed ones): this Op REPLACES the target's subtypes
     *  outright, and always reverts at `duration` — the "target land becomes
     *  a Swamp / the basic land type of your choice until end of turn /
     *  until its controller's next untap step" template (Orcish Farmer /
     *  Slimy Kavu precedent closures, Dream Thrush). `target` is an announced
     *  target slot, the resolving source (`$source`), or a forEach `$each`;
     *  `subtypes` is the full replacement subtype list (usually one basic
     *  land type, `["Swamp"]`); `duration` is REQUIRED (mirrors the
     *  primitive's own signature — this Op has no indefinite form, unlike
     *  `addSubtype`; a permanent land-type change is the `entersWith`/
     *  static-effect protocol, not this Op). A "choose the basic land type,
     *  then set it" effect composes with the pre-existing `optionChoice` Op
     *  exactly like `setColor` above — one mode per basic land type, each a
     *  single-Op `setSubtype` body. Skipped when the referenced permanent is
     *  gone (CR 608.2b) or a non-permanent target (the primitive itself
     *  no-ops). */
    | {
          op: "setSubtype";
          target: EffectObjectSelector;
          subtypes: string[];
          /** CR 611.2 — when the replacement reverts. OMITTED is INDEFINITE
           *  (CR 611.2b, issue #1746): the permanent simply IS the new subtype
           *  line until it leaves the battlefield — "this creature becomes a
           *  Kithkin Spirit" (Figure of Destiny), where each stage REPLACES the
           *  previous creature types (CR 205.1b) rather than accumulating them
           *  (which is what `addSubtype` would do). Routes to
           *  `SpellContext.setSubtypes`. */
          duration?: DurationSpec;
      }
    /** CR 208.2 / 611.1 (issue #1317) — turns a permanent into a creature with
     *  the given base P/T, optionally adding a subtype / extra card types /
     *  permanently-granted keyword abilities, for `duration` (a temporary
     *  Mishra's-Factory-style animation) or INDEFINITELY when `duration` is
     *  omitted (CR 611.2b — Earthbend N's "Target land you control becomes a
     *  0/0 creature with haste that's still a land"). A thin declarative skin
     *  over the SpellContext primitive `animateAsCreature`, one execution path
     *  (ADR 0045). `target` is an announced target slot, the resolving source
     *  (`$source`), or the current member of a `forEach` set (`{ ref:
     *  "$each" }`). `power`/`toughness` are the animation's BASE stats (layer
     *  7a) — a later +1/+1 counter (the `counters` Op) or static buff still
     *  applies on top at read time (CR 613.4). Skipped when the target is gone
     *  (CR 608.2b) or already animated by a DIFFERENT still-active `animate`
     *  effect (the primitive's "one animation at a time" guard — `subtype` /
     *  `additionalTypes` for the SECOND application no-op, but
     *  `grantedAbilities` still apply, matching Earthbend N re-applied to an
     *  already-earthbent land). */
    | {
          op: "animate";
          target: EffectObjectSelector;
          power: number;
          toughness: number;
          subtype?: string;
          additionalTypes?: CardType[];
          grantedAbilities?: string[];
          duration?: DurationSpec;
      }
    /** CR 613.4b layer 7b (issue #1318) — SET a permanent's base power and/or
     *  toughness to a fixed characteristic value, locked at resolution
     *  (CR 611.2), for `duration`. A thin declarative skin over the SpellContext
     *  primitive `setBasePT`, one execution path (ADR 0045). Distinct from
     *  `pump` (a layer-7c relative +N/+N modifier) and from `animate` (layer-7a
     *  base P/T set that ALSO turns the permanent into a creature) — this is the
     *  standalone "has base power and toughness N/N" / "has base power 0" set on
     *  a permanent that is ALREADY a creature (Sorceress Queen 0/2, Island of
     *  Wak-Wak power-0, Singing Tree power-0, the 5/5 set). `power` / `toughness`
     *  are each OPTIONAL non-negative-int characteristics (CR 107.4b — 0 is
     *  legal); omitting one leaves that stat untouched (Island of Wak-Wak sets
     *  only power) — at least one is required. `target` is an announced target
     *  slot, `$source`, or a `forEach` `$each` member. Skipped when the
     *  referenced permanent is gone (CR 608.2b — the effect does as much as it
     *  can). */
    | {
          op: "setBasePT";
          target: EffectObjectSelector;
          power?: number;
          toughness?: number;
          /** CR 611.2 — when the set reverts. OMITTED is INDEFINITE (CR
           *  611.2b, issue #1746): the base P/T holds until the permanent
           *  leaves the battlefield or a later set overrides it — "becomes a
           *  Kithkin Spirit with base power and toughness 2/2" (Figure of
           *  Destiny), Wall of Tombstones' "indefinitely". The primitive
           *  already accepted an `"indefinite"` sentinel; this exposes it. */
          duration?: DurationSpec;
      }
    /** CR 205.1a layer 4 (issue #2361) — SETS a permanent's card types,
     *  REPLACING every type it currently has, INDEFINITELY (CR 611.2c — the
     *  effect is generated by a resolving ability and never reverts). A thin
     *  declarative skin over the SpellContext primitive `setCardTypes`, one
     *  execution path (ADR 0045). Oko, Thief of Crowns' "+1: Target artifact
     *  or creature ... becomes a green Elk creature": an artifact target stops
     *  being an artifact.
     *
     *  Distinct from `animate` (which ADDS the Creature type and its
     *  `additionalTypes` on top of the printed line, the "that's still a land"
     *  template of CR 205.1b, and sets base P/T in the same breath) and from
     *  `addSubtype` / `setSubtype` (layer-4 SUBtypes, CR 205.3). This Op
     *  touches CARD TYPES only: supertypes are untouched (CR 205.1a — Oko's
     *  ruling keeps Legendary), and the CR 205.1a correlated-subtype clause is
     *  left to the paired subtype Op, since every "becomes a [subtype] [type]"
     *  Oracle line sets both halves (Oko pairs this with `setSubtype`).
     *
     *  `target` is an announced target slot, the resolving source
     *  (`$source`), or a `forEach` `$each` member. `types` is the full
     *  replacement type list and must be non-empty (CR 205.1 — every object
     *  has at least one card type). Skipped when the referenced permanent is
     *  gone (CR 608.2b). No `duration`: the timed "becomes an artifact
     *  creature until end of turn" template is `animate`'s, which already
     *  carries a revert path. */
    | {
          op: "setCardTypes";
          target: EffectObjectSelector;
          types: CardType[];
      }
    /** CR 613.1f layer 6 (issue #2361) — a target permanent LOSES ALL
     *  ABILITIES, INDEFINITELY (CR 611.2c — generated by a resolving ability,
     *  so it does not depend on its source and never reverts). A thin
     *  declarative skin over the SpellContext primitive `loseAllAbilities`,
     *  one execution path (ADR 0045). Oko, Thief of Crowns' "+1: Target
     *  artifact or creature loses all abilities and becomes a green Elk
     *  creature with base power and toughness 3/3."
     *
     *  The one-shot sibling of the continuous `ability-loss` static effect
     *  (Titania's Song) — it writes the SAME `abilitiesSuppressedBy` /
     *  `removedKeywords` markers through the same shared applier, so keyword,
     *  activated, triggered and intrinsic mana abilities all stop functioning
     *  by the mechanism already in place, and takes a FRESH layer timestamp so
     *  a LATER grant survives it (CR 613.7).
     *
     *  `target` is an announced target slot, the resolving source
     *  (`$source`), or a `forEach` `$each` member. Skipped when the referenced
     *  permanent is gone (CR 608.2b). Deliberately has NO `duration`: an
     *  until-end-of-turn ability strip (Turn to Frog) needs a revert path this
     *  storage has no room for — the `abilitiesSuppressedBy` markers are
     *  source-keyed, not duration-keyed — and no card in scope wants one. */
    | { op: "loseAllAbilities"; target: EffectObjectSelector }
    /** CR 701.24 (issue #844) — shuffle a player's library. A thin declarative
     *  skin over the SpellContext primitive `shuffleLibrary`, one execution
     *  path (ADR 0045). `action` is `"shuffle"` — the seeded-PRNG randomization
     *  that also clears every library card's persistent knowledge (ADR 0026, an
     *  unwitnessed reorder). `player` names whose library: the resolving
     *  controller (`"controller"`), an announced target-slot player
     *  (`{ target: N }`), or the current member of a `forEach` set
     *  (`{ ref: "$each" }` — a per-player shuffle). SCOPE (issue #844): only
     *  the `shuffle` primitive is folded — it is the one CR 401 / 701.24 library
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
    /** CR 401.4 look / CR 701.22 Scry / 701.25 Surveil / order-only (issue
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
          /** CR 701.29 fateseal (issue #1532) — the player who MAKES the
           *  top/bottom decision, when it is NOT the library's owner. Jace, the
           *  Mind Sculptor's +2 "Look at the top card of TARGET player's
           *  library. You may put that card on the bottom …" is fateseal: the
           *  ability's CONTROLLER decides, looking at the target player's
           *  library. Set `player: { target: 0 }` (whose library) + `chooser:
           *  "controller"` (who decides). The order-top PendingChoice is raised
           *  for `chooser` with `zoneOwnerId` = the library owner (the same
           *  chooser≠zone-owner seam Fact or Fiction / Demonic Hordes use), so
           *  the peek is exposed to the chooser and the un-kept card bottoms in
           *  the owner's library. Omitted = the library owner chooses (ordinary
           *  Scry / Surveil / Ponder). */
          chooser?: EffectPlayerRef;
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
     *  Deterministic — no player choice, unlike `scryReorder`.
     *
     *  Optional `bind` (issue #1095, Loafing Giant) snapshots the FIRST card
     *  that genuinely reached the graveyard (mirrors `discardAtRandom`'s
     *  `bind` shape) so a later `if`/`boundMatchesFilter` can test what came
     *  up — "if a land card was milled this way". A card a CR 614
     *  graveyard-bound replacement redirected to exile was NOT milled
     *  (CR 701.17a is "put into a graveyard from a library"), so it is never
     *  the bound card; nothing binds when every card was redirected or the
     *  library was already empty (CR 608.2b). */
    | {
          op: "mill";
          player: EffectPlayerRef;
          count: EffectValue;
          bind?: string;
      }
    /** CR 701.20a reveal + CR 400.7 zone change — reveal the top `count` card(s)
     *  of a library and send each one to a destination chosen by WHAT IT IS
     *  ("Reveal the top card of your library. If it's a land card, put it onto
     *  the battlefield. Otherwise, put it into your hand." — Nadu, Winged
     *  Wisdom). A thin declarative skin over primitives that already exist, one
     *  execution path (ADR 0045): `peekLibraryTop` names the window,
     *  `markKnownToAll` + `notifyReveal` make it public (the same pair
     *  `lookDistribute`'s reveal leg uses), and each card is routed with
     *  `putFromLibraryOntoBattlefield` (battlefield) or
     *  `moveCardById(player, id, "library", …)` (every other zone) — the exact
     *  two primitives `moveZone`'s `cards` shape already dispatches between.
     *  No new SpellContext primitive.
     *
     *  DETERMINISTIC — no player choice, so unlike `lookDistribute` / `scryReorder` /
     *  `revealAndCategorize` it never suspends. That is precisely the gap it
     *  fills: those three all end in a player PICKING from a revealed window,
     *  whereas this Op's destination is dictated by the card's own
     *  characteristics, with nothing to decide.
     *
     *  `routes` is an ORDERED list of `{ filter, to }` rules evaluated per
     *  revealed card, FIRST MATCH WINS (so a card matching two rules is routed
     *  by the earlier one — write the more specific rule first); a card
     *  matching no rule goes to `fallback`, which is the Oracle text's
     *  "Otherwise, …" clause and is therefore required. `filter` is the same
     *  `EffectCardFilter` the hidden-zone `choice`/`count` constructs use,
     *  matched through the shared `matchesCardFilter`.
     *
     *  Every miss is a CR 608.2b no-op: an empty library reveals nothing (and
     *  fires no reveal dialog), and a revealed id that is somehow no longer in
     *  the library when it is routed is skipped. `count` defaults to 1 and a
     *  non-positive `count` is a no-op. */
    | {
          op: "revealTopAndRoute";
          player: EffectPlayerRef;
          count?: EffectValue;
          routes: {
              filter: EffectCardFilter;
              to: RevealRouteDestination;
          }[];
          fallback: RevealRouteDestination;
      }
    /** CR 401.4 (issue #984, extended #1101, renamed + `keepTo` #2070) — look
     *  at the top `look` cards of a library, put `take` of them (default 1)
     *  to `keepTo` (hand, or the library top — Thassa's Oracle), and put the
     *  rest on `destination` (the library BOTTOM by default, or the
     *  GRAVEYARD — Reviving Vapors, issue #1101). A thin declarative skin
     *  composed of existing SpellContext primitives, one execution path
     *  (ADR 0045); SUSPENDS on a single `look-distribute` `requestChoice`,
     *  same shape as `choice` / `scryReorder`. `player` names whose library;
     *  `look` is how many top cards to look at; `take` is how many to keep
     *  (default 1, clamped to the number looked at). See the individual
     *  field docs below (`keepTo`, `filter`, `optional`, `destination`,
     *  `randomBottom`, `bind`, `reveal`) for the full grammar — kept there,
     *  not duplicated here, so there is exactly one place each field's
     *  contract is written down. */
    | {
          op: "lookDistribute";
          player: EffectPlayerRef;
          look: EffectValue;
          take?: EffectValue;
          /** Where the KEPT looked-at cards go (issue #2070) — REQUIRED, no
           *  default: the Op used to hard-code "to hand," and a silent
           *  default would resurrect that hidden assumption for every
           *  existing card the moment a second destination existed.
           *  `"hand"` is every card shipped before issue #2070 (Impulse,
           *  Stock Up, Narset, Reviving Vapors). `"library-top"` (Thassa's
           *  Oracle: "put up to one of them on top of your library") routes
           *  the kept card(s) through `putLibraryCardsOnTop` instead of
           *  `moveCardById`'s library→hand leg — `picks[0]` ends up the very
           *  top when more than one is kept. Orthogonal to `destination`
           *  (the UN-kept cards' target) — the two never interact. */
          keepTo: "hand" | "library-top";
          /** Restricts which of the looked-at cards may be KEPT (put to
           *  `keepTo`) — the bottomed/graveyarded remainder is unfiltered
           *  (Narset, Parter of Veils: "you MAY reveal a NONCREATURE,
           *  NONLAND card ... put the rest on the bottom",
           *  `excludeType: ["Creature","Land"]`). When present, the choice's
           *  keep-eligible set is the looked-at cards matching this filter;
           *  a non-matching looked-at card is never a legal keep and always
           *  goes to `destination` (issue #1266). */
          filter?: EffectCardFilter;
          /** "You MAY" — the hand pick is optional (min 0, up to `take`), so a
           *  player who wants nothing (or has no filter match) keeps their hand
           *  as-is. Default false = EXACTLY `take` to hand (Impulse / Stock Up,
           *  the mandatory dig). */
          optional?: boolean;
          /** Where the NON-kept looked-at cards go (issue #1101, mirrors
           *  `scryReorder`'s discriminator of the same name). `"library-bottom"`
           *  (the default, Impulse / Stock Up / Narset) sends them to the true
           *  bottom, in the player's chosen order (or look order — see
           *  `randomBottom`). `"graveyard"` (Reviving Vapors) sends them
           *  straight to the graveyard instead, one `moveCardById` per card
           *  (CR 614 graveyard-bound-redirect-eligible, same as `scryReorder`'s
           *  Surveil leg); `randomBottom` and the bottom-order pick are then
           *  moot (a graveyard has no meaningful order) and no `markKnown` is
           *  granted (the graveyard is already a public zone, ADR 0026).
           *  Omit for the library-bottom default. */
          destination?: LibraryDestination;
          /** "Put the rest on the bottom ... in a RANDOM order" (Narset). The
           *  un-kept looked-at cards are bottomed WITHOUT a player-ordering pick
           *  and WITHOUT being marked known — CR 401.4's random order is
           *  unobservable for face-down library cards, so the physical
           *  permutation carries no game information; the material part (no
           *  player choice of order, no knowledge granted) is what this honors.
           *  Default false = the player orders the bottom and keeps it known
           *  (ADR 0026, the Impulse "in any order" path). Meaningless for
           *  `destination: "graveyard"` (a public zone has nothing to hide). */
          randomBottom?: boolean;
          /** Optional prompt message shown on the look-distribute choice (e.g.
           *  Narset, Parter of Veils: "you may put a noncreature, nonland card
           *  into your hand"). Falls back to a generic prompt when absent. */
          prompt?: string;
          /** Snapshot-binds the FIRST card put into hand (issue #1101,
           *  mirrors `destroy`/`exile`'s object `bind` — a SNAPSHOT-family
           *  binding, not a `choice` Op's picks list). Undefined/unbound when
           *  nothing was kept (`optional: true` and the player declined, or
           *  `take`/the filter left nothing eligible — CR 608.2b, the same
           *  "binding never captured" shape every other bind carries). Read
           *  back by a later Op through the ordinary `EffectObjectSelector`
           *  bare-ref path (`{ ref: "$name" }`) — e.g. `manaValue: { of: {
           *  ref: "$name" } }` sizing a `gainLife` Op (Reviving Vapors: "You
           *  gain life equal to that card's mana value"). The bound object
           *  resolves as a HAND card (`TargetSelection.type: "hand-card"`),
           *  since the kept card lives in hand by the time this binds — it
           *  never becomes a permanent, unlike `destroy`/`exile`'s targets.
           *  When `take` keeps more than one card, only the FIRST is bound
           *  (mirrors the existing "last one wins" multi-pick bind caveat on
           *  other Ops — no shipped multi-keep lookDistribute card reads its
           *  bind today). SCOPE (issue #2070): only exercised with
           *  `keepTo: "hand"` — no shipped `keepTo: "library-top"` card binds
           *  yet, so the executor's bind snapshot assumes the hand shape;
           *  a future library-top card that needs `bind` earns its own
           *  `"library-card"`-shaped snapshot then. */
          bind?: string;
          /** Makes the look a PUBLIC reveal (CR 701.20a) rather than the
           *  default PRIVATE look (CR 401.4). Two scopes, matching the two
           *  Oracle shapes:
           *    - `"window"` — "REVEAL the top N cards ..." (Reviving Vapors,
           *      Courser-style ETB, Torsten): the WHOLE looked-at window is
           *      revealed to every player BEFORE the keep/order choice, so the
           *      opponent sees all N. Marked known-to-all + a reveal dialog.
           *    - `"kept"` — "Look at the top N (privately) ... you may REVEAL a
           *      card ... and put it into your hand" (War-blue / Narset shape):
           *      the look stays private; only the card(s) actually put into
           *      hand are revealed to everyone, AFTER the pick.
           *  Omit for a purely private look/dig (Impulse, Domain, Brainstorm-
           *  style card selection), where nothing is shown to the opponent. */
          reveal?: "window" | "kept";
      }
    /** CR 702.75a (issue #783) — the HIDEAWAY keyword's effect: look at the top
     *  `look` cards of `player`'s library, exile ONE of them FACE DOWN, and put
     *  the rest on the bottom of that library in a random order. The exiled card
     *  is stamped with the CR 607 link back to the resolving ability's source
     *  permanent, which is what a later "you may play the exiled card" ability
     *  reads (`grantCastFromExile`'s `{ exiledWithSource: true }` selector).
     *
     *  A thin declarative composition over primitives that already exist — no
     *  new SpellContext primitive (ADR 0045 "generalize, don't add"):
     *  `peekLibraryTop(look)` names the window, ONE suspending `look-distribute`
     *  `requestChoice` (exactly `lookDistribute`'s picker, so the client mounts the
     *  same simple grid — `randomizeRest` means there is no bottom-ordering
     *  drag) drives the exile pick, `exileFaceDown` moves the pick to its
     *  owner's exile granting `knownTo` to the controller ALONE (CR 406.3 — the
     *  identity stays hidden from every other player, and the projection
     *  re-derives the per-viewer gate purely from `knownTo`),
     *  `linkExileToSource` stamps the CR 607 link, and the un-picked window is
     *  bottomed through the SAME `bottomLookedAtCards` tail `lookDistribute` uses,
     *  with `randomBottom` (CR 401.4's random order is unobservable for
     *  face-down library cards, so no ordering pick and no knowledge grant).
     *
     *  Structurally `lookDistribute` with the kept card routed to FACE-DOWN,
     *  SOURCE-LINKED EXILE instead of to hand — precisely what `lookDistribute`
     *  cannot express (its kept cards always go to `player`'s hand, known to
     *  that player, with no exile link). SUSPENDS like `choice` / `scryReorder`
     *  / `lookDistribute`. Every miss is a CR 608.2b no-op: a gone player, a
     *  non-positive `look`, or an empty library skips the Op and never suspends.
     *
     *  `look` is the keyword's N (`hideaway 4` → 4). Exactly ONE card is exiled
     *  (CR 702.75a), so there is no `take` parameter. */
    | {
          op: "hideaway";
          player: EffectPlayerRef;
          look: EffectValue;
          /** Optional prompt override for the look-distribute picker. */
          prompt?: string;
      }
    /** CR 701.20a reveal + CR 401.4 (issue #1364) — reveal a fixed top-N
     *  window ONCE, then keep AT MOST ONE card per category from that single
     *  shared window, and send everything unkept to `destination`.
     *
     *  Atraxa, Grand Unifier: "reveal the top ten cards of your library. For
     *  each card type, you may put a card of that type from among the revealed
     *  cards into your hand. Put the rest on the bottom of your library in a
     *  random order."
     *
     *  The CATEGORIZED half is what `lookDistribute` cannot express: `lookDistribute`
     *  has ONE `filter` and ONE `take`, and calling it several times in
     *  sequence does not share a window (each call re-peeks the CURRENT
     *  library top, which has already moved). Here the window is peeked once
     *  and every category picks out of that same revealed set, each card
     *  claimable by AT MOST ONE category (Gatherer: a card with several card
     *  types may be chosen for only one of them) — so the legal keep-sets are
     *  exactly those admitting an injective card → category assignment, a
     *  bipartite matching computed by the shared leaf module
     *  `gre/categorizedPick.ts` (the same code gates the client's clicks and
     *  validates the submit, so the two can never disagree).
     *
     *  Everything else is deliberately `lookDistribute`'s vocabulary, same
     *  semantics, so the two Ops read as siblings: `reveal` (CR 701.20a public
     *  reveal vs. a private CR 401.4 look), `optional` ("you MAY"),
     *  `destination`, `randomBottom`, `prompt`. It SUSPENDS on a single
     *  `look-distribute` choice carrying the resolved categories. */
    | {
          op: "revealAndCategorize";
          player: EffectPlayerRef;
          /** How many top cards to reveal/look at (Atraxa: 10). */
          look: EffectValue;
          /** The categories, in display order. Each is a label (shown in the
           *  picker) plus the `EffectCardFilter` deciding which revealed cards
           *  belong to it. Atraxa lists the eight card types verbatim from its
           *  reminder text; Niv-Mizzet Reborn's ten exact-colour pairs are the
           *  other intended shape. A revealed card matching NO category can
           *  only be sent to `destination` — never kept. */
          categories: { label: string; filter: EffectCardFilter }[];
          /** "You MAY put …" — keeping fewer than the maximum (including
           *  nothing) is allowed. Default false = keep as many as the matching
           *  permits. Atraxa is `true`. */
          optional?: boolean;
          /** Where the unkept revealed cards go — `"library-bottom"` (default,
           *  Atraxa) or `"graveyard"`. Identical to `lookDistribute`'s field. */
          destination?: LibraryDestination;
          /** "…on the bottom of your library in a RANDOM order" (Atraxa) — no
           *  player ordering pick, no `markKnown` (CR 401.4's random order is
           *  unobservable for face-down library cards, so no knowledge is
           *  granted). Identical to `lookDistribute`'s field. */
          randomBottom?: boolean;
          /** CR 701.20a — `"window"` publicly reveals the whole looked-at
           *  window (Atraxa's "reveal the top ten cards"); `"kept"` reveals
           *  only the cards actually kept. Omit for a private look. */
          reveal?: "window" | "kept";
          /** Optional prompt header on the pick. */
          prompt?: string;
      }
    /** CR 601.2b / 701.9 (issue #1945) — per-category choice from an
     *  ALREADY-VISIBLE set: the chooser's own hand or own battlefield, unlike
     *  `revealAndCategorize`'s library-window look. Reuses the SAME
     *  bipartite-matching core (`gre/categorizedPick.ts`) and `categories`
     *  vocabulary, but is its OWN Op rather than a `revealAndCategorize`
     *  generalization — that Op's reveal/peek framing and fixed
     *  kept→hand/rest→bottom polarity do not apply here, and the two shipped
     *  cards need OPPOSITE actions on the picked/unpicked halves:
     *
     *  Noxious Vapors: "Each player reveals their hand, chooses one card of
     *  each color from it, then discards all other nonland cards." Zone =
     *  hand (paired with a preceding `reveal { zone: "hand" }` Op for the
     *  public reveal half — this Op itself does not reveal), categories = the
     *  five colours, `onPicked: "keep"` (the picks simply survive), `sweep`
     *  discards the REST — but narrowed to `excludeType: "Land"`, a BROADER
     *  filter than the categorization domain: a colourless nonland card
     *  matches no category (so it can never be picked) yet is still swept,
     *  while a land is never swept even if uncategorized.
     *
     *  Planar Overlay: "Each player chooses a land they control of each basic
     *  land type. Return those lands to their owners' hands." Zone =
     *  battlefield (already public, no reveal needed), categories = the five
     *  basic land types (`subtype` filters), `onPicked: "returnToHand"` (the
     *  picks bounce via `returnToHand`, CR 400.7), no `sweep` (the
     *  unpicked lands are untouched — Oracle text never mentions them).
     *
     *  Both Oracle texts read as MANDATORY ("chooses", not "may choose"): a
     *  category with zero matching members is simply not filled (no
     *  candidate to choose), and `optional` defaults to `false`.
     *
     *  Legality is `categorizedPick.ts`'s COVER rule, NOT
     *  `revealAndCategorize`'s injective one — the module's second rule, and
     *  the reason this Op is not a generalization of that one. Each category
     *  NOMINATES a member and one member may answer SEVERAL categories at
     *  once (Gatherer, Planar Overlay: "If you have a land which counts as
     *  multiple land types, you can choose that land as each of those types.
     *  For example, a dual land could be chosen as two of your land types."
     *  Noxious Vapors' gold card is the same shape). So the offered `count`
     *  runs from the SMALLEST covering set (`minCategorizedCover`) to the
     *  maximum matching (`maxCategorizedPicks`) — a Plains+Tundra player may
     *  answer with the Tundra alone, and pinning the floor to the matching
     *  would illegally force them to return two lands (CR 608.2b — never
     *  demand a pick the rules don't). An `optional: true` offer is instead a
     *  per-category "you may" and keeps the injective rule at min 0.
     *
     *  A wholly zero-branch pick (nothing matches any category) auto-resolves
     *  straight to the sweep with no prompt; a FORCED but nonzero pick (every
     *  category has at most one candidate, so each nomination is already
     *  determined — including a lone dual land answering both its types)
     *  also auto-resolves (`categorizedPick.ts`'s `forcedCategorizedCover`)
     *  rather than making the player click through a choice with only one
     *  possible answer (project convention: auto-resolve when there is no
     *  real option). `player` names whose hand/battlefield —
     *  `forEach { set: "players" }` wraps this Op so "each player" runs it
     *  once per side, in APNAP order, each acting on their OWN set only
     *  (CR 601.2b — no player chooses for another). No new SpellContext
     *  primitive: `getHandCards`/`getBattlefieldIds` resolve the categories,
     *  `discardCard` (CR 701.9) applies the sweep, `returnToHand` (CR 400.7)
     *  applies the bounce — the same primitives `discard`/`moveZone` already
     *  use (ADR 0045 "generalize, don't add"). */
    | {
          op: "chooseCategorized";
          player: EffectPlayerRef;
          /** The already-visible domain to choose from. */
          zone: "hand" | "battlefield";
          /** The categories, in display order — each a label plus the
           *  `EffectCardFilter` deciding which zone members belong to it. A
           *  member matching several categories may be picked for only ONE
           *  (bipartite matching, `gre/categorizedPick.ts`) — a multicoloured
           *  hand card, a dual land. */
          categories: { label: string; filter: EffectCardFilter }[];
          /** "You may…" — default false: mandatory, offering exactly the
           *  MAXIMUM legally matchable count (every category with a legally
           *  seatable member gets filled). */
          optional?: boolean;
          /** What happens to the members actually picked. `"keep"` leaves
           *  them exactly where they are — being picked just means surviving
           *  `sweep` below (Noxious Vapors). `"returnToHand"` moves each
           *  picked BATTLEFIELD permanent to its owner's hand via
           *  `returnToHand` (Planar Overlay's bounce) — only meaningful for
           *  `zone: "battlefield"`. */
          onPicked: "keep" | "returnToHand";
          /** The sweep clause (`zone: "hand"` only): every HAND card NOT
           *  picked, further narrowed by `filter` here — deliberately a
           *  SEPARATE, possibly BROADER filter than the categorization
           *  domain (Noxious Vapors' `excludeType: "Land"` sweeps every
           *  nonland card, including one that matched no colour category at
           *  all). Omit `filter` to sweep every non-picked zone member; omit
           *  `sweep` entirely for "leave everything else untouched" (Planar
           *  Overlay). `action: "discard"` is the only shape today (CR
           *  701.9) — grows when a future card needs a different rest
           *  action. */
          sweep?: { filter?: EffectCardFilter; action: "discard" };
          /** Optional prompt header on the pick. */
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
     *  controls the sequence). Like `choice` / `scryReorder` / `lookDistribute`
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
    /** `"all-from-source"` (CR 615, issue #1955) → `preventAllDamageFromSources`
     *  with an id-scoped shield: prevent ALL damage the named source would
     *  deal this turn, to ANY recipient (a player, a creature, a
     *  planeswalker). The SOURCE-side mirror of `"next-n"`, which is
     *  recipient-side. `source` names the shielded object — an announced
     *  target slot (Falling Timber / Guard Dogs' "target creature", Rith's
     *  Charm's chosen source), `$source`, or a `forEach` `$each`. `combatOnly`
     *  narrows it to COMBAT damage (CR 510 — Falling Timber, Guard Dogs,
     *  Radiant Kavu); omit it for the all-damage form (Rith's Charm's third
     *  mode: "Prevent all damage a source of your choice would deal this
     *  turn"). Skipped when the source is gone (CR 608.2b). */
    | {
          op: "preventDamage";
          mode: "all-from-source";
          source: EffectObjectSelector;
          combatOnly?: boolean;
      }
    /** `"all-from-matching"` (CR 615, issue #1955) → the same primitive with a
     *  FILTER-scoped shield and no target named at all: prevent all damage
     *  every source matching `match` would deal this turn (Radiant Kavu:
     *  "Prevent all combat damage blue creatures and black creatures would
     *  deal this turn"). The filter is re-evaluated at the moment damage would
     *  be dealt, so a creature that BECOMES blue after this resolves is
     *  covered too (CR 615.6). `match.colors` is an OR-set (CR 202.2 — blue OR
     *  black, not both); `match.cardType` additionally requires that type.
     *  `combatOnly` as above. */
    | {
          op: "preventDamage";
          mode: "all-from-matching";
          match: { colors?: Color[]; cardType?: CardType };
          combatOnly?: boolean;
      }
    /** `"next-n-divided"` (CR 615.1 / 601.2d / 120.4, issue #1955) → the
     *  DIVIDED sibling of `"next-n"`: install a prevent-the-next-N shield on
     *  EACH announced target, with the per-target split chosen at ANNOUNCEMENT
     *  (`targetRequirement.divideAsChosen`, each target ≥ 1) and snapshotted
     *  onto the stack item's `targetAmounts` — the exact machinery
     *  `dealDamageDividedAsChosen` already uses, read back through the same
     *  `resolveChosenDivision` fallback. Pollen Remedy: "Prevent the next 3
     *  damage that would be dealt this turn to any number of targets, divided
     *  as you choose." `total` MUST mirror the card's `divideAsChosen.total`
     *  and reuses its vocabulary (`number | "X" | "X+1"`); `duration` is the
     *  shield's expiry (`{ phase: "end-of-turn" }` for a "this turn" shield). */
    | {
          op: "preventDamage";
          mode: "next-n-divided";
          total: number | "X" | "X+1";
          duration: DurationSpec;
      }
    /** CR 701.19 (issue #846) — stack a regeneration shield on a permanent. A
     *  thin declarative skin over the single SpellContext primitive
     *  `applyRegenerationShield`, one execution path (ADR 0045). `target` is an
     *  object selector: an announced target slot (`{ target: N }` — Death Ward
     *  / Niall Silvain "Regenerate target creature"), the implicit `$source`
     *  (`{ ref: "$source" }` — a self-regenerate activated ability like Drudge
     *  Skeletons / Sedge Troll / Clay Statue), or a forEach `$each` (a
     *  regenerate-each rider). The shield is consumed by the next destroy event
     *  on that permanent this turn (CR 614.5 / 701.19a), expiring at CLEANUP if
     *  unused (CR 514.2). Skipped when the referenced permanent is gone
     *  (CR 608.2b — the resolver returns undefined; the primitive itself also
     *  no-ops off the battlefield and on a non-permanent selection). */
    | {
          op: "regenerate";
          target: EffectObjectSelector;
      }
    /** CR 701.19c (issue #1283) — flag a creature so it CAN'T be regenerated
     *  for the rest of the turn (the inverse of the `regenerate` shield): every
     *  regeneration shield AND the auto-regenerate replacement on it are
     *  suppressed until CLEANUP (CR 514.2). A thin declarative skin over the
     *  single SpellContext primitive `setTargetCantBeRegeneratedThisTurn`, one
     *  execution path (ADR 0045). `target` is an announced target slot
     *  (`{ target: N }` — Incinerate's "a creature dealt damage this way can't
     *  be regenerated this turn", Orcish Healer's activated ability), the
     *  resolving source (`$source` — Clergy of the Holy Nimbus's self-lock,
     *  routed through the SAME setTarget primitive with the source's id — the
     *  `setSourceCantBeRegeneratedThisTurn` variant is the identical flag write
     *  on `item.id`), or a forEach `$each`. DISTINCT from `destroy`'s
     *  `cantBeRegenerated` FLAG, which suppresses regeneration only for that
     *  one destroy event — this is a STANDALONE turn-scoped lock with no
     *  destroy attached. No-op on a non-creature or a permanent that has left
     *  the battlefield (CR 608.2b). */
    | { op: "preventRegeneration"; target: EffectObjectSelector }
    /** CR 614.1a (issue #1095) — arm a one-shot, turn-scoped replacement on a
     *  permanent: if it would DIE this turn, exile it instead. "If it would
     *  die this turn, exile it instead" (Scorching Lava's kicked rider,
     *  Disintegrate, Flame Rift-class removal that denies the graveyard). A
     *  thin declarative skin over the single SpellContext primitive
     *  `setExileOnDeath`, one execution path (ADR 0045) — the migration skin
     *  for the three `resolve()` closures that already call it
     *  (`drk/green.ts`, `fin/red.ts`, `lea/red.ts`).
     *
     *  `target` is an announced target slot (`{ target: N }`), the resolving
     *  source (`$source`), or a forEach `$each`. DEATH ONLY and cleared at
     *  CLEANUP (CR 514.2) — distinct from `SpellContext.setExileOnLeave`,
     *  which is a PERSISTENT flag covering every battlefield-departure path
     *  (bounce, sacrifice, destroy) and survives across turns (Dreams of the
     *  Dead). No-op on a non-permanent target, a non-CREATURE permanent, or
     *  one that has already left the battlefield (CR 608.2b) — so an "any
     *  target" spell whose target is a player or a planeswalker simply does
     *  nothing here, which is exactly what "that creature" in the Oracle text
     *  means. */
    | { op: "exileOnDeath"; target: EffectObjectSelector }
    /** CR 510.1c (issue #1283) — mark a permanent so it assigns NO combat
     *  damage for the rest of the turn: a SOURCE-side prevention (the creature
     *  still fights and can be dealt damage / die, it merely deals 0 in every
     *  combat-damage step this turn). A thin declarative skin over the single
     *  SpellContext primitive `markAssignsNoCombatDamage`, one execution path
     *  (ADR 0045). `target` is an announced target slot (`{ target: N }` —
     *  Warning / Restrain's "prevent all combat damage that would be dealt by
     *  target attacking creature this turn"), the resolving source (`$source`
     *  — Farrel's Zealot's "this creature assigns no combat damage this turn",
     *  routed through the SAME primitive with the source's id), or a forEach
     *  `$each`. DISTINCT from the receiver-side `preventNextNDamageToTarget` /
     *  `preventAllCombatDamage` Ops (which prevent damage dealt TO a creature)
     *  — this suppresses damage dealt BY the marked source. No-op on a
     *  permanent that has left the battlefield (CR 608.2b). */
    | { op: "markAssignsNoCombatDamage"; target: EffectObjectSelector }
    /** CR 701.27 / 712 (issue #1210, ADR 0067) — transform a permanent
     *  between its front and back printed characteristic sets. A thin
     *  declarative skin over the single SpellContext primitive `transform`,
     *  one execution path (ADR 0045). CR 712.8a — the SAME toggle flips
     *  EITHER direction: front → back if the permanent is currently showing
     *  its front, back → front if it's already transformed — so a card never
     *  needs two different Ops for "transform" vs "transform back". `target`
     *  is an object selector: almost always the implicit `$source`
     *  (`{ ref: "$source" }` — "{2}: Transform this artifact", the Incubator
     *  token shape, CR 701.53), but an announced target slot or a `forEach`
     *  `$each` member is accepted for generality. Skipped when the target is
     *  gone (CR 608.2b — the resolver returns undefined); the primitive
     *  itself also no-ops when the permanent's CURRENT face declares no
     *  `backFace` (`CardDefinition.backFace` / `TokenSpec.backFace`) —
     *  nothing to flip to/from. Scoped to a permanent ALREADY on the
     *  battlefield transforming in place; a full two-sided-card CASTING
     *  model (choosing a face to cast, per-face mana cost, CR 711) is out of
     *  scope. */
    | {
          op: "transform";
          target: EffectObjectSelector;
      }
    /** CR 712 / 400.7 / 306.5b (issue #2380) — exile a permanent and
     *  immediately return it to the battlefield showing its BACK face, under
     *  its OWNER's control: "exile Jace, then return him to the battlefield
     *  transformed under his owner's control" (the ORI flip-walker template —
     *  Jace, Vryn's Prodigy; Kytheon; Liliana; Nissa; Chandra; and Tamiyo,
     *  Inquisitive Student). A thin declarative skin over the single
     *  SpellContext primitive `exileAndReturnTransformed`, one execution path
     *  (ADR 0045).
     *
     *  DISTINCT from `transform` above, and deliberately not a flag on it: the
     *  two model different OBJECT IDENTITIES. `transform` flips a permanent
     *  that never leaves the battlefield (CR 712.8a) — same object, counters
     *  and attachments and summoning-sickness clock all preserved. This Op
     *  performs two real zone changes, so what returns is a NEW object (CR
     *  400.7): counters are gone, Auras/Equipment have fallen off, "enters the
     *  battlefield" triggers fire again, targets on the stack that pointed at
     *  the old permanent no longer find it, and a PLANESWALKER back face
     *  enters with its own CR 306.5b starting loyalty
     *  ({@link CardBackFace.loyalty}). One Op rather than a
     *  `exile` + `moveZone` pair because the Oracle clause is a single atomic
     *  instruction — nothing may be interposed between the exile and the
     *  return, and the returning object must already show its back face when
     *  it enters, which no ordering of the existing zone Ops can express.
     *
     *  `target` is an object selector: almost always the implicit `$source`
     *  (`{ ref: "$source" }` — every card in the template flips ITSELF), but an
     *  announced target slot or a `forEach` `$each` member is accepted for
     *  generality. Skipped when the target is gone (CR 608.2b).
     *
     *  `controller` names who the permanent returns UNDER. Omitted is its
     *  OWNER, the ORI flip-walker wording ("under his owner's control") and the
     *  behaviour of every caller before issue #2399. Fable of the Mirror-
     *  Breaker's chapter III reads "under YOUR control" and therefore passes
     *  `"controller"`; the two answers differ only for a Saga whose controller
     *  is not its owner. */
    | {
          op: "exileAndReturnTransformed";
          target: EffectObjectSelector;
          controller?: EffectPlayerRef;
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
     *  `token.staticEffects` is intentionally absent from `EffectTokenSpec`.
     *  `bind` (issue #1202, mirrors `destroy`/`exile`/`moveZone`'s own `bind`
     *  field, ADR 0045 "generalize, don't add") snapshots the LAST created
     *  token (`bindSnapshot`, the same snapshot-family binding those Ops
     *  already produce) so a follow-up Op in the SAME script can act on the
     *  specific just-created permanent — Cori-Steel Cutter's "create a 1/1
     *  white Monk creature token with prowess. You may attach this Equipment
     *  to it": the created Monk has no announced-target form (CR 601.2b, it
     *  didn't exist before this Op ran), so `{ op: "attach", target: { ref:
     *  "$monk" } }` reads the snapshot instead. For `count` > 1 the binding
     *  is overwritten to the LAST token created (mirrors `moveZone`'s own
     *  multi-pick note) — every current caller creates exactly one token per
     *  `createToken` Op. A non-positive/unresolved count binds nothing (no
     *  token was created, CR 608.2b — the follow-up Op skips). */
    | {
          op: "createToken";
          token: EffectTokenSpec;
          controller: EffectPlayerRef;
          count?: EffectValue;
          bind?: string;
      }
    /** CR 707.2 + CR 111.1 (issue #1459) — create one or more tokens that are
     *  COPIES of a runtime source permanent. The copy sibling of `createToken`:
     *  where `createToken` takes a JSON-pure token spec, this Op reads a LIVE
     *  source permanent and drives the same copy machinery Clone uses
     *  (`applyCopy`, via `SpellContext.createTokenCopyOf`), stamping the
     *  copiable characteristics of the source onto a fresh token — which is
     *  exactly why it is a distinct Op, not a flag on `createToken`. `source`
     *  is an `EffectObjectSelector`: an announced target slot (`{ target: N }`
     *  — Dance of Many's "create a token that's a copy of target nontoken
     *  creature"), OR a `ref` to a permanent bound earlier in the SAME script
     *  (`{ ref: "$token" }` — "copy the token you just made", the `createToken`
     *  → `createTokenCopy` bind chain Ocelot Pride #1461 needs). `controller`
     *  names who gets the copies (the resolving `"controller"` by default; an
     *  announced target-slot / relative player). `count` is an optional
     *  EffectValue (default 1; a literal / ref / count for a count-scaled
     *  creation); a non-positive count creates nothing (CR 707.1). The copy is
     *  stamped with the resolving source's `createdBy` provenance (the same
     *  leave-linkage Dance of Many's exile/sacrifice triggers rely on). Skipped
     *  when the controller cannot be resolved, the count is non-positive /
     *  unresolved, or the source has left the battlefield (CR 608.2b — the copy
     *  fizzles). `bind` (mirrors `createToken`'s own bind) snapshots the LAST
     *  created copy so a follow-up Op in the same script can act on it. */
    | {
          op: "createTokenCopy";
          source: EffectObjectSelector;
          controller: EffectPlayerRef;
          count?: EffectValue;
          bind?: string;
          /** CR 508.4 (issue #1195) — see `TokenSpec.entersTapped` /
           *  `entersAttacking` (`cards/types.ts`): the copy enters the
           *  battlefield already tapped and/or already attacking, joining
           *  the CURRENT combat directly rather than through the normal
           *  declare-attackers action (Satya, Aetherflux Genius's "create a
           *  tapped and attacking token that's a copy of…"). Passed straight
           *  through to `SpellContext.createTokenCopyOf`'s own entry-state
           *  opts. Omitted (the common case, Dance of Many) — the copy
           *  enters untapped and not attacking, exactly as before this
           *  issue. */
          entersTapped?: boolean;
          entersAttacking?: boolean;
          /** CR 707.2's "except" clause — the copiable values the copy effect
           *  overrides on top of the copied object (issue #2339, Eternalize
           *  CR 702.129a: "a copy of it, except it's a 4/4 black Zombie in
           *  addition to its other types and it has no mana cost").
           *
           *  JSON-pure (ADR 0046) and purely declarative: every field maps 1:1
           *  onto `CopyEffectOptions`, which `applyCopy` already interprets —
           *  no new execution path. Omitted entirely by an unexceptional copy
           *  (Dance of Many), which is every caller before this issue.
           *
           *  Parametrised rather than keyword-shaped on purpose: Embalm
           *  (CR 702.128a — white Zombie, printed body kept) is the SAME Op
           *  with a different `except`, so the seam hosts it with no
           *  redesign. */
          except?: {
              /** "…it's a N/N" — base power/toughness (layer 7a). */
              basePower?: number;
              baseToughness?: number;
              /** "…it's black" — an explicit colour set (layer 5). */
              colors?: Color[];
              /** "…a Zombie in addition to its other types" — appended
               *  creature subtypes (CR 205.1b; Oracle-worded as a type). */
              additionalSubtypes?: string[];
              /** "…except it has haste" — keywords the copy has on top of the
               *  copied object's (issue #2399). A COPIABLE value per CR 707.2,
               *  not a layer-6 grant; see
               *  `CopyEffectOptions.additionalStaticAbilities`. */
              additionalStaticAbilities?: string[];
              /** "…it has no mana cost" — mana value 0 (CR 202.3). */
              noManaCost?: boolean;
              /** Scryfall print id for the token's own printed art (CR 111).
               *  Cosmetic; see `CopyEffectOptions.imagePrintId`. */
              imagePrintId?: string;
          };
      }
    /** CR 114 (issue #1221) — create an emblem in the command zone. A thin
     *  declarative skin over the single SpellContext primitive `createEmblem`,
     *  one execution path (ADR 0045). `emblem` is a KEY into the emblem registry
     *  (`convex/cards/emblems.ts`); the granted continuous/triggered abilities
     *  (closures) live there, so the Op body stays JSON-pure (ADR 0046) — the
     *  emblem is referenced by id exactly as a token references its synthesized
     *  card def. `controller` (default "controller") is the emblem's owner
     *  (CR 114.3). Typically the body of a planeswalker's ultimate. */
    | { op: "emblem"; emblem: string; controller?: EffectPlayerRef }
    /** CR 720.2 (issue #1199) — crowns a player the monarch. A thin
     *  declarative skin over the single SpellContext primitive
     *  `becomeMonarch`, one execution path (ADR 0045): `controller` names who
     *  is crowned — the resolving controller (`"controller"`, the default and
     *  vast majority — Forth Eorlingas!, Palace Jailer's own ETB) or an
     *  announced target-slot / relative player. Idempotent (a player already
     *  the monarch becoming the monarch again is a no-op, CR 720.2/720.3) and
     *  self-reassigning (crowning someone new displaces whoever held it — a
     *  single scalar, no explicit "stop being monarch" Op). Skipped when the
     *  player ref cannot be resolved (CR 608.2b). */
    | { op: "becomeMonarch"; controller?: EffectPlayerRef }
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
     *  chooser cannot be resolved (CR 608.2b).
     *
     *  NOT the tool for a PRINTED modal spell or ability (ADR 0089). This Op
     *  picks its mode DURING resolution, which is right for a "choose one"
     *  written inside a resolving effect but wrong for a mode the CR chooses at
     *  announcement (CR 601.2b, before targets in 601.2c): a resolve-time pick
     *  can neither lock a target at announcement nor give the opponent a
     *  window on the chosen mode. Those use `CardDefinition.modes`
     *  ({@link SpellMode}) or `ActivatedAbility.modes` ({@link AbilityMode}),
     *  which carry a per-mode `targetRequirement` — deliberately absent from
     *  {@link EffectMode} for exactly this reason. */
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
    /** CR 705 (issue #1281) — flip a coin INLINE, no reveal-ack suspension: the
     *  synchronous sibling of `coinFlip`. A thin declarative skin over the
     *  single SpellContext primitive `flipCoin` (the same seeded-PRNG bit
     *  `requestCoinFlip` draws — issue #1281 does not add a new random source,
     *  it only skips that primitive's ADR 0023 reveal-overlay suspend), one
     *  execution path (ADR 0045): the bit is drawn and the matching `win`
     *  (flipper wins) / `loss` branch's `effects` runs in the SAME interpreter
     *  pass, through the SAME `runOpList` path an `if` branch / `coinFlip`
     *  branch uses — so a branch composes bind / ref / if / forEach and even a
     *  further suspending Op. `player` names the flipping player (the resolving
     *  `"controller"` by default — CR 705.1; an announced target-slot /
     *  relative player otherwise). Like `coinFlip` it is a structural construct
     *  that always re-descends on a re-walk (in the interpreter's runOpList
     *  skip-exception), so a suspension inside the taken branch resumes
     *  correctly. Skipped when the flipper cannot be resolved (CR 608.2b).
     *  SCOPE (issue #1281): for a card whose flip genuinely has no interactive
     *  reveal UX to preserve (Goblin Artisans resolved it synchronously
     *  pre-DSL) — use `coinFlip` instead when the reveal-ack UX is wanted. */
    | {
          op: "coinFlipSync";
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
    /** CR 400.2 look (Urza's Bauble) — "Look at a card at random in
     *  `player`'s hand", a PRIVATE look shown only to `looker` (default the
     *  resolving controller, CR 113.7). Distinct from the public `reveal` Op
     *  (CR 701.20, every player): the seeded-PRNG-picked card is stamped known
     *  to the looker ALONE (`SpellContext.markKnown`) and a transient look
     *  dialog is enqueued for the looker (`notifyReveal` kind "look"). Empty
     *  hand → no-op (CR 608.2b). */
    | {
          op: "lookRandomHand";
          player: EffectPlayerRef;
          looker?: EffectPlayerRef;
      }
    /** CR 201.3 / 202.3 (issue #1085) — "chooses a card name" as part of
     *  resolution. A thin declarative skin over the single SpellContext
     *  primitive `requestNameCard`, one execution path (ADR 0045): SUSPENDS
     *  like `choice` / `mayPay` — the first execution enqueues a `name-card`
     *  Pending Choice and reports "suspend"; the resumed execution reads the
     *  chosen name back off the SAME `collectedChoices` store `bind`-carrying
     *  Ops use (`recallChoice`, keyed by `choiceId` — the binding name doubles
     *  as the choiceId, exactly like `choice`/`mayPay`'s own `bind`). The
     *  chosen name is a NAME-family binding (a single-element string array,
     *  the identical runtime shape a picks binding uses) — read back ONLY by
     *  a bare `{ ref: "$binding" }` in an `EffectCardFilter.name` position
     *  (Desperate Research: "put all of them with THAT name into your hand").
     *  `player` names the chooser (the resolving controller by default, an
     *  announced target-slot player, or a relative player). `bind` is
     *  REQUIRED — a name choice nothing reads back is meaningless. `excludeBasicLand`
     *  (CR 201.3, Desperate Research's "other than a basic land card name")
     *  rejects a basic-land name at SUBMIT time (`applyNameCardSubmit`,
     *  `pendingChoiceSubmit.ts`) — the chooser is asked again, exactly like
     *  every other illegal-choice rejection in that pipeline; it is not a
     *  post-hoc filter here. */
    | {
          op: "nameCard";
          player: EffectPlayerRef;
          prompt: string;
          bind: string;
          excludeBasicLand?: boolean;
      }
    /** CR 701.20a reveal / CR 401.4 look (issue #1085) — deterministic
     *  sibling of `lookDistribute`: reveals the top `look` cards of a library to
     *  EVERY player (unlike `lookDistribute`'s private per-chooser look), puts
     *  EVERY looked-at card matching `filter` into hand with NO player
     *  choice (the filter alone decides — CR 608.2b, zero matches is a no-op
     *  for the hand leg), and sends every NON-matching looked-at card to
     *  `destination`. Mirrors the `mill`/`scryReorder` split (a deterministic
     *  Op is a SEPARATE Op from its choice-driven cousin, never a mode flag
     *  bolted on — ADR 0045 "one execution path" per Op): `lookDistribute` is the
     *  "you choose which to keep" mechanic; this is the "the filter chooses"
     *  mechanic, so there is no suspending Pending Choice at all — the whole
     *  looked-at window is revealed and split in one synchronous step.
     *  `player` names whose library; `look` is how many top cards to reveal;
     *  `filter` is REQUIRED (a filter-less "look N, keep all" dig is already
     *  `lookDistribute`'s job with `take` = `look`); `destination` is where the
     *  non-matching cards go (`"exile"` — Desperate Research's "Exile the
     *  rest"; `"graveyard"` — a Surveil-shaped future card); `bind` (optional)
     *  snapshots the FIRST card put into hand, mirrors `lookDistribute`'s own
     *  `bind` (resolves as a `"hand-card"` TargetSelection). */
    | {
          op: "digMatchingToHand";
          player: EffectPlayerRef;
          look: EffectValue;
          filter: EffectCardFilter;
          destination: "exile" | "graveyard";
          bind?: string;
      }
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
     *  validator rejects it for `"hand"`/`"graveyard"`. `zone: "exile"`
     *  (issue #1156 — Dauthi Voidwalker) is a PUBLIC zone like graveyard: a
     *  `filter` (typically `hasCounter`) precomputes a `candidateIds`
     *  allow-list the same way. */
    | {
          op: "choice";
          kind: EffectChoiceKind;
          /** The chooser. Defaults to also being the owner of the zone picked
           *  from (Mind Rot, Innocent Blood — the common case). */
          player: EffectPlayerRef;
          zone: "battlefield" | "hand" | "library" | "graveyard" | "exile";
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
          /** CR 601.2c / 608.2 — restricts the pick to specific ALREADY-KNOWN
           *  objects instead of a whole zone: the announced targets, or
           *  snapshots an earlier Op bound. `zone: "battlefield"` only
           *  (validator-enforced) — the other zones are hidden or unordered,
           *  and nothing there can be named ahead of the pick.
           *
           *  This is what lets a card whose text says "choose one of THEM" be
           *  a real click on a card rather than a list of sentences: Barrin's
           *  Spite ("Choose two target creatures … their controller chooses
           *  and sacrifices ONE of them") narrows the choice to
           *  `[{ target: 0 }, { target: 1 }]`, so the chooser clicks the
           *  creature on the board instead of picking "the first"/"the second"
           *  out of prose that names neither.
           *
           *  A selector that no longer resolves to a battlefield permanent is
           *  dropped from the candidate set (CR 608.2b — it left in response),
           *  and the count clamps to what is left, exactly as a zone-wide
           *  choice clamps to availability. Composes with `filter`, which
           *  further narrows the resolved set. */
          candidates?: EffectObjectSelector[];
          /** Snapshots the ONE candidate that was NOT picked — "the other".
           *  Requires `candidates` (validator-enforced) and binds a normal
           *  object snapshot, so any object-acting Op reads it: `moveZone
           *  { target: { ref: "$other" } }`, `destroy`, `dealDamage`.
           *
           *  Barrin's Spite's second clause ("Return THE OTHER to its owner's
           *  hand") is the shape this exists for: the complement of the pick
           *  is not expressible as an announced slot, because which slot it is
           *  depends on the choice. Left UNCAPTURED (so every reader skips, CR
           *  608.2b) unless exactly one candidate remains unpicked — with two
           *  candidates and one pick that is always the case, and any other
           *  arrangement has no single "other" to name. */
          bindOther?: string;
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
          /** OPTIONAL author-supplied stable choice id (issue #1282). Defaults
           *  to `bind` (unchanged behaviour for every pre-existing `choice` Op
           *  card) when omitted. `bind` doubles as BOTH the ref-lookup name AND
           *  the `PendingChoice.choiceId`/wire `choiceId` today, but `bind`
           *  is constrained to a `$`-prefixed identifier (the ref-name
           *  grammar) — a migrated card whose pre-existing `resolve()`-era
           *  test pins a specific literal `choiceId` string (e.g.
           *  `"bazaar-discard"`, not `"$"`-shaped) can't reproduce it through
           *  `bind` alone. `id`, when present, is passed to
           *  `SpellContext.requestChoice` as the `choiceId` INSTEAD of `bind`
           *  (so `PendingChoice.choiceId` / the wire `choiceId` is exactly
           *  this string); the interpreter separately mirrors the resolved
           *  picks into the `bind`-keyed binding so `{ ref: "$name" }` reads
           *  keep working transparently. Purely a migration-equivalence
           *  affordance — does not change resolution behavior. */
          id?: string;
      }
    /** CR 701.9 — `player` discards cards. TWO shapes share this Op name
     *  (ADR 0045, issue #1279's bulk generalization of the original
     *  picks-only shape): with `cards` (a bare picks ref, `{ ref: "$picked"
     *  }`), each picked card still in the player's hand is discarded —
     *  Mind Rot, Innocent Blood's "each player discards a card" template.
     *  WITHOUT `cards` (issue #1279) — every card currently in the player's
     *  hand is discarded, no selection ("discards their hand", Wheel of
     *  Fortune / Windfall / Anje's Ravager's attack trigger). Both shapes
     *  discard each card through `SpellContext.discardCard` (Library of Leng
     *  replacement + CARD_DISCARDED triggers apply exactly as for imperative
     *  cards, including madness eligibility, CR 702.35c). The `cards` shape
     *  is skipped when the binding was never captured (the choice found no
     *  candidates — CR 608.2b); the whole-hand shape skips only when `player`
     *  cannot be resolved (an empty hand is simply a no-op loop). */
    | { op: "discard"; player: EffectPlayerRef; cards?: EffectRef }
    /** CR 701.9a — `player` discards `count` cards chosen AT RANDOM from their
     *  hand (Hymn to Tourach's "discards two cards at random", Mind Twist's
     *  "discards X cards at random", Gwendlyn Di Corci's random-discard
     *  activated ability). A thin declarative skin over the single
     *  `SpellContext.discardAtRandom` primitive (one execution path, ADR 0045),
     *  which draws the discarded cards from the game's seeded PRNG so replays
     *  stay deterministic. DISTINCT from the `discard` Op: that Op discards a
     *  player-CHOSEN set (a `choice`-bound picks ref) or the WHOLE hand — this
     *  one performs the random SELECTION the engine owns, which no `choice`
     *  binding can express. `count` is a literal or an `EffectValue` (Mind
     *  Twist's chosen-cost {X}); `player` is an announced target slot
     *  (`{ target: N }`) or a relative selector. No type/subtype filter — the
     *  filtered variant (The Fallen's "discards a CREATURE card at random",
     *  which also reveals the hand first) stays resolve() until a filter
     *  parameter is warranted. Skipped when `player` cannot be resolved
     *  (CR 608.2b); an empty hand is a no-op.
     *
     *  Optional `bind` (issue #1123, Aether Rift) snapshots the FIRST
     *  discarded card as a `"graveyard-card"` object (mirrors `destroy`/
     *  `exile`'s `bind` shape, `bindSnapshot`) — the card is ALREADY in the
     *  graveyard (a public zone, CR 400.2) by the time the snapshot is taken,
     *  so this is a live characteristics read, not last-known information. A
     *  later `if` can test what was discarded via `boundMatchesFilter`
     *  ("If you discard a creature card this way …", Aether Rift), and a
     *  later `moveZone { target: { ref }, to: "battlefield" }` can reanimate
     *  it straight from the binding — `moveZone`'s existing graveyard-source
     *  recovery path (issue #1469) re-derives the id from ANY snapshot
     *  binding, not just `destroy`/`exile`'s. Uncaptured when nothing was
     *  discarded (an empty hand, CR 608.2b) — a later `ref` simply misses. */
    | {
          op: "discardAtRandom";
          player: EffectPlayerRef;
          count: EffectValue;
          bind?: string;
      }
    /** CR 400.7 / 607 (issue #1947) — choose a card AT RANDOM from the exile
     *  pile linked to the resolving ability's own source
     *  (`SpellContext.pickRandomCardExiledWith(ctx.sourceInstanceId)`,
     *  reading the same `exiledBySourceId` stamp `moveZone`'s `linkToSource`
     *  flag or `hideaway` leaves behind), and put it into ITS OWNER's hand —
     *  CR 400.7's link persists even after the linking source leaves the
     *  battlefield (the remaining exiled cards don't come back), and the
     *  modern-Oracle destination is the found card's OWNER (which may
     *  differ from the activating player). A thin declarative skin over the
     *  single `SpellContext.pickRandomCardExiledWith` primitive + the
     *  existing `moveCardById`, one execution path (ADR 0045): the pick is
     *  drawn from the game's seeded PRNG, mirroring `discardAtRandom`'s
     *  determinism precedent so replays reproduce the same result. No
     *  fields — the pool is always "the pile linked to $source" and the
     *  destination is always the picked card's own owner's hand (Skyship
     *  Weatherlight: "Choose a card at random that was exiled with Skyship
     *  Weatherlight. Put that card into its owner's hand."). Skipped
     *  (CR 608.2b no-op) when the pile is empty — the official ruling that
     *  the ability is still activatable with nothing exiled; it simply
     *  resolves with no effect. */
    | { op: "randomExileToHand" }
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
          /** The cost to pay on accept: the static mana / life / sacrifice
           *  union (CR 702.24 shape), a dynamically-derived mana cost read
           *  off a runtime-selected object at execution time (issue #1150 —
           *  `DynamicMayPayManaCost`, Flash's "pay its mana cost reduced by
           *  {2}"), or a dynamically-derived ENERGY cost (issue #1195 —
           *  `DynamicMayPayEnergyCost`, Satya's "pay {E} equal to its mana
           *  value"). Omitted for a bare cost-free "you may" decision (issue
           *  #680). */
          cost?: MayPayCost | DynamicMayPayManaCost | DynamicMayPayEnergyCost;
          prompt: string;
          /** REQUIRED — the boolean binding name (`"$paid"`). A may-pay whose
           *  outcome nothing reads is meaningless, so the grammar demands it. */
          bind: string;
      }
    /** CR 701.6a — counter the announced target spell (remove it from the
     *  stack, put it into its owner's graveyard). Routes through
     *  `SpellContext.counter`; skipped when the target already left the stack
     *  (CR 608.2b). The consequence half of the counter/punisher pattern
     *  ("Counter target spell unless its controller pays {N}", issue #806).
     *  `destination` (issue #683) overrides the default graveyard destination
     *  for a COUNTERED SPELL — "if that spell is countered this way, exile it
     *  / put it on top of its owner's library / put it into its owner's hand
     *  instead" (No More Lies, Memory Lapse, Remand). Omitted/`"graveyard"`
     *  is the CR 701.6a default. */
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
    /** CR 701.21 — sacrifice the permanents a `choice` Op picked (a bare
     *  picks ref, issue #807). Each picked permanent still on the battlefield
     *  is sacrificed through `SpellContext.sacrifice` — its controller puts
     *  it into its owner's graveyard; indestructible does not save it
     *  (CR 701.21a) and dies-triggers fire exactly as for imperative cards.
     *  Skipped when the binding was never captured (the choice found no
     *  candidates — CR 608.2b: a player with nothing to sacrifice does
     *  nothing). */
    | {
          op: "sacrifice";
          /** A bare picks ref naming a `choice` Op's bind — sacrifices EVERY
           *  picked permanent (CR 701.21, the "each player sacrifices …"
           *  forEach pattern). Mutually exclusive with `target`. */
          permanents?: EffectRef;
          /** A single announced target / snapshot-bound permanent to sacrifice
           *  (CR 701.21 — "sacrifice that creature" / "sacrifice this
           *  creature", Kjeldoran Elite Guard, Phantasmal Mount). Resolved via
           *  the object-ref path (SNAP_ID + battlefield re-check, CR 608.2b),
           *  so a permanent already gone is a no-op. Mutually exclusive with
           *  `permanents`. */
          target?: EffectObjectSelector;
          /** CR 608.2h LAST-KNOWN INFORMATION — snapshots the sacrificed
           *  permanent's characteristics BEFORE it leaves the battlefield, so
           *  a later Op can read them off the graveyard-bound object
           *  (`{ ref: "$sac.power" }` — Minsc & Boo's "deals X damage …, where
           *  X is that creature's power"). Mirrors `destroy`/`exile`/
           *  `moveZone`'s own `bind` — the same snapshot family, same reader
           *  refs. On the `permanents` picks form it snapshots the FIRST
           *  picked permanent (the "sacrifice A creature" shape; a multi-pick
           *  mass sacrifice has no single "that creature" to name anyway),
           *  mirroring `lookDistribute`'s first-kept-card bind. Never captured when
           *  nothing was sacrificed (CR 608.2b — a later `ref` then reads
           *  undefined and its Op skips). */
          bind?: string;
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
     *  `next-cleanup-step` (CR 514.3a) is a global-boundary timing with one
     *  extra consequence: firing it opens the cleanup step's single priority
     *  window and an additional cleanup step follows (gre/phases.ts).
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
          /** REQUIRED for every INSTANCE-SCOPED timing: both leave-watches
           *  (`leaves-battlefield` and its indefinite twin
           *  `leaves-battlefield-indefinite`, CR 603.7a / 603.10) and the
           *  unblocked-attack watch (`attacks-unblocked`, CR 509.1h) — the
           *  specific permanent whose departure ("When THAT creature leaves
           *  the battlefield this turn, …" / earthbend N's unbounded "When it
           *  dies or is exiled, …") or unblocked attack ("This turn, when
           *  target creature you control attacks and isn't blocked, …") fires
           *  this delayed trigger, resolved to an instance id at scheduling
           *  time. Rejected for every phase-boundary timing.
           *  Distinct from `capture` (which carries the body's data): `watch`
           *  is the trigger CONDITION's watched instance, not necessarily
           *  anything the body reads. */
          watch?: EffectObjectSelector;
          /** The delayed body — a nested Effect Script run by the
           *  interpreter when the trigger fires. */
          effects: EffectOp[];
      }
    /** reflexiveTrigger — a REFLEXIVE triggered ability (CR 603.3c) created
     *  by the resolving effect that just did the thing it triggers off:
     *  "Sacrifice a creature. **When you do**, ~ deals X damage to any
     *  target, where X is that creature's power" (Minsc & Boo, Timeless
     *  Heroes). It is NOT a delayed trigger — nothing is waited for. The
     *  ability is queued as the Op executes and goes on the stack ABOVE the
     *  object that created it the next time a player would receive priority,
     *  choosing its targets as it goes on the stack (CR 603.3d); both players
     *  then get priority before it resolves. Because it is a separate stack
     *  object, its `targetRequirement` is announced there — which is the
     *  whole point of the shape: the target is chosen KNOWING what was
     *  sacrificed.
     *
     *  Rides the existing inline-body trigger machinery whole (ADR 0048): the
     *  body is a nested pure-JSON Op list persisted on the queued stack item,
     *  placed through `placeTriggersOnStack` (APNAP ordering, CR 603.3b) and
     *  resolved through `runDelayedTriggerBody`. No new resolution path.
     *
     *  `capture` is the ONLY data crossing into the body (outer bindings —
     *  `$source` included — are not visible inside), keyed by the binding
     *  name the body reads it back under. Unlike `delayedTrigger`'s capture,
     *  a bare binding ref carries the WHOLE recorded binding verbatim rather
     *  than flattening it to an instance id — which is what makes CR 608.2h
     *  last-known information survive: a `sacrifice`-bound snapshot still
     *  reads `$sac.power` after the creature reached the graveyard, where an
     *  id would re-bind to nothing. Does not nest inside another
     *  `reflexiveTrigger` or a `delayedTrigger` body (validator-enforced). */
    | {
          op: "reflexiveTrigger";
          /** Oracle text of the reflexive ability (rendered on its stack
           *  tile — it has no card-def ability row to read text from). */
          oracleText: string;
          /** What crosses into the body, keyed by the binding name it is read
           *  back under. */
          capture?: Record<string, EffectCaptureSource>;
          /** Targets announced as the reflexive trigger goes on the stack
           *  (CR 603.3d) — read by the body as `{ target: 0 }`. Omitted for a
           *  non-targeted reflexive ability. */
          targetRequirement?: TargetRequirement;
          /** The reflexive body — a nested Effect Script run when the
           *  trigger resolves. */
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
    /** CR 508.1a / 509.1a / 509.1b — grant a turn-scoped combat restriction
     *  to a permanent. A thin declarative skin over three existing SpellContext
     *  primitives, one execution path (ADR 0045) — the same "restriction grant"
     *  reuse `tapUntap` already established for tap/untap:
     *  - `"cant-attack"`     → `setCantAttackThisTurn`   (CR 508.1a, ADR 0053)
     *  - `"cant-block"`      → `setCantBlockThisTurn`     (CR 509.1a, ADR 0053)
     *  - `"cant-be-blocked"` → `setCantBeBlockedThisTurn` (CR 509.1b — the
     *    evasion side: OTHER creatures can't block this one this turn;
     *    Teleport, Trailblazer, Tawnos's Wand, Runed Arch, Creeping Tar-Pit).
     *  `target` is an object selector: an announced target slot, `$source`, or
     *  a `forEach { set: "bound" }` member `$each` over an unchosen pile (Fight
     *  or Flight, Stand or Fall). Skipped when the referenced permanent is gone
     *  (CR 608.2b). */
    | {
          op: "restrictCombat";
          restriction: "cant-attack" | "cant-block" | "cant-be-blocked";
          target: EffectObjectSelector;
      }
    /** CR 508.1c (issue #1283) — Island Sanctuary's player-scoped "until your
     *  next turn, you can't be attacked except by creatures with flying
     *  and/or islandwalk" protection. A thin declarative skin over the single
     *  SpellContext primitive `setIslandSanctuaryProtection`, one execution
     *  path (ADR 0045): sets `state.islandSanctuaryProtection` to `player`'s
     *  id, read by the attack-declaration legality check
     *  (`convex/gre/combat.ts`) and cleared at the START of that player's
     *  next turn (`convex/gre/phases.ts`) — mirroring `grantCastTiming`'s
     *  "until your next turn" boundary, NOT CLEANUP. Distinct from
     *  `restrictCombat`, which is PERMANENT-scoped (a target creature can't
     *  attack/block/be-blocked) with no "except by" qualifier — this is a
     *  PLAYER-scoped protection with the flying/islandwalk carve-out baked
     *  into the primitive itself. No other printed card shares this exact
     *  shape, so the Op stays a single-purpose skin rather than a
     *  generalized "can't be attacked except by …" grammar (ADR 0045
     *  "generalize, don't add" — nothing else to generalize against yet).
     *  Skipped when the player cannot be resolved (CR 608.2b). */
    | { op: "setIslandSanctuaryProtection"; player: EffectPlayerRef }
    /** CR 702.16b/e/i (issue #674) — "you gain protection from everything until
     *  your next turn" (The One Ring). A thin declarative skin over the single
     *  SpellContext primitive `setPlayerProtectionFromEverything`, one
     *  execution path (ADR 0045): adds `player`'s id to
     *  `state.playerProtectionFromEverything`, read by the player-target gate
     *  (`playerHasProtectionFromEverything`, called by BOTH `getLegalTargets`
     *  and the `selectTarget` mutation) and by `applyPlayerDamagePrevention`
     *  (the one chokepoint every player-damage sink routes through), and
     *  cleared at the START of that player's next turn (`convex/gre/phases.ts`)
     *  — the same "until your next turn" boundary
     *  `setIslandSanctuaryProtection` / `grantCastTiming` use, NOT CLEANUP.
     *
     *  PLAYER-scoped and unconditional, which is what distinguishes it from
     *  every other protection surface: the card-scoped keyword
     *  (`staticAbilities: ["protection from <colour>"]`, `gre/protection.ts`)
     *  is colour-parameterized and lives on a permanent, and `preventDamage`
     *  establishes a FINITE / source-matched shield. Protection from
     *  EVERYTHING is protection from each and every object regardless of
     *  characteristics (CR 702.16i) with no controller exception, so there is
     *  nothing to parameterize — hence a single-purpose skin rather than a
     *  generalized "player gains protection from Q" grammar (ADR 0045
     *  "generalize, don't add" — The One Ring is the only printed card with
     *  this shape). Duration is intrinsic, no `duration` field.
     *  Skipped when the player cannot be resolved (CR 608.2b). */
    | { op: "setProtectionFromEverything"; player: EffectPlayerRef }
    /** CR 119.4 / 121.1 (issue #1283) — Sylvan Library's single ranged 0..N
     *  "cards drawn this turn" hand pick, with a per-NOT-chosen life cost. A
     *  thin declarative composition over EXISTING SpellContext primitives —
     *  `getDrawnThisTurnIds` / `getHandIds` / `getLife` / `requestChoice` /
     *  `moveHandCardToLibraryTop` / `loseLife` — no new primitive (ADR 0045
     *  "generalize, don't add"). `pool` names the candidate set (only
     *  `"drawn-this-turn"` today — the cards `player` drew this turn that are
     *  still in their hand); `max` is the "choose N" cap (Sylvan Library's
     *  printed "choose two", CR 608.2b-clamped to the pool size); `costPerKept`
     *  is the life paid PER pool member NOT put on top (CR 119.4's "pay 4 …
     *  or put the card on top", collapsed into ONE ranged pick because the two
     *  printed per-card options are reachable-outcome-identical — keep both =
     *  pay 8, topdeck both = pay 0, mix = pay 4 — see the card's own comment).
     *  CR 119.4 — the raised choice's `min` is
     *  `max(0, n - floor(life / costPerKept))` so a player is never asked to
     *  keep more cards than they can afford, computed by the Op itself before
     *  raising the `choose-hand-card` pick. SUSPENDS like `choice` /
     *  `putBack`: the pick is consumed internally (no `bind`), and — because
     *  `runOpList` checkpoints THIS Op's own pre-order position — an earlier
     *  Op in the same script (the "draw two" that precedes it) is skipped on
     *  resume (CR 608.3), the exact isolation the old `resolveSteps` split
     *  used to need by hand. */
    | {
          op: "rangedTopdeck";
          player: EffectPlayerRef;
          pool: "drawn-this-turn";
          max: EffectValue;
          costPerKept: EffectValue;
          prompt?: string;
      };

/** A PREDEFINED predicate form for the `if` construct (ADR 0045, issue #806).
 *  The grammar is frozen at three enumerated forms — there are NO arbitrary
 *  boolean expressions, so the validator can statically check every reference
 *  and the bot can read the branch condition without executing the card:
 *
 *  - a BOOLEAN BINDING test — reads a boolean binding produced by an earlier
 *    Op (today: a `mayPay` Op's outcome), optionally negated with `not`. This
 *    is the "unless its controller pays {2}" form: `{ not: { binding: "$paid" } }`.
 *  - a COMPARISON between two numeric operands — each a literal, a `ref` on a
 *    bound snapshot's power/toughness, or a `count` of a declaratively-selected
 *    set — with one of the standard relational operators.
 *  - a PICKS-NONEMPTY test (issue #1287) — reads whether a `choice` Op's
 *    picks binding actually captured anything. This is the "draw only if a
 *    card was actually discarded" gate: a chosen-discard cost paid in-effect
 *    (CR 601.2h convention, `choice(zone: "hand")` + `discard`) has no picks
 *    when the zone had zero matching candidates (the choice Op skips
 *    entirely, CR 608.2b — the binding is never captured); a later Op's
 *    outcome that should track "did the discard actually happen" reads this
 *    predicate rather than a boolean binding, since `choice` has no
 *    mayPay-style yes/no outcome of its own. Krovikan Sorcerer / Mesmeric
 *    Trance: `{ picksNonEmpty: { ref: "$discarded" } }`.
 *  - a TARGET-IS-ANOTHER test (issue #1315, CR 702.165a) — true iff the
 *    named announced target slot resolves to a permanent OTHER than the
 *    currently-resolving ability's source (`ctx.sourceInstanceId`). This is
 *    Backup's "if that's another creature" gate: `{ targetIsAnother: { target: 0 } }`.
 *    An object-identity comparison rather than a numeric one — deliberately
 *    narrow (identity only, no property comparison) so it stays inside the
 *    frozen predicate grammar's spirit (ADR 0045) while covering the general
 *    "self-target vs. other-target" shape any future keyword sharing Backup's
 *    "put a counter on target X; if that's ANOTHER X, do more" phrasing would
 *    also need.
 *  - a PICKS-MATCH-FILTER test (issue #1343) — reads whether at least one
 *    card in a `choice` Op's picks binding matches an `EffectCardFilter`,
 *    resolved via `player`'s graveyard (CR 701.9 — a discard always lands
 *    there, so this predicate is meaningful once the matching `discard` Op
 *    has run). This is connive's "if you discarded a NONLAND card" gate (CR
 *    701.50, Ledger Shredder): `{ picksMatchFilter: { ref: "$discarded" },
 *    player: "controller", filter: { excludeType: "Land" } }`. A picked id
 *    no longer resolvable in `player`'s graveyard (a replacement redirected
 *    it elsewhere, or the binding was never captured — CR 608.2b) counts as
 *    no match for that id rather than aborting the whole predicate.
 *    `picksNonEmpty`'s narrower cousin: "was anything picked" vs. "does what
 *    was picked match a card shape" — reuses the SAME `matchesCardFilter`
 *    reader the `choice`/`count` constructs already share, no new filter
 *    grammar.
 *  - a TARGET-MATCHES-GRAVEYARD-FILTER test (issue #2385) — `picksMatchFilter`'s
 *    ANNOUNCED-TARGET sibling: an object selector (`{ target: n }` / `$source`
 *    / a `forEach` `$each`) instead of a `choice` Op's picks binding, resolved
 *    against `player`'s graveyard with the SAME `matchesCardFilter` reader.
 *    Tamiyo, Seasoned Scholar's -3 "if it's a green card, add one mana of any
 *    color": `{ targetMatchesGraveyardFilter: { target: 0 }, player:
 *    "controller", filter: { color: "G" } }` — the card targeted by
 *    `targetRequirement: { zone: "graveyard" }` was never a `choice` pick, so
 *    `picksMatchFilter` cannot reach it.
 *
 *  Growing the predicate vocabulary (a new comparison operator, a new binding
 *  kind) is cheap; adding a NON-enumerated form (a raw expression) requires
 *  reopening ADR 0045. */
export type EffectPredicate =
    | EffectBindingPredicate
    | EffectComparisonPredicate
    | EffectPicksNonEmptyPredicate
    | EffectTargetIsAnotherPredicate
    | EffectPicksMatchFilterPredicate
    | EffectBoundMatchesFilterPredicate
    | EffectObjectMatchesFilterPredicate
    | EffectSharesColorPredicate
    | EffectHasCityBlessingPredicate
    | EffectTargetMatchesGraveyardFilterPredicate;

/** Shares-a-colour predicate (issue #1955, CR 105.2 / 202.2): true iff the two
 *  referenced objects have at least one colour in common. Both sides are
 *  object selectors (an announced target slot, `$source`, a binding, a
 *  `forEach` `$each`), and both colours are read LIVE through the layer
 *  pipeline (`SpellContext.getColors`, layer 5 — a `colorOverride` from
 *  Painter's Servant or a colour-changing effect counts exactly as a printed
 *  colour does). Guard Dogs' "if it shares a color with that permanent":
 *  `{ sharesColor: { target: 0 }, with: { ref: "$each" } }`.
 *
 *  Reads `false` when either side is missing, has left the battlefield, or is
 *  not a permanent (CR 608.2b — the effect does as much as it can), and also
 *  when either side is COLOURLESS: a colourless object shares no colour with
 *  anything, including another colourless object (CR 202.2 — colourless is the
 *  absence of colour, not a sixth colour). */
export interface EffectSharesColorPredicate {
    sharesColor: EffectObjectSelector;
    with: EffectObjectSelector;
}

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

/** Picks-nonempty predicate (issue #1287): true iff the named `choice` Op's
 *  picks binding was captured AND is nonempty. `ref` is a bare picks ref
 *  (`EffectRef` — a `"$binding"` string, no property path), naming a `choice`
 *  Op's `bind` — the same picks-binding family `discard`/`sacrifice`'s bare
 *  `cards`/`permanents` refs already read. Reads `false` for an UNCAPTURED
 *  binding (the choice Op skipped — zero candidates existed, CR 608.2b) and
 *  for a CAPTURED-but-empty pick set (a `{ min: 0, ... }` "you may" choice the
 *  player declined) alike — both mean "nothing was picked". */
export interface EffectPicksNonEmptyPredicate {
    picksNonEmpty: EffectRef;
}

/** Target-is-another predicate (issue #1315, CR 702.165a): true iff the
 *  announced target slot named by `targetIsAnother` resolves to a permanent
 *  whose instance id differs from `ctx.sourceInstanceId`. Reads `false` when
 *  the slot is missing, resolves to a non-permanent, or IS the source (CR
 *  608.2b — a target that left the battlefield is neither "another creature"
 *  nor the source, so the grant half of a Backup-shaped ability correctly
 *  does not fire either way). Backup's "if that's another creature, it gains
 *  …" gate: `{ targetIsAnother: { target: 0 } }`. */
export interface EffectTargetIsAnotherPredicate {
    targetIsAnother: EffectTargetRef;
}

/** Picks-match-filter predicate (issue #1343): true iff `player`'s graveyard
 *  (CR 701.9 — the destination of every discard) currently contains at least
 *  one card whose instance id is in the named `choice` Op's picks binding AND
 *  matches `filter`. `picksMatchFilter` is a bare picks ref (`EffectRef` — the
 *  same picks-binding family `discard`/`sacrifice`/`picksNonEmpty` already
 *  read); `player` is normally `"controller"` (the discarding player — CR
 *  701.9's discard always lands in the discarder's OWN graveyard). Reads
 *  `false` for an uncaptured binding, a `player` ref that cannot be resolved,
 *  or a picked id no longer present in that graveyard (a redirect, or the
 *  binding never captured — CR 608.2b) — the effect does as much as it can
 *  rather than aborting. Meaningful only AFTER the picks' matching `discard`
 *  Op has run (connive, CR 701.50: "if you discarded a nonland card"). */
export interface EffectPicksMatchFilterPredicate {
    picksMatchFilter: EffectRef;
    player: EffectPlayerRef;
    filter: EffectCardFilter;
}

/** Bound-object-matches-filter predicate (Minsc & Boo): true iff the SNAPSHOT
 *  named by `boundMatchesFilter` — a bare ref to an earlier Op's `bind` —
 *  matches `filter` against its CR 608.2h last-known characteristics (types /
 *  subtypes / name / mana value, captured when the snapshot was taken).
 *
 *  This is the zone-free counterpart of `picksMatchFilter`, and the correct
 *  form whenever the question is "what WAS that object" rather than "what is
 *  in that graveyard now". `picksMatchFilter` answers by looking the picked
 *  card up in a graveyard, which is right for connive (CR 701.9 — a discard
 *  always lands there and stays) and WRONG for a sacrifice: a sacrificed
 *  TOKEN ceases to exist as a state-based action (CR 704.5d), so by the time
 *  a reflexive trigger resolves there is nothing in the graveyard to match —
 *  and the token is precisely what Minsc & Boo's "if the sacrificed creature
 *  was a Hamster" is built to sacrifice.
 *
 *  Reads `false` for an uncaptured binding (the Op that would have bound it
 *  was skipped, CR 608.2b) and for a snapshot predating the characteristics
 *  slots. Filter fields with no snapshot counterpart (`hasCounter`, `color`)
 *  never match — the snapshot does not carry them. */
export interface EffectBoundMatchesFilterPredicate {
    boundMatchesFilter: EffectRef;
    filter: EffectCardFilter;
}

/** Live-object-matches-filter predicate (issue #1747, Figure of Destiny): true
 *  iff the referenced permanent is on the battlefield RIGHT NOW and matches
 *  `filter`.
 *
 *  The third member of the matches-filter family, and the one to reach for
 *  whenever the question is "what IS that object" rather than "what WAS it"
 *  (`boundMatchesFilter`, a CR 608.2h snapshot) or "what is in that graveyard"
 *  (`picksMatchFilter`). Figure of Destiny's "If this creature is a Spirit, it
 *  becomes a Kithkin Spirit Warrior" is `{ objectMatchesFilter: "$source",
 *  filter: { subtype: "Spirit" } }` — the subtype under test was set by an
 *  EARLIER activation's resolution, so a printed-definition read would always
 *  say no and a snapshot was never taken.
 *
 *  Matched against the LIVE, layer-materialised characteristics (CR 613) via
 *  the same battlefield matcher every `choice`/`count`/`forEach` already uses,
 *  so a granted type/subtype/colour counts exactly like a printed one. Reads
 *  `false` when the object has left the battlefield or isn't a permanent
 *  (CR 608.2b). Filter fields the battlefield matcher has no counterpart for
 *  (`manaValueAtMost`, `hasCounter`, `excludeColor`) do not constrain — the
 *  same asymmetry every other battlefield-scoped filter site already carries.
 *  `manaCostEquals` (issue #1881) is a step further than a merely-unconstrained
 *  field, though: it's an EXACT structural match, so "no counterpart" means
 *  it would match every permanent rather than none — a genuine fail-open
 *  (issue #1898 finding 3). Unlike the three above, the validator (`gre/
 *  effects/validate.ts`) REJECTS `manaCostEquals` on this predicate's `filter`
 *  outright (`rejectManaCostEquals`) rather than accepting the silent gap. */
export interface EffectObjectMatchesFilterPredicate {
    objectMatchesFilter: EffectObjectSelector;
    filter: EffectCardFilter;
    /** CR 109.5 (issue #2388) — additionally require that the object be
     *  controlled by this player: "…is attached to a creature YOU CONTROL"
     *  (Springheart Nantuko's landfall trigger). Omitted, the predicate is
     *  controller-agnostic and any battlefield is scanned, which is what every
     *  pre-existing consumer means.
     *
     *  A field on THIS predicate rather than a `controller` member of
     *  {@link EffectCardFilter} (primitive-reuse rule, "generalize, don't
     *  add"): `EffectCardFilter` is read by a dozen zone-scoped sites where
     *  "you control" is either meaningless (a graveyard/hand/library card has
     *  no controller) or already implied by the site's own `player` field, and
     *  a field those readers ignore FAILS OPEN — it would validate and then
     *  silently not constrain. Here it is the one reader, and it fails closed:
     *  an unresolvable player ref makes the predicate `false` (CR 608.2b),
     *  never "no constraint". */
    controlledBy?: EffectPlayerRef;
}

/** Has-city's-blessing predicate (Ascend, CR 702.131b — issue #1460): true iff
 *  the resolved `hasCityBlessing` player holds the city's blessing designation
 *  (`GameState.cityBlessingIds`). `player` is normally `"controller"` — the
 *  resolving object's controller ("if you have the city's blessing", Ocelot
 *  Pride #1461). A pure player-state read (the monotonic designation set), no
 *  binding/target/zone dependency; reads `false` for an unresolvable player
 *  ref. The zone-free, retrospective-free analogue of the other player-scoped
 *  predicates. */
export interface EffectHasCityBlessingPredicate {
    hasCityBlessing: EffectPlayerRef;
}

/** Target-matches-graveyard-filter predicate (issue #2385, Tamiyo, Seasoned
 *  Scholar's -3: "Return target instant or sorcery card from your graveyard
 *  to your hand. If it's a green card, add one mana of any color"). True iff
 *  the resolved object selector names a card currently found in `player`'s
 *  graveyard AND that card matches `filter` — reusing the SAME
 *  `matchesCardFilter` reader `choice`/`count`/`picksMatchFilter` already
 *  share, so `color` (and every other `EffectCardFilter` field a graveyard
 *  snapshot carries) works here even though it does NOT work on
 *  `boundMatchesFilter`'s CR 608.2h snapshot (that shape has no `colors`
 *  slot) or on `objectMatchesFilter` (battlefield-only).
 *
 *  The `picksMatchFilter` sibling of this predicate answers "does a `choice`
 *  Op's PICK match" — this one answers "does an ANNOUNCED TARGET match",
 *  for exactly the shape `targetRequirement: { zone: "graveyard", ... }`
 *  produces (Tamiyo's -3, Jace Telepath Unbound's -3) but `picksMatchFilter`
 *  cannot reach (no `choice` Op is involved — the graveyard card was
 *  targeted at announcement, CR 601.2c, not picked during resolution).
 *
 *  Order-independent w.r.t. a subsequent `moveZone` of the SAME object: a
 *  card's colour does not change with its zone (CR 105/202.2), so evaluating
 *  this predicate BEFORE or AFTER a same-script `moveZone` reads identically
 *  — Tamiyo's own script checks it first (while the object is still
 *  findable in the graveyard) and moves it after, even though the printed
 *  Oracle sentence order is reversed; CR 608.2 places no ordering
 *  requirement on two clauses that don't depend on each other's outcome.
 *  Reads `false` for an unresolvable object/player ref or an object no
 *  longer in that graveyard (CR 608.2b — a response emptied it first). */
export interface EffectTargetMatchesGraveyardFilterPredicate {
    targetMatchesGraveyardFilter: EffectObjectSelector;
    player: EffectPlayerRef;
    filter: EffectCardFilter;
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
export type AlternativeCost = CostLegs & {
    /** Stable id referenced by `announceCast.alternativeCostId` to pick this
     *  variant. Unique within a card's `alternativeCosts`. */
    id: string;
    /** Player-facing label for the cast-option picker (e.g. "Return two
     *  Islands"). */
    description: string;
    /** Cast-availability CONDITION (CR 118.9 — "if it's not your turn", "if you
     *  control a Swamp"). The variant is only offered/legal when it holds; an
     *  absent condition means always available.
     *
     *  This is the one field that is NOT a cost leg and therefore does NOT live
     *  on {@link CostLegs}: an alternative cost REPLACES a mana cost (CR 118.9)
     *  and so is SELECTED among the card's cast options, while a may-pay ADDS
     *  to one (CR 601.2f) and is simply offered. Only the LEGS are shared; the
     *  selection-level helpers (`getAlternativeCost`, `affordableAlternativeCosts`,
     *  `canPayAlternativeCost`, `alternativeCostConditionMet`) stay
     *  alternative-cost-only (ADR 0079). */
    condition?: AlternativeCostCondition;
};

/** When an {@link AlternativeCost} variant is legal to choose (CR 118.9). */
export type AlternativeCostCondition =
    /** Only on the caster's own turn (Mine Collapse "If it's your turn"). */
    | { kind: "your-turn" }
    /** Only when it is NOT the caster's turn (Force of Vigor / Force of
     *  Negation "If it's not your turn"). */
    | { kind: "not-your-turn" }
    /** Only while the caster controls a permanent matching `filter`
     *  (Snuff Out "If you control a Swamp"). */
    | { kind: "control"; filter: PermanentFilter }
    /** Only as the caster's OWN first spell of the GAME (Once Upon a Time,
     *  issue #790: "If this spell is the first spell you've cast this game,
     *  you may cast it without paying its mana cost") — reads
     *  `PlayerState.spellsCastThisGame`, the lifetime sibling of
     *  `spellsCastThisTurn`. Checked pre-increment, like every other
     *  `AlternativeCostCondition`. */
    | { kind: "first-spell-this-game" };

/** CR 601.3a — a card-level SELF cast condition: "Cast this spell only if
 *  <board predicate>" (Blizzard, ICE — "Cast this spell only if you control a
 *  snow land"). Declared on the CARD ITSELF, unlike the `cast-restriction`
 *  statics another PERMANENT imposes on a class of spells (Brand of Ill Omen)
 *  which `castProhibitionReason` battlefield-scans, and unlike the narrow
 *  `castUniqueByName` flag (CR 601.3e) which hard-codes one predicate.
 *
 *  Data, not a closure, and evaluated by the frontend-safe
 *  `castConditionUnmetReason` (`convex/cards/castRestrictions.ts`) from INSIDE
 *  `castProhibitionReason` — the one shared gate. Consumers reach that gate
 *  through TWO chokepoints, not one, and a change here must keep both wired:
 *
 *   1. `getLegalActions` (`convex/gre/rules.ts`) — the ANNOUNCE path, covering
 *      the GRE, the `announceCast` mutation (via `assertLegalAction`), the wire
 *      `legalActions` array the client's Cast affordance reads, and the Bot's
 *      `enumerateCastMoves`.
 *   2. `castChosenSpell` / `castFaceDown` (`convex/gre/state.ts`) — the
 *      RESOLUTION-TIME cast primitives, for casts that never pass through
 *      `getLegalActions` at all: the `castDuringResolution` Op (Chandra, Torch
 *      of Defiance; Hideaway), Word of Command's controlled cast, and
 *      Illusionary Mask's face-down cast (CR 708.2 — evaluated there against
 *      the face-down characteristics).
 *
 *  Both chokepoints CALL `castProhibitionReason`; neither re-implements the
 *  condition, so there is still exactly one declaration and one evaluator.
 *
 *  `kind` is an EXPLICIT discriminator, never an implicit "whichever field is
 *  present" invariant: the evaluator switches on it and an unrecognised kind
 *  fails CLOSED (the spell stays uncastable) rather than silently dropping the
 *  Oracle clause — the failure mode this type exists to end. */
export type CastCondition = {
    /** Currently the only condition shape: "…only if you control <filter>".
     *  WIDEN the union with a new member as further predicates arise; never
     *  overload this one. */
    kind: "control";
    /** What the caster must control. Matched by `matchesPermanentFilter`
     *  against every permanent whose `controllerId` is the caster's, with LIVE
     *  supertypes injected (`liveSupertypesOf`, so Melting / Arcum's
     *  Weathervane mutations count) — `{ types: "Land", supertypes: "Snow" }`
     *  is "a snow land" (CR 205.4a).
     *
     *  Not every filter field is safe here: `toMatchablePermanent`
     *  (`./castRestrictions.ts`) cannot supply `enteredThisTurn` /
     *  `controlledSinceTurnStart`, and `matchesPermanentFilter`'s
     *  `filter.X !== (card.X === true)` comparison makes an absent datum fail
     *  CLOSED against `true` but fail OPEN against `false` (every permanent
     *  matches → the spell becomes freely castable). See the `toMatchablePermanent`
     *  docstring before reaching for either. */
    filter: PermanentFilter;
    /** Minimum number of matching permanents the caster must control. Default
     *  1 ("a snow land"). */
    minCount?: number;
    /** Player-facing reason surfaced when the condition is unmet — the Oracle
     *  clause verbatim. Returned by `castProhibitionReason`, so it lands in
     *  the same UI slot as a `cast-restriction`'s `oracleText`. */
    reason: string;
};

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
    /** CR 113.6c — a static ability that names the zone it does NOT function
     *  in functions in every OTHER zone: hand, library, graveyard, exile and
     *  the stack. "As long as this card isn't on the battlefield, it's a 1/1
     *  Insect creature in addition to its other types" (Grist, the Hunger
     *  Tide, `sets/mh2/multicolor.ts`) is the shape this field declares.
     *
     *  NOT a characteristic-defining ability: CR 604.3a(5) excludes an ability
     *  that sets characteristics "only if certain conditions are met", and the
     *  zone IS such a condition. The distinction is not academic — a real CDA
     *  applies on the battlefield too, this one is switched off there.
     *
     *  ADDITIVE for types and subtypes ("in addition to its other types",
     *  CR 205.1b), REPLACING for power/toughness — a planeswalker card has no
     *  printed P/T, so there is nothing to add to. Applied by the single
     *  shared reader in `gre/zoneCharacteristics.ts`; see that module's header
     *  for the consumer census it feeds. */
    offBattlefieldCharacteristics?: OffBattlefieldCharacteristics;
    /** CR 702.122b — "This creature crews Vehicles as though its power were N
     *  greater" (Shorikai's Pilot token, the Pilot/Vehicle cycle). A static
     *  characteristic of the CREW-ING creature, not of the Vehicle: it is added
     *  to this creature's effective power ONLY when it is tapped to pay a
     *  `tapOtherFilter.totalPower` (crew) cost, never anywhere else — the
     *  creature's real power, and every other rule that reads it, are
     *  untouched. Read by `crewPowerContribution` (`gre/tapOtherCost.ts`). */
    crewPowerBonus?: number;
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
    /** AI-only shadow Effect Script (PRD #1423, issue #1431) — a `resolve()`/
     *  `resolveSteps` card's effect SKETCHED as an `EffectOp[]` purely for
     *  valuation: the SAME `OP_VALUERS` walker that scores a real `effects[]`
     *  script (`convex/gre/ai/opValuers.ts`) walks this one too, yielding the
     *  identical `{ points, tags }` shape a real script would — but it is
     *  NEVER executed (`getAbilityEffectFn`/the interpreter never reads this
     *  field; only the context-free valuer does). Precedence (highest first,
     *  PRD #1423, issue #1512): the scalar `aiValue` override wins outright
     *  when set, then a real `effects[]` script, then this `aiEffects`
     *  sketch, then the `base + MV` fallback
     *  (`convex/gre/cardValue.ts` `latentValue`). Mutually exclusive in
     *  PRACTICE with `effects` (a card with a real script doesn't need a
     *  shadow one) though not enforced structurally — the catalogue guard
     *  (`convex/cards/__tests__/aiEffectsGuard.test.ts`) requires every
     *  `resolve()`/`resolveSteps` card with no `effects[]` to carry either
     *  this field or `aiValue`, so the bot's card-quality signal doesn't stay
     *  blind to the ever-growing `resolve()` residue during the
     *  resolve()→effects[] migration. Backfilling the CURRENT residue with
     *  real sketches is issue #1436 — this field only stops the population
     *  from GROWING. */
    aiEffects?: EffectOp[];
    /** Declarative marker: this spell's resolution destroys every land in play
     *  (CR 701.8, e.g. Armageddon's `ctx.destroyAll("Land")`). Purely a
     *  classification hint for effects that need to reason about a spell's
     *  outcome WITHOUT running its imperative `resolve()` — currently
     *  Equinox's "{T}: Counter target spell if it would destroy a land you
     *  control" (`spellWouldDestroyLandControlledBy`). It does NOT change how
     *  the spell resolves. Set it on any mass-land-destruction card whose
     *  effect lives in an opaque `resolve()`/`destroyAll` body. */
    destroysAllLands?: boolean;
    /** CR 113.6g — "This spell can't be countered." A spell so flagged is
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
    /** The "this permanent enters with N counters on it" REPLACEMENT effect
     *  (CR 121.6 + CR 614.1c) — the ONLY correct way to express that Oracle
     *  line. Sibling to `entersTapped` / `entersTappedUnless`: like them it
     *  modifies HOW the permanent enters, so it is applied AS the permanent
     *  enters — before the object is considered to have entered, before the
     *  first layer (CR 613) / SBA (CR 704) read, and before the trigger scan.
     *  Nothing goes on the stack, neither player receives priority with the
     *  permanent at zero counters, and the clause never renders as an ability.
     *
     *  NOT a `PERMANENT_ENTERED` triggered ability carrying a `counters` Op —
     *  that shape is a bug (issue #1693) and the catalogue-wide guard
     *  `convex/cards/__tests__/entersWithCounters.test.ts` fails CI on it. A
     *  genuinely triggered counter placement ("when this enters, put a counter
     *  on ANOTHER permanent") stays a trigger: it doesn't change how THIS
     *  permanent enters.
     *
     *  Each entry is a counter type and a count; entries of the same type SUM,
     *  which is how "if this creature was kicked, it enters with four +1/+1
     *  counters" is written as four `count: "kicker"` entries (Duskwalker,
     *  Llanowar Elite, Vodalian Serpent) rather than a bespoke multiplier.
     *  `count: "X"` reads the value chosen for X at cast time (CR 107.3), and
     *  `count: "kicker"` reads how many times the spell was kicked (CR 702.33e —
     *  "a charge counter for each time it was kicked", Everflowing Chalice);
     *  both are 0 for a permanent that was never cast (CR 107.3b).
     *  `count: "sunburst"` reads how many DISTINCT COLORS of mana were spent to
     *  cast the spell (CR 702.44a — colors, not pips: `{R}{R}` is one), off the
     *  `notedManaSpent` capture the cast-commit step records when the card also
     *  sets `noteManaSpent: true`. It is 0 on every non-cast entry path, which
     *  is what CR 702.44b requires ("only if the object … is entering the
     *  battlefield from the stack as a resolving spell"). The counter TYPE
     *  stays the card's own declaration — `charge` for a noncreature artifact
     *  (Pentad Prism), `+1/+1` for a card entering as a creature — because
     *  CR 702.44a picks between them by the object's printed type, ignoring
     *  type-changing effects.
     *
     *  Resolved by the frontend-safe oracle `resolveEntersWithCounters`
     *  (`convex/cards/entersWith.ts`) and applied by the GRE at EVERY
     *  permanent-entry site — a resolving permanent spell, reanimation /
     *  put-onto-the-battlefield / blink, token creation, a token COPY (the
     *  clause is a copiable value, CR 706.2), and every play-a-land path. The
     *  per-site census lives on that module's header comment. */
    entersWith?: {
        counters?: {
            type: string;
            count: number | "X" | "kicker" | "sunburst";
        }[];
        /** CR 614.1c / 614.12a (ADR 0100 D3) — the ordered "as this enters …"
         *  choices this permanent's controller answers BEFORE it enters, while
         *  it is held off every zone (`GameState.stagedEntries`). Sibling to
         *  `counters` because both are the same CR 614.1c self-replacement
         *  family, declared as data. Answered head-first; the list may GROW
         *  mid-flight when a `copy` answer reveals the copied definition's own
         *  `asEnters` (CR 707.6). No `CardDefinition` populates this in slice 1
         *  (#2492) — see {@link AsEntersChoice}. */
        asEnters?: AsEntersChoice[];
    };
    /** CR 714.2 — a Saga's chapter abilities, declared as data (ADR 0078).
     *  The `getDefinition` seam (`expandChapterAbilities`,
     *  `convex/cards/abilities/sagas.ts`) desugars each entry into a
     *  `counterAddedTrigger`-built `TriggeredAbility` tagged with its
     *  `chapterNumbers`, and injects the CR 714.3a `entersWith` lore counter.
     *  The card never hand-writes the "was less than N and became at least N"
     *  condition, and never declares a `finalChapter` — that is derived from
     *  the EFFECTIVE abilities (CR 714.2d, `convex/gre/sagas.ts`). */
    chapterAbilities?: ChapterAbilityDefinition[];
    staticAbilities?: string[];
    /** Continuous static effects (CR 611). Applied at stat-read time by the layer system. */
    staticEffects?: StaticEffect[];
    /** CR 601.2f self-host cost reduction (ADR 0063) — this spell's OWN
     *  intrinsic discount to its own cast cost (Emry, Lurker of the Loch).
     *  See `SelfCostReduction` for why this can't be a `staticEffects[]`
     *  cost-modifier like Stone Calendar's: the spell isn't a permanent yet
     *  when it's announced. Applied at the same 601.2f apply site
     *  (`getCostModifiers`, `gre/state.ts`) as the battlefield scan. */
    selfCostReduction?: SelfCostReduction;
    activatedAbilities?: ActivatedAbility[];
    /** This permanent's BACK face (CR 712 double-faced permanents, issue
     *  #1210/#924). A permanent showing its back face
     *  (`CardInstanceState.transformed`) reads its types/subtypes/power/
     *  toughness/staticAbilities/activatedAbilities from a `CardDefinition`
     *  synthesized from this spec (`gre/transform.ts`, mirroring how a
     *  token's OWN characteristics are synthesized by
     *  `registerTokenDefinition`); the "transform" Effect Op / keyword
     *  action (CR 701.27) is the only way to flip. Distinct from
     *  `faceDown`/`faceDownOf` (CR 707.4 morph — a hidden identity that
     *  turns up to its OWN characteristics): transform swaps between two
     *  DISTINCT, always-PUBLIC (CR 712.6) printed characteristic sets, so
     *  there is no per-viewer hiding at the projection boundary (unlike
     *  `faceDown`). Scoped to what CR 712 needs for a permanent ALREADY on
     *  the battlefield to transform in place (ADR 0067) — a full two-sided
     *  CASTING model (choosing a face to cast, a distinct mana cost per
     *  face, CR 711) is out of scope; only `TokenSpec.backFace`
     *  (double-faced tokens, e.g. the Incubator) is wired end-to-end today. */
    backFace?: CardBackFace;
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
    /** Additional costs to cast this spell (CR 118.8 / 601.2f). Paid at cast
     *  time, NOT at resolve. The chooser picks a permanent matching
     *  `sacrificeFilter` on their own battlefield; the cast is illegal if no
     *  matching permanent exists (CR 118.8). The picked permanent is
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
         *  X (CR 119.4 — you can't pay more life than you have). When set, the
         *  spell's `targetRequirement.count` may be `"X"` to take up to X
         *  targets, and the divided total equals the chosen X. Used by Fire
         *  Covenant. */
        payXLife?: boolean;
        /** CR 601.2b / 118.4 — "As an additional cost to cast this spell, pay N
         *  life" for a FIXED N (distinct from the caster-chosen `payXLife`).
         *  The engine pays exactly N life at cast commit; the cast is illegal if
         *  the player's life is below N (CR 119.4 — you can't pay more life than
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
         *  (casting it moves it from the graveyard to the stack before its
         *  costs are paid, CR 601.2a, so it is not there to be exiled for its
         *  own flashback cost). Used by Flash of
         *  Insight ("Flashback—{1}{U}, Exile X blue cards from your
         *  graveyard"). `color` filters the eligible cards (CR 105.2); omit for
         *  any card. */
        flashbackExileFromGraveyard?: { color?: Color };
        /** CR 601.2f / 701.9 — "As an additional cost to cast this spell,
         *  discard a card." The caster gives up `count` cards FROM HAND as the
         *  spell is cast; WHICH cards is their choice, routed through the SAME
         *  cast hand-cost picker every other hand leg uses
         *  (`PendingCast.alternativeCostHandChoice`, `CostLegs.hand` with
         *  `action: "discard"`) — parks when the choice is real,
         *  auto-resolves when forced. An omitted / empty `filter` constrains
         *  nothing (the untyped "discard a card" shape); the cast card itself
         *  is never eligible (CR 601.2a — it is on the stack, not in hand).
         *
         *  **AUTHORING CONSTRAINT** — the requirement inherits
         *  `CostLegs.hand`'s greedy, declaration-ordered matching: with several
         *  overlapping requirements the MOST RESTRICTIVE one must be declared
         *  first. A single requirement (every printed additional-cost discard
         *  today) is unaffected. Used by Bitter Triumph / Bone Shards, each
         *  behind an `oneOf` leg. */
        discard?: { filter?: EffectCardFilter; count: number };
        /** CR 601.2b — a CASTER-CHOSEN disjunction: "As an additional cost to
         *  cast this spell, discard a card OR pay 3 life" (Bitter Triumph).
         *  The caster names exactly ONE leg at announcement — before targets
         *  are chosen and before any mana is paid (CR 601.2b precedes
         *  601.2c/601.2f/601.2h) — via `announceCast`'s `additionalCostLegId`,
         *  the same plain-mutation-arg shape `chosenModeId` (CR 700.2) and
         *  `alternativeCostId` (CR 118.9) use, collected by a client-side
         *  picker. The chosen leg is then FLATTENED onto this spec
         *  (`resolveAdditionalCosts`, `convex/gre/additionalCost.ts`), so every
         *  downstream cost site reads one flat shape and no site needs an
         *  `oneOf` branch.
         *
         *  The cast is illegal when NO leg is payable (CR 601.2h — unpayable
         *  costs can't be paid); `hasPayableAdditionalCost` (`gre/rules.ts`)
         *  suppresses "cast" from `getLegalActions`, which gates the human
         *  mutation AND the Bot's enumerator alike. Legs whose own cost is
         *  unpayable are filtered out of the picker rather than rejected on
         *  click. Never combine `oneOf` with a same-named sibling field on the
         *  spec (a flattened leg overwrites it). */
        oneOf?: AdditionalCostLeg[];
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
    /** CR 702.109 — Dash. "Dash [cost]" represents TWO abilities (702.109a): a
     *  static ability that functions while the card is in a caster's hand
     *  ("you may cast this creature for its dash cost rather than paying its
     *  mana cost") and a triggered ability that functions on the battlefield
     *  ("when this creature enters, if its dash cost was paid, it gains haste
     *  and it's returned to its owner's hand at the beginning of the next end
     *  step"). This field carries only the FIRST half — reuses the
     *  {@link AlternativeCost} shape verbatim, the SAME cost-system infra as
     *  `alternativeCosts` / `evoke` (`convex/gre/alternativeCost.ts`'s
     *  `getAlternativeCost` / `affordableAlternativeCosts` resolve this field
     *  alongside them). Kept as its own dedicated field — like `evoke` — so a
     *  card's chosen alt cost is IDENTIFIABLE as "the dash one" at cast commit
     *  (compared by reference against this field), tagging the resulting stack
     *  item `dashed: true` (`convex/game.ts`), which rides onto the entering
     *  permanent for free (a stack item IS its `CardInstanceState`, the
     *  `escaped`/`evoked` precedent). Unlike `evoke`, Dash's alt cost carries a
     *  real MANA leg (`AlternativeCost.mana`, not a permanent/life/hand
     *  give-up) — CR 702.109a is a mana-for-mana swap, not a mana-for-something
     *  substitution. The SECOND half (haste + delayed return) is a real
     *  `TriggeredAbility` a card adds to its own `triggeredAbilities[]` via the
     *  `dashTrigger` template (`convex/cards/abilities/dash.ts`), gated on
     *  `CardInstanceState.dashed`. By convention this card's
     *  `AlternativeCost.id` is `"dash"`. */
    dash?: AlternativeCost;
    /** CR 702.103 — Bestow. "Bestow [cost]" means "As you cast this spell, you
     *  may choose to cast it bestowed. If you do, you pay [cost] rather than
     *  its mana cost" (702.103a), and a spell cast bestowed "becomes an Aura
     *  enchantment and gains enchant creature" as it is put onto the stack
     *  (702.103b). This field carries the COST half only — it reuses the
     *  {@link AlternativeCost} shape verbatim, because 702.103a says in so
     *  many words that "casting a spell using its bestow ability follows the
     *  rules for paying alternative costs", so the SAME cost-system infra as
     *  `alternativeCosts` / `evoke` / `dash` resolves it
     *  (`convex/gre/alternativeCost.ts`'s `getAlternativeCost` /
     *  `affordableAlternativeCosts`). Kept as its own dedicated field — like
     *  `evoke`/`dash` — so a card's chosen alt cost is IDENTIFIABLE as "the
     *  bestow one" at cast commit (compared by reference,
     *  `isBestowAlternativeCost`).
     *
     *  What makes Bestow different from every other keyword-cast mode this
     *  engine ships is the CHARACTERISTIC half, which lives in
     *  `convex/gre/bestow.ts`: `evoke`/`dash`/`flashback`/`madness`/`escape`
     *  are pure cost swaps, while a bestowed cast additionally swaps the
     *  spell's TYPE LINE (Enchantment — Aura, no P/T, CR 205.1a) and its
     *  TARGET REQUIREMENT (the gained "enchant creature", CR 303.4a — the
     *  same "a cast-time choice replaces `targetRequirement`" shape
     *  `kickedTargetRequirement` has). `CardInstanceState.bestowed` marks the
     *  object for the duration and rides onto the permanent the spell becomes
     *  (702.103b), where it makes CR 702.103f's documented exception to the
     *  CR 704.5m Aura SBA fire: the permanent becomes a creature again instead
     *  of being put into its owner's graveyard.
     *
     *  By convention this card's `AlternativeCost.id` is `"bestow"`. Used by
     *  Springheart Nantuko (MH3). */
    bestow?: AlternativeCost;
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
     *  the resolving permanent is flagged `escaped` (CR 702.138b). Used by Uro,
     *  Phlage, Nethergoyf. */
    escape?: EscapeCost;
    /** CR 702.35 — Madness. The alternative mana cost this card may be cast for
     *  out of exile in the window right after it is discarded (the engine
     *  `convex/gre/madness.ts` reads this). On discard the card is exiled
     *  instead of going to the graveyard (CR 702.35c) and its owner may cast it
     *  for this cost (CR 702.35a); an uncast copy is put into the graveyard at
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
    /** CR 702.27 — Buyback. An OPTIONAL additional cost the caster may choose
     *  to pay as they cast this spell ("You may pay an additional [cost] as
     *  you cast this spell. If you do, put this card into its owner's hand
     *  instead of into that player's graveyard as it resolves."). Paid ON TOP
     *  of the mana cost at cast time, mirroring {@link KickerCost} — but
     *  unlike Kicker (CR 702.33e Multikicker), Buyback has no repeatable
     *  variant: it is paid at most once per cast (singular "an additional
     *  [cost]"). Whether it was paid is snapshotted on the resulting stack
     *  item (`StackItem.buybackPaid`) at cast commit and read when the spell
     *  resolves: `finalizeSpellResolution` (`convex/gre/state.ts`) routes the
     *  card to its owner's hand instead of the graveyard when the flag is
     *  set. Buyback is a cost-system / keyword-cast capability (engine
     *  infra), NOT an Effect Script Op — the resolving effect itself stays
     *  DSL-first (`effects`). Used by Corpse Dance. */
    buyback?: ManaCost;
    /** CR 601.3c — the CONDITIONAL-FLASH SURCHARGE rider: "You may cast this
     *  spell as though it had flash if you pay {2} more to cast it." (the
     *  Invasion cycle — Rout, Breaking Wave, Twilight's Call, Ghitu Fire,
     *  Saproling Symbiosis; issue #2146). The declared cost is an ADDITIONAL
     *  mana cost (CR 601.2f) that ALSO carries a cast-timing permission.
     *
     *  It is a SIBLING field rather than an `additionalCosts` leg or an
     *  {@link AlternativeCost} because neither family models it: every
     *  `additionalCosts` leg is unconditional, and an `AlternativeCost`
     *  REPLACES the printed mana cost instead of adding to it. What makes this
     *  rider its own shape is that the payment is priced by WHEN the cast
     *  happens — inside the caster's own sorcery-speed window the spell costs
     *  exactly its printed cost and the surcharge is neither offered nor
     *  payable; outside that window it is MANDATORY.
     *
     *  Per CR 601.3c the caster may nonetheless BEGIN the cast: a card
     *  carrying this field is legal to ANNOUNCE at any time the caster has
     *  priority (`castTimingBaseLegal`, `convex/gre/rules.ts`, via
     *  `hasCardSelfFlashPermission`). Whether the surcharge is owed is decided
     *  ONCE, at announcement, by `flashSurchargeRequired` (same file) and
     *  locked in on `PendingTarget.flashSurchargePaid` — never re-derived at
     *  commit (CR 601.2f "locked in" + CR 601.6a "may continue to cast that
     *  spell as though it had flash even if those conditions stop being met").
     *
     *  Beaten by a sorcery-speed LOCK (Teferi, Time Raveler's static): CR
     *  101.2 — a restriction overrides a permission, so the surcharge cannot
     *  buy back a window the lock has closed.
     *
     *  Nothing downstream reads "was this spell surcharged": the payment buys
     *  timing only, so — unlike `buyback`/`kickerPayments` — it is deliberately
     *  NOT snapshotted onto the resulting `StackItem`. */
    flashSurcharge?: ManaCost;
    /** CR 601.3 / 702.8a — the UNCONDITIONAL card-level flash permission: "You
     *  may cast this spell as though it had flash." (Necromancy, issue #2392).
     *  CR 601.3: "A player can begin to cast a spell only if a rule or effect
     *  allows that player to cast it"; CR 702.8a: flash "means 'You may play
     *  this card any time you could cast an instant.'"
     *
     *  The SECOND clause of `hasCardSelfFlashPermission`
     *  (`cards/castRestrictions.ts`) and therefore the same third tier of
     *  `castTimingBaseLegal` (`gre/rules.ts`) the {@link flashSurcharge} rider
     *  uses — intrinsic keyword → player-scoped grant → card self-permission.
     *  It is deliberately NOT the plain `flash` keyword on
     *  `staticAbilities[]`: that would give the card a static ability it does
     *  not have (CR 604.1 — a static ability "does something all the time"),
     *  visible to every "has flash" read in the engine, and a card whose own
     *  text keys off "if you cast it any time a sorcery couldn't have been
     *  cast" asks about the TIMING USED, not about possessing the ability.
     *
     *  It costs nothing. `flashSurchargeRequired` (`gre/rules.ts`) keys on the
     *  DECLARED surcharge, not on the permission tier, so a card carrying this
     *  field and no `flashSurcharge` owes no extra mana — which is also why the
     *  Bot's `enumerateCastMoves` tap plan (`gre/moves.ts`) and the cast
     *  mutation cannot disagree about the price of the cast.
     *
     *  What the off-window cast DOES leave behind is the CR 307.1 / 117.1a
     *  snapshot `CardInstanceState.castOffSorceryTiming`, stamped at cast
     *  commit and inherited by the resulting permanent — the flag a card's own
     *  "if you cast it any time a sorcery couldn't have been cast" clause reads
     *  back as a CR 603.4 check-time condition. */
    castAsThoughFlash?: true;
    /** CR 702.33 — Kicker(s). OPTIONAL additional costs the caster may pay as
     *  they cast this spell, recorded PER KICKER ID on the resulting stack item
     *  (`StackItem.kickerPayments`) and read at resolution ({@link KickerCost},
     *  ADR 0079). The on-resolution effect stays DSL-first (`effects`); only the
     *  cast/cost permission lives in the engine.
     *
     *  An ARRAY, not a single cost, because "Kicker {A} and/or {B}" (the
     *  Planeshift Battlemage cycle) is two INDEPENDENTLY payable Kickers whose
     *  intervening-if triggers must be able to tell each other apart. One element
     *  is the ordinary case: Overload, Bloodchief's Thirst, Burst Lightning, Tear
     *  Asunder, Consult the Star Charts (single Kicker) and Everflowing Chalice
     *  (Multikicker). Ids must be unique within the card (guarded catalogue-wide
     *  by `convex/cards/__tests__/kickerDeclarations.test.ts`). */
    kickers?: KickerCost[];
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
    /** CR 601.2f (issue #1338) — "You can't spend mana to cast this spell"
     *  (Hogaak, Arisen Necropolis). When true, NO real mana source (pool,
     *  restricted mana, land/rock taps, Wild-Growth bonuses) may pay any pip of
     *  this cast: every pip — generic AND hybrid — must be covered by a
     *  non-mana `payWith` resource (Convoke creatures, Delve exiles). The
     *  castability probe (`coloredCostLeftover`, `gre/rules.ts`) excludes the
     *  real sources when this is set, and the payment path drives `manaCost` to
     *  zero via the payWith pickers so `solveSmartAutoTap` taps nothing. */
    cantSpendManaToCast?: boolean;
    /** CR 702.51 / 601.3e (issue #1338) — intrinsic, always-on permission to
     *  cast this card from its owner's OWN graveyard for its normal cost
     *  ("You may cast this card from your graveyard", Hogaak). Distinct from the
     *  external, turn-scoped Yawgmoth's Will / Lurrus permissions and from
     *  Flashback/Escape (which pay an ALTERNATIVE cost): the card resolves and
     *  lands in the graveyard normally, no exile-on-resolve. Non-land only. */
    castableFromOwnGraveyard?: boolean;
    /** CR 601.3a — "Cast this spell only if <board predicate>" (Blizzard, ICE).
     *  The card's OWN cast-legality gate, checked by the shared, frontend-safe
     *  `castProhibitionReason` (`convex/cards/castRestrictions.ts`) — so the
     *  Cast action is suppressed in `getLegalActions`, the wire `legalActions`
     *  the client's affordance reads, and the Bot's cast-move enumeration, AND
     *  the `announceCast` mutation rejects the cast, from this ONE declaration.
     *  Distinct from `castUniqueByName` (CR 601.3e, one hard-coded predicate)
     *  and from the `cast-restriction` statics OTHER permanents impose. */
    castCondition?: CastCondition;
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
    /** Continuous "plays with hand revealed" static (CR 702-adjacent — Zur's
     *  Weirding, Enduring Renewal; issue #735). While ANY permanent with this
     *  flag is on the battlefield, the affected player's hand is projected
     *  face-up to their opponents. Read live from the battlefield (like
     *  `extraLandDrops`) so the reveal ends the instant the source leaves play —
     *  no stale flag, no `GameState` field.
     *  - `"controller"` — reveal the controller's own hand (Enduring Renewal,
     *    "Play with your hand revealed").
     *  - `"all-players"` — reveal every player's hand (Zur's Weirding, "Players
     *    play with their hands revealed").
     *  - `"opponents"` (issue #1104) — reveal every OTHER player's hand to the
     *    controller (Seer's Vision, "Your opponents play with their hands
     *    revealed") — the mirror image of `"controller"`: the flipped-polarity
     *    case that generalizes this same field rather than adding a new one
     *    (ADR 0045 "generalize, don't add"). In a 2-player game this reveals
     *    exactly the one opponent's hand, functionally identical to CR's
     *    "opponents" (plural) scope. */
    revealsHand?: "controller" | "all-players" | "opponents";
    /** Continuous "plays with the top card of their library revealed" static
     *  (CR 401.5 — Goblin Spy, "Play with the top card of your library
     *  revealed"). While ANY permanent with this flag is on the battlefield,
     *  the affected player's TOP library card (index 0) — and only that card —
     *  is projected face-up to EVERY viewer, both seats alike.
     *
     *  The sibling of {@link revealsHand} for the other hidden zone (CR 400.2:
     *  a library stays a HIDDEN zone even when a card in it happens to be
     *  revealed — the reveal exposes one card's identity, it does not open the
     *  zone). Like `revealsHand` it is read LIVE off the battlefield on every
     *  projection, never stored: the reveal follows the top card through every
     *  draw / shuffle / put-on-top / mill with no re-stamping, and ends the
     *  instant the source leaves play. That is what CR 401.6 and CR 701.20d
     *  describe — a card that stops being revealed (shuffled away, drawn,
     *  buried) becomes a new object and the NEW top card is the revealed one —
     *  and it is why this is NOT modelled as a persistent
     *  `CardInstanceState.knownTo` stamp, which `clearKnowledge` wipes on
     *  every shuffle and which would have to be re-applied at each of the
     *  eleven library write sites.
     *
     *  CR 613.11: this is a continuous effect that modifies the RULES of the
     *  game (what players may see), not any object's characteristics, so it is
     *  deliberately not a `StaticEffect` / layer entry — layers 1–7 model
     *  characteristics only.
     *
     *  Scope enum mirrors `revealsHand`'s, but ships only the scope a printed
     *  card needs today; widen additively (`| "all-players" | "opponents"`)
     *  when a card requires it, exactly as `revealsHand` grew across #735 /
     *  #1104.
     *  - `"controller"` — reveal the controller's own library top (Goblin Spy,
     *    "Play with the top card of YOUR library revealed"). */
    revealsLibraryTop?: "controller";
    /** CR 401.5 — the PRIVATE half of the same rule: "You may look at the top
     *  card of your library any time" (Bolas's Citadel, Vizier of the
     *  Menagerie, Oracle of Mul Daya's second clause). Same continuous,
     *  position-attached, derived-never-stored model as
     *  {@link revealsLibraryTop} (`gre/libraryReveal.ts`) and the same CR
     *  613.11 rules-modifying-effect posture — it differs ONLY in WHO may see
     *  the card: the controller alone, never the opponent.
     *
     *  That difference is why it is a separate field rather than a widened
     *  `revealsLibraryTop` scope: `revealsLibraryTop`'s scope names WHOSE
     *  library is exposed and the exposure is symmetric (CR 401.5 "play with
     *  the top card of their library revealed" — both seats see it), so
     *  folding a viewer-scoped look into that enum would silently change what
     *  the opponent sees for every existing card. The projection ORs the two:
     *  a revealed top crosses the wire to everyone, a looked-at top only to
     *  its own controller (`gameProjections.ts`).
     *  - `"controller"` — only the library's owner may look. */
    looksAtLibraryTop?: "controller";
    /** Continuous draw-event replacement (CR 614, ADR 0061) that intercepts
     *  EVERY card draw an affected player would take, one card at a time, at
     *  the single suspend-capable draw seam (`planDrawStep` in `gre/state.ts`).
     *  Distinct from `drawStepReplacement` (a whole draw-STEP skip): this fires
     *  on effect-driven draws too. Read live from the battlefield (like
     *  `extraLandDrops`) so it ends the instant the source leaves play. Scope
     *  is the `applies(event, source, state)` predicate — no enum (ADR 0061).
     *  Supersedes the retired `drawRevealReplacement` field (#735): Enduring
     *  Renewal is `applies: e => e.drawingPlayer === source.controllerId` with
     *  a `reveal-type-to-graveyard` outcome; Zur's Weirding is `applies: () =>
     *  true` with a `reveal-others-may-pay-life` outcome. */
    drawReplacement?: DrawReplacementEffect;
    /** Restricts cast timing by whose turn it is (CR 117.1b). `"opponent"` —
     *  only during an opponent's turn (Siren's Call). `"self"` — only during the
     *  controller's own turn (Camouflage's "during your declare attackers
     *  step", combined with `castPhaseRestriction`). */
    castTurnRestriction?: "opponent" | "self";
    /** Extra land drops per turn granted to the controller while this permanent
     *  is on the battlefield (CR 305.2 — Fastbond). Added to LAND_DROPS_PER_TURN
     *  at land-play legality check time. Use 999 for unlimited. */
    extraLandDrops?: number;
    /** Unconditional, player-wide permission (CR 305.1 special action /
     *  601.3e-analog) to play lands from the controller's own graveyard, as
     *  though they were in hand, while ANY permanent with this flag is on the
     *  battlefield (Icetill Explorer, issue #1190). Read live from the
     *  battlefield (like `extraLandDrops`) via `canPlayLandsFromGraveyard`, so
     *  the permission ends the instant the granting source leaves play — no
     *  stale flag, no `GameState` field. Distinct from a SCOPED once-per-turn
     *  permission granted to a specific card (Serra Paragon, issue #1149),
     *  which is a per-instance `CardInstanceState` grant, not player-wide. */
    playsLandsFromGraveyard?: boolean;
    /** Unconditional, player-wide permission (CR 305.1 special action /
     *  601.3e-analog) to play lands from the TOP of the controller's own
     *  library — and only the top card (index 0) — as though they were in
     *  hand, while ANY permanent with this flag is on the battlefield
     *  (Courser of Kruphix, Oracle of Mul Daya, Augur of Autumn). The sibling
     *  of {@link playsLandsFromGraveyard} for the other permitted alternate
     *  land-play zone; read live off the battlefield the same way
     *  (`canPlayLandsFromTopOfLibrary`, `gre/rules.ts`), so the permission
     *  ends the instant the granting source leaves play — no stale flag, no
     *  `GameState` field.
     *
     *  DELIBERATELY ORTHOGONAL to {@link revealsLibraryTop}. CR does not tie
     *  the two: Courser of Kruphix prints both clauses and so declares both
     *  fields, but "you may play lands from the top of your library" is a
     *  legality permission and "play with the top card of your library
     *  revealed" is an information effect (CR 401.5). A card can print either
     *  alone (Vizier of the Menagerie plays creatures off the top WITHOUT
     *  revealing; Goblin Spy reveals WITHOUT any play permission), so folding
     *  them into one flag would be wrong in both directions. In particular the
     *  permission does NOT make the top card visible: a player granted only
     *  this may play a top land they cannot see, which is exactly what a
     *  hidden-information library (CR 400.2) requires — the top card's
     *  identity crosses the wire only when a reveal is separately in force. */
    playsLandsFromTopOfLibrary?: boolean;
    /** Unconditional, player-wide permission (CR 601.3e-analog) to CAST
     *  nonland spells from the TOP of the controller's own library — and only
     *  the top card (index 0) — while ANY permanent with this field is on the
     *  battlefield (Bolas's Citadel; Vizier of the Menagerie's creature-only
     *  variant would add a filter here). The SPELL twin of
     *  {@link playsLandsFromTopOfLibrary}: same live-off-the-battlefield
     *  derivation (`canCastSpellsFromTopOfLibrary`, `gre/rules.ts`), so the
     *  permission ends the instant the granting source leaves play — no stale
     *  flag, no `GameState` field — and the same position-strict rule, since
     *  the permission names the TOP card and the rest of the library stays
     *  hidden (CR 400.2).
     *
     *  DELIBERATELY ORTHOGONAL to {@link looksAtLibraryTop} /
     *  {@link revealsLibraryTop}, for the reason spelled out on
     *  `playsLandsFromTopOfLibrary`: permission is legality, reveal is
     *  information, and CR ties neither to the other. Bolas's Citadel prints
     *  all three clauses and so declares all three fields.
     *
     *  `manaCostReplacement` (CR 118.9-analog) replaces the ENTIRE mana cost
     *  of a cast made under THIS permission — never a cast of the same card
     *  from hand. It is a general cost-substitution vocabulary, not a
     *  card-shaped flag: see {@link ManaCostReplacement}. Omitted = the spell
     *  is cast for its normal printed mana cost (Vizier of the Menagerie's
     *  shape). */
    castsSpellsFromTopOfLibrary?: {
        manaCostReplacement?: ManaCostReplacement;
    };
    /** CR 702.139 (issue #1392, Lurrus of the Dream-Den) — "Once during each
     *  of your turns, you may cast a permanent spell with mana value N or
     *  less from your graveyard." A STATIC, battlefield-derived permission —
     *  mirrors `playsLandsFromGraveyard`'s shape (read live off the
     *  battlefield, so it ends the instant the granting source leaves play,
     *  no stale flag) — but scoped to PERMANENT cards only (never Land,
     *  never Instant/Sorcery — CR 110.1/300.1, `CASTABLE_PERMANENT_TYPES`),
     *  capped by `maxManaValue`, AND capped at one use per turn (tracked in
     *  `GameState.graveyardPermanentCastUsedThisTurn`, cleared at CLEANUP —
     *  `canCastPermanentFromGraveyardByPermission`, `gre/rules.ts`).
     *  Distinct from the turn-scoped Op-granted permission
     *  (`grantGraveyardPlay`/`graveyardPlayPermissionThisTurn`, Yawgmoth's
     *  Will — CR 305.1-analog/601, issue #1149), which has no once-per-turn
     *  cap, isn't source-bound, and covers ANY spell (not just permanents). */
    castsPermanentsFromGraveyard?: { maxManaValue: number };
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
    /** Which face of `imagePrintId`'s Scryfall print to render (issue #1595).
     *  Undefined (front, the default) for every ordinary def; set to
     *  `"back"` only by `registerBackFaceDefinition` (`gre/transform.ts`) on
     *  the synthesized `CardDefinition` it registers for a permanent's back
     *  face, so `resolveCardImageFace` (`src/lib/images.ts`) picks it up the
     *  moment a `transformPermanent` swap points `card.card.id` at it. See
     *  {@link CardImageFace}. */
    imagePrintFace?: CardImageFace;
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
