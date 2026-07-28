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
    /** CR 107.4f — Phyrexian mana pips ({C/P}); the count of `{<color>/P}`
     *  symbols per colour (Dismember `{1}{B/P}{B/P}` → `{ B: 2 }`). Each pip is
     *  paid with one mana of the colour OR 2 life. Mirrors `ManaCost.phyrexian`
     *  in `convex/cards/types.ts` (the source of truth); rendered by
     *  `manaCostToString` as `{<color>/P}` tokens. */
    phyrexian?: Partial<Record<Color, number>>;
    /** CR 202.1a / 107.4e — guild-hybrid mana pips (`{R/W}`, `{G/W}`); one
     *  entry per pip, listed as the two colours it may be paid with (order
     *  irrelevant). Each pip is paid with one mana of EITHER colour. Mirrors
     *  `ManaCost.hybrid` in `convex/cards/types.ts` (the source of truth);
     *  rendered by `manaCostToString` as `{R/W}` tokens. */
    hybrid?: Array<[Color, Color]>;
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
