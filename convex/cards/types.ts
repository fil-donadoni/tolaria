type CardId = string;

export type Color = "W" | "U" | "B" | "R" | "G" | "C";

export const colors: Color[] = ["W", "U", "B", "R", "G", "C"];

type ManaCost = {
    generic?: number;
    white?: number;
    blue?: number;
    black?: number;
    red?: number;
    green?: number;
    colorless?: number;
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

export type CardSupertype =
    | "Basic"
    | "Legendary"
    | "Ongoing"
    | "Snow"
    | "World";

export interface Card {
    id: CardId;
    name: string;
    manaCost: ManaCost;
    types: CardType[];
    subtypes: string[];
    supertype: CardSupertype;
    power: number;
    toughness: number;
    loyalty: number;
    staticAbilities: string[];
    activatedAbilities: string[];
    triggeredAbilities: string[];
    sbaMods: string[];
}
