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
    stack: CardInstance[];
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
}

export type Zone =
    | "library"
    | "hand"
    | "battlefield"
    | "graveyard"
    | "exile"
    | "stack";

export type CardAction =
    | "discard"
    | "putToGraveyard"
    | "cast"
    | "play"
    | "putToExile"
    | "putToLibrary"
    | "putToHand";
