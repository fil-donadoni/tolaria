// Deck-builder card index. The list is computed from the in-memory
// `CardDefinition` registry (`convex/cards/sets/*.ts`) on every query call —
// there is no backing table. Source of truth is the codebase: deploy a new
// card and it appears in the builder on the next query refresh.
//
// Convex client-side reactivity caches the query result until the function's
// inputs change, so the per-call iteration is paid once per cold cache, not
// once per filter keystroke.

import { query } from "./_generated/server";
import { getAllCards, getPrintingsForCard, type CardPrinting } from "./cards";
import { getCardColors } from "./cards/colors";
import { aggregateOracleText } from "./cards/oracleAggregator";
import { manaValue } from "./gre/constants";

export interface CardIndexRow {
    cardId: string;
    name: string;
    nameLower: string;
    types: string[];
    subtypes: string[];
    supertypes: string[];
    colors: string[];
    manaValue: number;
    oracleText: string;
    /** All printings (original first). `cardId === prints[0].printId`. Drives
     *  the set filter and the per-card edition picker. */
    prints: CardPrinting[];
}

export const list = query({
    args: {},
    handler: async (): Promise<CardIndexRow[]> => {
        return getAllCards().map((def) => ({
            cardId: def.id,
            name: def.name,
            nameLower: def.name.toLowerCase(),
            types: [...def.types] as string[],
            subtypes: [...(def.subtypes ?? [])],
            supertypes: [...(def.supertypes ?? [])] as string[],
            colors: getCardColors(def) as string[],
            manaValue: manaValue(def.manaCost),
            oracleText: aggregateOracleText(def).searchable,
            prints: getPrintingsForCard(def.id),
        }));
    },
});
