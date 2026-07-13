import type { Color } from "./cards";
import type { Zone, CardAction } from "@convex/gre/types";
import type {
    RestrictedMana,
    AttackManaTaxPayment,
} from "@convex/gre/state";
import type { SacrificeSelection } from "@convex/gre/sacrificeChoice";
import type { PublicGrantedAbility } from "@convex/gameProjections";

// Re-export from convex (single source of truth)
export type { Zone, CardAction };
export type GrantedAbility = PublicGrantedAbility;

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
    /** Id of the permanent this card is attached to (CR 303.4b). Only set
     *  on auras that ETB attached to a host. */
    attachedTo?: string;
    /** Activated abilities granted to this permanent by another card
     *  (CR 113.1, e.g. Zombie Master granting "{B}: Regenerate ~"). The
     *  template lives on the granting card's def — UI resolves via
     *  `getDefinition(grant.sourceCardId)`. */
    grantedActivatedAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId: string;
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
    /** ADR 0026 — derived eye-icon flag on the viewer's OWN hand cards: true
     *  when at least one opponent currently knows this card's identity. Only
     *  present on own-hand projected cards; raw `knownTo` never reaches the
     *  client. */
    seenByOpponent?: boolean;
    /** Two basic land types chosen as a permanent entered and stored for the
     *  rest of the game (CR 603.6b / 614.12 — Illusionary Terrain). Forwarded by
     *  `slimCard` (the projection only strips `card`/`knownTo`); read by the
     *  card preview to render the chosen-subtype text. Mirrors
     *  `CardInstanceState.chosenSubtypes` in `convex/gre/state.ts`. */
    chosenSubtypes?: string[];
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
}

export interface Combat {
    attackerIds: string[];
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
    targets?: {
        type: "permanent" | "player" | "spell" | "graveyard-card";
        id: string;
        playerId?: string;
    }[];
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
    /** If set, this stack item is a delayed triggered ability (CR 603.7a)
     *  queued by an earlier spell/ability's resolution (e.g. Mishra's
     *  Bauble's "draw a card at the beginning of the next turn's upkeep").
     *  Oracle text lives on `cardDef.delayedTriggers`, looked up by this id. */
    delayedTriggerId?: string;
}

export type {
    MulliganState,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingChoiceKind,
    PendingTarget,
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
