import type { Card, Color } from "./cards";

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
    isTapped: boolean;
    manaCommitted?: boolean;
    power?: number;
    toughness?: number;
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
    damageAssignments?: Record<string, Record<string, number>>;
    damageConfirmed?: boolean;
}

export type Zone =
    | "library"
    | "hand"
    | "battlefield"
    | "graveyard"
    | "exile"
    | "stack";

export interface StackItem extends CardInstance {
    castById: string;
    targets?: { type: "creature" | "player"; id: string }[];
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
    targetType: "creature" | "player" | "land" | "any";
    count: number;
    selected: { type: "creature" | "player"; id: string }[];
}

export type CardAction =
    | "discard"
    | "putToGraveyard"
    | "cast"
    | "play"
    | "putToExile"
    | "putToLibrary"
    | "putToHand";
