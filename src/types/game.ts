import type { Card, Color } from "./cards";
import type { Zone, CardAction } from "@convex/gre/types";

// Re-export from convex (single source of truth)
export type { Zone, CardAction };

export interface Player {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    deck: Deck;
    hand: CardInstance[];
    library: CardInstance[];
    graveyard: CardInstance[];
    exile: CardInstance[];
    battlefield: CardInstance[];
    manaPool: ManaPool;
}

// TODO: add support for specific-use mana
export type ManaPool = Record<Color, number>;

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
    card: Card;
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
    legalActions?: CardAction[];
}

export interface Combat {
    attackerIds: string[];
    confirmed: boolean;
    blockerAssignments: Record<string, string>;
    pendingBlockerId?: string;
    blockersConfirmed: boolean;
    blockerOrder?: Record<string, string[]>;
    blockerOrderConfirmed?: boolean;
    damageAssignments?: Record<string, Record<string, number>>;
    damageConfirmed?: boolean;
}

// Zone re-exported from @convex/gre/types above

export interface StackItem extends CardInstance {
    castById: string;
    targets?: { type: "creature" | "player"; id: string }[];
    /** If set, this stack item is an activated ability (not a spell). */
    abilityId?: string;
}

export interface PendingCast {
    playerId: string;
    cardInstanceId: string;
    manaCost: Record<string, number>;
    tappedLandIds: string[];
}

export interface PendingTarget {
    playerId: string;
    cardInstanceId: string;
    targetType: string | string[];
    count: number;
    selected: { type: "permanent" | "player"; id: string }[];
}

export interface GameOver {
    winnerId: string;
    loserId: string;
    reason: "life" | "decked";
}

// CardAction re-exported from @convex/gre/types above
