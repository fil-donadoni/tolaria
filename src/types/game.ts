import type { Color } from "./cards";
import type { Zone, CardAction } from "@convex/gre/types";
import type { RestrictedMana, AttackManaTaxPayment } from "@convex/gre/state";
import type { TargetSelection } from "@convex/cards/types";

export type { AttackManaTaxPayment };
import type { SacrificeSelection } from "@convex/gre/sacrificeChoice";
import type {
    PublicGrantedAbility,
    SlimCompanionSlot,
} from "@convex/gameProjections";

// Re-export from convex (single source of truth)
export type { Zone, CardAction };
export type GrantedAbility = PublicGrantedAbility;
export type CompanionSlot = SlimCompanionSlot;

/** ADR 0026 / PRD #338 — one viewer-known library card and its top-relative
 *  position (0 = top). */
export interface KnownLibraryCard {
    index: number;
    card: CardInstance;
}

/** ADR 0026 / PRD #338 — sparse projected library: `count` is the full size,
 *  `known` carries only the cards the viewer legitimately knows, each at its
 *  top-relative `index`. The server always emits `known` (possibly empty); it
 *  is optional here so a `{ count }`-only fixture is still a valid library. */
export interface PublicLibrary {
    count: number;
    known?: KnownLibraryCard[];
}

export interface Player {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    /** Own hand has full cards; opponent's hand is a list of nulls when viewed via getPublicState. */
    hand: (CardInstance | null)[];
    /** Full array when the viewer has full-state access (full debug view).
     *  Via getPublicState it is the sparse ADR 0026 shape (`PublicLibrary`):
     *  `count` plus the cards the viewer knows (`known[]`) at their
     *  top-relative `index` (0 = top). */
    library: CardInstance[] | PublicLibrary;
    /** Set only on the searcher's own player while a `search-library` choice
     *  is active (CR 401.4 / 701.19) — slim card list rendered face-up so the
     *  player can pick one. Independent of `library` to keep the wire shape
     *  stable for all other consumers. */
    librarySearch?: CardInstance[];
    /** Set only on the chooser's own player while a library-peek choice is
     *  active (CR 401.4) — the looked-at top cards rendered face-up. Used by
     *  reorder-library and by Aladdin's Lamp's `draw-look-keep` (keep one). */
    libraryPeek?: CardInstance[];
    /** Set only on the hand owner's player while a `reveal-hand` look choice is
     *  active (CR 401.4 / 701.18a — Gitaxian Probe's private look) — the owner's
     *  hand rendered face-up to the single chooser. Independent of `hand` (which
     *  stays the sparse ADR 0026 shape) so the wire shape is stable for all other
     *  consumers; the `RevealHandView` pile reads it. */
    revealedHand?: CardInstance[];
    graveyard: CardInstance[];
    exile: CardInstance[];
    battlefield: CardInstance[];
    manaPool: ManaPool;
    /** Restricted mana floating in the pool (CR 106.6, ADR 0022 / 0042) —
     *  mana spendable only on costs its restriction permits (e.g.
     *  `"cumulative-upkeep"` mana from Adarkar Unicorn / Snowfall). Emptied with
     *  `manaPool` at end of step/phase. Absent means none. */
    restrictedMana?: RestrictedMana[];
    /** Number of turns this player has taken so far (CR 500.1). Extra turns
     *  (CR 500.7) increment this normally. */
    turnsTaken?: number;
    /** Instance id of the last card this player drew this turn (Jandor's
     *  Ring discard cost). Cleared at the start of each turn. */
    lastDrawnCardId?: string;
    /** Abilities granted to this player by an effect (e.g. Channel). */
    grantedAbilities?: GrantedAbility[];
    /** Poison counters on this player (CR 122). Absent means zero. A player
     *  with ten or more loses the game (CR 704.5c). Rides the public
     *  projection via the `...player` spread (ADR 0032). */
    poisonCounters?: number;
    /** Energy counters on this player (CR 122.1 — a player-owned resource).
     *  Absent means zero. Rides the public projection via the `...player`
     *  spread, like `poisonCounters` (issue #697). */
    energyCounters?: number;
    /** Companion (CR 702.139, ADR 0064) — revealed to BOTH players; only the
     *  slot's own controller's view carries `canSummon` (mirrors every other
     *  viewer-scoped affordance field, e.g. `CardInstance.legalActions`).
     *  Absent when this player declared no companion. */
    companion?: CompanionSlot;
}

/** Mana pool carried by the player. All six color slots may be missing from the server payload. */
export type ManaPool = Partial<Record<Color, number>> & Record<string, number>;

export const emptyManaPool: ManaPool = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
};

export interface Deck {
    id: string;
    name: string;
    cards: DeckCard[];
    format: string;
}

export type DeckCard = {
    cardId: string;
    cardName: string;
};

export interface CardInstance {
    id: string;
    /** Static definition reference. Resolve via getDefinition(card.id). */
    card: { id: string };
    controllerId: string;
    ownerId: string;
    zone: Zone;
    types?: string[];
    subtypes?: string[];
    isTapped: boolean;
    manaCommitted?: boolean;
    power?: number;
    toughness?: number;
    staticAbilities?: string[];
    isSummoningSick?: boolean;
    isAttacking?: boolean;
    isBlocking?: boolean;
    /** Set once this creature has been declared as an attacker this turn
     *  (CR 506.2). Persists through CLEANUP. Read by the UI to gate "target
     *  player who attacked this turn" clickability (Fire and Brimstone). */
    hasAttackedThisTurn?: boolean;
    /** Damage marked on this creature this turn (CR 120.3). Cleared at CLEANUP. */
    damageMarked?: number;
    /** CR 606.3 — set once a loyalty ability of this planeswalker has been
     *  activated this turn. Drives the frontend loyalty-ability affordability
     *  hint (`getStackAbilities` hides a second loyalty ability). Cleared at the
     *  start of each turn. */
    loyaltyActivatedThisTurn?: boolean;
    /** Id of the permanent this card is attached to (CR 303.4b). Only set
     *  on auras that ETB attached to a host. */
    attachedTo?: string;
    /** Activated abilities granted to this permanent by another card
     *  (CR 113.1, e.g. Zombie Master granting "{B}: Regenerate ~", or Touch of
     *  Vitae's until-EOT "{0}: Untap this creature"). Exactly one keyed field is
     *  set: `auraId` for a continuous lord-style grant, `duration` for a
     *  one-shot until-end-of-turn grant. The template lives on the granting
     *  card's def — UI resolves via `getDefinition(grant.sourceCardId)`. */
    grantedActivatedAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: unknown;
    }[];
    /** Static keywords granted to this permanent by another card (CR 113.1,
     *  611 — landwalk via a granting permanent, etc.). Each entry is also
     *  pushed into `staticAbilities` for read-time lookups, so this carries
     *  the GRANT PROVENANCE (which source / duration) rather than driving the
     *  keyword diff itself. Aligned with the wire projection, which forwards
     *  this field via `slimCard` (it only strips `card`/`knownTo`). */
    grantedStaticAbilities?: {
        ability: string;
        duration?: unknown;
        auraId?: string;
    }[];
    /** Triggered abilities granted to this permanent by an anthem-style static
     *  effect (CR 113.1, e.g. Energy Flux granting an upkeep sacrifice trigger
     *  to every artifact) or by a one-shot until-end-of-turn grant (CR 611.1b,
     *  Rapid Fire's "gains rampage 2 until end of turn"). The template lives on
     *  the granting card's `triggeredGrantTemplates` — UI resolves the oracle
     *  text via `getDefinition(grant.sourceCardId)`. Exactly one of `auraId`
     *  (continuous, aura-keyed) / `duration` (until-end-of-turn) is set. */
    grantedTriggeredAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: unknown;
    }[];
    /** Counters on this permanent (CR 122). Map of counter type → count.
     *  Layer 7d folds P/T-modifying types into effective stats; non-PT types
     *  (corpse, mire, vitality, ...) are inert to layers and read by
     *  card-specific abilities. */
    counters?: Record<string, number>;
    /** One-shot P/T modifications scoped to a phase boundary (CR 611.1).
     *  Each entry adds to effective P/T at read time. */
    temporaryPTMods?: ReadonlyArray<{ power: number; toughness: number }>;
    legalActions?: CardAction[];
    /** CR 702.34 / 702.138 / 305.1-analog / 117.6-analog / 702.139 — which
     *  graveyard-cast mechanism surfaced this card's cast affordance, so the
     *  graveyard button labels "Flashback" / "Escape" / "Cast". Present only
     *  on the viewer's own graveyard cards alongside `legalActions`.
     *  `"graveyard-grant"` (issue #1344) is a SPECIFIC-CARD grant (Malcolm,
     *  Alluring Scoundrel), distinct from the BROAD `"graveyard-permission"`
     *  (Yawgmoth's Will) — both currently render the same "Cast" label.
     *  `"graveyard-permanent-permission"` (issue #1392) is Lurrus's STATIC,
     *  once-per-turn, permanent-cards-only permission — also renders "Cast". */
    castKind?:
        | "flashback"
        | "escape"
        | "graveyard-permission"
        | "graveyard-grant"
        | "graveyard-permanent-permission";
    /** CR 702.34a / 118.5 / 107.3 — max {X} announceable on this flashback
     *  cast, bounded by its `flashbackExileFromGraveyard` cost (Flash of
     *  Insight). Present only on a `castKind: "flashback"` card carrying that
     *  cost; the cast cost dialog caps its X stepper at this value. Mirrors
     *  `SlimGraveyardCard.flashbackExileMaxX` in `convex/gameProjections.ts`. */
    flashbackExileMaxX?: number;
    /** ADR 0026 — derived eye-icon flag on the viewer's OWN hand cards: true
     *  when at least one opponent currently knows this card's identity. Only
     *  present on own-hand projected cards; raw `knownTo` never reaches the
     *  client. */
    seenByOpponent?: boolean;
    /** CR 107.4f — affordable Phyrexian mana-vs-life split choices (as distinct
     *  `lifePips` values, 0 = all mana … totalPips = all life) for a castable
     *  `{C/P}` card in the viewer's OWN hand. Present only when there are ≥ 2
     *  affordable options (a real choice); the client shows the split picker and
     *  sends the pick as `announceCast`'s `phyrexianLifePips`. Mirrors
     *  `SlimHandCard.phyrexianOptions` in `convex/gameProjections.ts`. */
    phyrexianOptions?: number[];
    /** Two basic land types chosen as a permanent entered and stored for the
     *  rest of the game (CR 603.6b / 614.12 — Illusionary Terrain). Forwarded by
     *  `slimCard` (the projection only strips `card`/`knownTo`); read by the
     *  card preview to render the chosen-subtype text. Mirrors
     *  `CardInstanceState.chosenSubtypes` in `convex/gre/state.ts`. */
    chosenSubtypes?: string[];
    /** CR 700.2c — the mode this PERMANENT locked in as it entered, and keeps
     *  for the rest of its time on the battlefield (Prismatic Ward / Chromatic
     *  Armor: "As this Aura enters, choose a color"). Forwarded by `slimCard`
     *  (the projection only strips `card`/`knownTo`); read by the card preview
     *  so the live oracle text names the colour actually chosen. Mirrors
     *  `CardInstanceState.chosenModeId` in `convex/gre/state.ts`. */
    chosenModeId?: string;
    /** Layer 5 color override (CR 305.7, 613.1d). Set by lace instants. */
    colorOverride?: string[];
    /** Copy effect anchor (CR 707.2). When set, this permanent is a copy and
     *  `card.id` carries the copied object's def id; `copiedFrom` holds the
     *  printed identity restored when the copy leaves the battlefield. */
    copiedFrom?: string;
    /** Noted mana banked on a mana-battery permanent (CR 106.10 — Jeweled
     *  Amulet, Ice Cauldron). Per-colour amounts the artifact will add when its
     *  "remove a charge counter" ability resolves. Forwarded by `slimCard` (the
     *  projection only strips `card`/`knownTo`), so the client can surface which
     *  color is banked. `castableCardId` is set for Ice Cauldron's
     *  instance-restricted note. */
    notedMana?: { mana: Record<string, number>; castableCardId?: string };
    /** Cast-from-exile permission (CR 601.3e — Ice Cauldron: "You may cast that
     *  card for as long as it remains exiled"). Set on a card in the exile zone
     *  to the id of the player who may cast it from exile as if it were in hand.
     *  Crosses the wire for the owning viewer (`slimCard` only strips
     *  `card`/`knownTo`), so the client can offer a cast affordance from Exile.
     *  The exiled card may be face-down to the opponent (impulse-style), but the
     *  controller — who is in `knownTo` — sees the real identity and this flag,
     *  and may cast it. */
    castableFromExileBy?: string;
    /** CR 305.9 (issue #1689) — rides alongside `castableFromExileBy`; true iff
     *  the granting effect's Oracle text explicitly says "play" (not merely
     *  "cast") that card (Headliner Scarlett, Expressive Iteration, Dauthi
     *  Voidwalker). ONLY then is a LAND sitting in exile under the grant a
     *  legal play — a cast-only grant (Ice Cauldron, Robber of the Rich,
     *  Ragavan) never sets this, so a land under it is unusable (no play, no
     *  cast). Meaningless for a non-land card. Crosses the wire via
     *  `slimCard` (only strips `card`/`knownTo`). Mirrors
     *  `CardInstanceState.castableFromExileIncludesLand` in
     *  `convex/gre/state.ts`. */
    castableFromExileIncludesLand?: boolean;
    /** Turn-scoped expiry marker for `castableFromExileBy` (CR 514.2 / 608.2g).
     *  Present on an impulse "play that card this turn" grant (Headliner
     *  Scarlett, Expressive Iteration); the grant is revoked at that turn's
     *  cleanup. Absent for open-ended grants (Ice Cauldron, Robber). Crosses the
     *  wire via `slimCard`; not read by the client (the projection drops
     *  `castableFromExileBy` once the grant expires), kept for type parity. */
    castableFromExileUntilTurn?: number;
    /** Instance id of the battlefield permanent this exiled card is associated
     *  with (the permanent that exiled / holds it). Mechanism-agnostic — set by
     *  the projection for exile-and-return bundles (Banishing Light / Tawnos's
     *  Coffin), noted-mana batteries (Ice Cauldron), and any future exiler — so
     *  the board can pin the exiled card to that permanent (Arena treatment).
     *  Present for all viewers when the host permanent is on a battlefield. */
    exiledByPermanentId?: string;
    /** Per-ability-id activation tally for this turn (CR 602.5 — `oncePerTurn`
     *  activated abilities like Gate to Phyrexia's "Activate only once each
     *  turn"). Mirrors `CardInstanceState.activationsThisTurn`
     *  (`convex/gre/state.ts`); forwarded by `slimCard` (the projection only
     *  strips `card`/`knownTo`), so the client can hide a used-up activation
     *  identically to the server's `assertActivationTimingLegal` (issue #1694). */
    activationsThisTurn?: Readonly<Record<string, number>>;
}

export interface Combat {
    attackerIds: string[];
    /** CR 508.1a — per-attacker attack target: attackerId → planeswalkerId.
     *  Absence = the attacker is attacking the defending player. An entry means
     *  the attacker is attacking that planeswalker (combat damage → loyalty,
     *  issue #1220). Mirrors the GRE `combat.attackTargets`. */
    attackTargets?: Record<string, string>;
    confirmed: boolean;
    blockerAssignments: Record<string, string[]>;
    pendingBlockerId?: string;
    /** Parked land-sacrifice attack tax awaiting the attacking player's choice
     *  (CR 508.1c/1g, 701.21a — Flooded Woodlands). */
    pendingAttackSacrifice?: SacrificeSelection;
    /** Parked mana attack tax awaiting the attacking player's payment
     *  (CR 508.1c/1g — Propaganda, Ghostly Prison, Collective Restraint). */
    pendingAttackManaTax?: AttackManaTaxPayment;
    blockersConfirmed: boolean;
    damageAssignments?: Record<string, Record<string, number>>;
    damageConfirmed?: boolean;
    /** Attacking bands declared this combat (CR 702.21e). */
    bands?: { bandId: string; memberIds: string[] }[];
    /** sourceId → playerId responsible for assigning that source's damage. */
    damageAssignerIds?: Record<string, string>;
    /** Players that have confirmed their portion of damage assignment. */
    damageAssignmentConfirmedBy?: string[];
}

// Zone re-exported from @convex/gre/types above

export interface StackItem extends CardInstance {
    castById: string;
    targets?: TargetSelection[];
    /** If set, this stack item is a copy of a spell (CR 707.10 — Fork,
     *  storm copies). A spell copy has no distinct printed identity, so the
     *  preview shows a `Copy` badge rather than a second (original) face.
     *  Survives the wire projection via `slimCard`; declared here so the
     *  client can read it. */
    isCopy?: boolean;
    /** If set, this stack item is an activated ability (not a spell). */
    abilityId?: string;
    /** If set, this stack item is a triggered ability (CR 603). */
    triggeredAbilityId?: string;
    /** Instance id of the permanent that produced this trigger — the id on the
     *  battlefield, NOT this synthetic stack item's id. Survives the wire
     *  projection via `slimCard`; declared here so target arrows can originate
     *  at the source permanent rather than the stack row
     *  (`target-arrow-geometry.ts`). Undefined for spells and for triggers with
     *  no permanent source. */
    triggerSourceId?: string;
    /** Storm (CR 702.40, ADR 0052) — present only on the synthesized storm
     *  cast-trigger stack item (`triggeredAbilityId === "storm"`): copies
     *  still to be created as this trigger resolves. Useful for a "N copies
     *  left" hint; the engine-internal `stormSnapshot` field is intentionally
     *  NOT sent over the wire (see `slimCard`, gameProjections.ts). */
    stormCopiesRemaining?: number;
    /** If set, this stack item is a delayed triggered ability (CR 603.7a)
     *  queued by an earlier spell/ability's resolution (e.g. Mishra's
     *  Bauble's "draw a card at the beginning of the next turn's upkeep").
     *  Oracle text lives on `cardDef.delayedTriggers`, looked up by this id. */
    delayedTriggerId?: string;
    /** ADR 0048 — oracle text of a fired INLINE delayed trigger (DSL
     *  `delayedTrigger` Op). Such a trigger has NO `cardDef.delayedTriggers[]`
     *  row (its id is the constant `INLINE_DELAYED_TRIGGER_ID`), so its text is
     *  carried on the stack item and survives the wire projection. The stack
     *  view reads it to render the ability tile instead of a full-card image
     *  (Sneak Attack, Forth Eorlingas). Undefined for the template path. */
    delayedOracleText?: string;
    /** CR 725 (issue #1305) — a source-less inherent DESIGNATION triggered
     *  ability (the Monarch's end-step draw). Keys a state designation
     *  (`convex/cards/designations.ts`) so the stack tile shows the marker-card
     *  art + name instead of the empty tile a card-less inline trigger would
     *  render. Undefined for every normal stack item. */
    designationId?: string;
    /** Per-source marker-art override (issue #1305) — themes the designation
     *  tile to the granting card's own printing (Forth Eorlingas → the LTR
     *  "The Monarch"). Undefined ⇒ the client uses the designation's global
     *  `imagePrintId`. Cosmetic. */
    designationImagePrintId?: string;
    /** CR 700.2c (issue #1274) — the mode a modal spell locked in at cast
     *  (`SpellMode.id`). Survives the wire projection via `slimCard`
     *  (`SlimStackItem` keeps every StackItem field but `card`); declared here
     *  so the stack view can highlight the chosen mode's oracle line for BOTH
     *  players. Undefined for non-modal spells and abilities. */
    chosenModeId?: string;
}

export type {
    GenericSpendAmbiguity,
    MulliganState,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingChoiceKind,
    PendingTarget,
    RevealNotification,
} from "@convex/gre/state";
export type { RestrictedMana };
export type {
    SacrificeSelection,
    SacrificeRequirement,
} from "@convex/gre/sacrificeChoice";

export interface GameOver {
    winnerId: string;
    loserId: string;
    /** "alternate-win" (issue #1066, CR 104.2a) — a spell/ability designates
     *  the winner directly (Coalition Victory). */
    reason: "life" | "decked" | "concede" | "draw" | "poison" | "alternate-win";
    /** True when the game ended in a draw (CR 104.4a — Divine Intervention). */
    isDraw?: boolean;
}

// CardAction re-exported from @convex/gre/types above
