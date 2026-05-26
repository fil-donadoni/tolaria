import type { Color } from "./cards";
import type { Zone, CardAction } from "@convex/gre/types";
import type { PublicGrantedAbility } from "@convex/gameProjections";

// Re-export from convex (single source of truth)
export type { Zone, CardAction };
export type GrantedAbility = PublicGrantedAbility;

export interface Player {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    /** Own hand has full cards; opponent's hand is a list of nulls when viewed via getPublicState. */
    hand: (CardInstance | null)[];
    /** Full array when the viewer has full-state access, { count } when hidden (getPublicState). */
    library: CardInstance[] | { count: number };
    /** Set only on the searcher's own player while a `search-library` choice
     *  is active (CR 401.4 / 701.19) — slim card list rendered face-up so the
     *  player can pick one. Independent of `library` to keep the wire shape
     *  stable for all other consumers. */
    librarySearch?: CardInstance[];
    graveyard: CardInstance[];
    exile: CardInstance[];
    battlefield: CardInstance[];
    manaPool: ManaPool;
    /** Number of turns this player has taken so far (CR 500.1). Extra turns
     *  (CR 500.7) increment this normally. */
    turnsTaken?: number;
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
    /** Counters on this permanent (CR 122). Map of counter type → count.
     *  Layer 7d folds P/T-modifying types into effective stats; non-PT types
     *  (corpse, mire, vitality, ...) are inert to layers and read by
     *  card-specific abilities. */
    counters?: Record<string, number>;
    /** One-shot P/T modifications scoped to a phase boundary (CR 611.1).
     *  Each entry adds to effective P/T at read time. */
    temporaryPTMods?: ReadonlyArray<{ power: number; toughness: number }>;
    legalActions?: CardAction[];
}

export interface Combat {
    attackerIds: string[];
    confirmed: boolean;
    blockerAssignments: Record<string, string[]>;
    pendingBlockerId?: string;
    blockersConfirmed: boolean;
    damageAssignments?: Record<string, Record<string, number>>;
    damageConfirmed?: boolean;
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
    PendingTarget,
} from "@convex/gre/state";

export interface GameOver {
    winnerId: string;
    loserId: string;
    reason: "life" | "decked" | "concede";
}

// CardAction re-exported from @convex/gre/types above
