type CardId = string;

export type Color = "W" | "U" | "B" | "R" | "G" | "C";

export const colors: Color[] = ["W", "U", "B", "R", "G", "C"];

export type ManaCost = {
    X?: number | string;
    W?: number;
    U?: number;
    B?: number;
    R?: number;
    G?: number;
    C?: number;
    /** How many times the chosen X is added to the generic cost for a variable
     *  `{X}` cost (CR 107.3). Defaults to 1; `2` for `{X}{X}` (Recall). */
    xFactor?: number;
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

/** Display-only card type for the frontend. */
export interface Card {
    id: CardId;
    name: string;
    manaCost?: ManaCost;
    types: CardType[];
    subtypes?: string[];
    supertypes?: CardSupertype[];
    power?: number;
    toughness?: number;
    loyalty?: number;
}
