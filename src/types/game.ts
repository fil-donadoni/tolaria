import type { Card } from "./cards";

export interface Player {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    // deck: Deck;
    hand: CardInstance[];
    library: CardInstance[];
    graveyard: CardInstance[];
    exile: CardInstance[];
    stack: CardInstance[];
    battlefield: CardInstance[];
    // manaPool: ManaPool;
}

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
