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
    /** Fixed generic mana that coexists with a VARIABLE `{X}` pip (CR 107.3 /
     *  202.3). The `X` field doubles as the generic-mana slot when it is a
     *  number, so a cost with BOTH a variable `{X}` and printed generic (Soul
     *  Burn `{X}{2}{B}`, Dominate `{X}{1}{U}{U}`) puts the variable marker in
     *  `X: "X"` and the fixed portion here. Mirrors `ManaCost.generic` in
     *  `convex/cards/types.ts` (the source of truth). */
    generic?: number;
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
