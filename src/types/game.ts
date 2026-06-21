import type { Color } from "./cards";
import type { Zone, CardAction } from "@convex/gre/types";
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
    /** Number of turns this player has taken so far (CR 500.1). Extra turns
     *  (CR 500.7) increment this normally. */
    turnsTaken?: number;
    /** Instance id of the last card this player drew this turn (Jandor's
     *  Ring discard cost). Cleared at the start of each turn. */
    lastDrawnCardId?: string;
    /** Abilities granted to this player by an effect (e.g. Channel). */
    grantedAbilities?: GrantedAbility[];
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
    /** Static definition reference. Resolve via getCardById(card.id). */
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
     *  `getCardById(grant.sourceCardId)`. */
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
     *  to every artifact). The template lives on the granting card's
     *  `triggeredGrantTemplates` — UI resolves the oracle text via
     *  `getCardById(grant.sourceCardId)`. */
    grantedTriggeredAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId: string;
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
    /** Layer 5 color override (CR 305.7, 613.1d). Set by lace instants. */
    colorOverride?: string[];
    /** Copy effect anchor (CR 707.2). When set, this permanent is a copy and
     *  `card.id` carries the copied object's def id; `copiedFrom` holds the
     *  printed identity restored when the copy leaves the battlefield. */
    copiedFrom?: string;
}

export interface Combat {
    attackerIds: string[];
    confirmed: boolean;
    blockerAssignments: Record<string, string[]>;
    pendingBlockerId?: string;
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
    /** If set, this stack item is an activated ability (not a spell). */
    abilityId?: string;
    /** If set, this stack item is a triggered ability (CR 603). */
    triggeredAbilityId?: string;
}

export type {
    MulliganState,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingChoiceKind,
    PendingTarget,
} from "@convex/gre/state";

export interface GameOver {
    winnerId: string;
    loserId: string;
    reason: "life" | "decked" | "concede" | "draw";
    /** True when the game ended in a draw (CR 104.4a — Divine Intervention). */
    isDraw?: boolean;
}

// CardAction re-exported from @convex/gre/types above
