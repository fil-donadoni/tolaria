// Time Spiral (TSP) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as tsp from "./sets/tsp/index.cards"`
// resolves through tsp/index.cards.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n`.
import { defineCard } from "../../types";

// Gemstone Caverns — Legendary Land. "If this card is in your opening hand and
// you're not the starting player, you may begin the game with Gemstone Caverns
// on the battlefield with a luck counter on it. If you do, exile a card from
// your hand.\n{T}: Add {C}. If Gemstone Caverns has a luck counter on it,
// instead add one mana of any color."
//
// CR 103.6a — `openingHandAction: "begin-on-battlefield"` taken in the pre-game
// window (`gre/mulligan.ts`); `openingHandBegin` declares the terms past the
// Leyline template: the card is offered only to a player who is not the
// starting player, enters with the luck counter (CR 122.6) and, once it has,
// its player exiles a card from their hand. CR 605.1a — the mana ability is a
// {T} ability whose `getManaChoices` reads the live luck counter: {C} alone
// without one, any of the five colours with it.
// hand-tail: If this card is in your opening hand and you're not the starting player, you may begin the game with {self} on the battlefield with a luck counter on it. If you do, exile a card from your hand. (#8620)
export const gemstoneCaverns = defineCard(() => ({
    id: "94d74254-4750-4fb3-9e53-473a5f98b315",
    name: "Gemstone Caverns",
    rarity: "rare",
    oracleText:
        "If this card is in your opening hand and you're not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.\n{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color.",
    types: ["Land"],
    supertypes: ["Legendary"],
    openingHandAction: "begin-on-battlefield",
    openingHandBegin: {
        notStartingPlayer: true,
        counters: { luck: 1 },
        exileFromHand: 1,
    },
    activatedAbilities: [
        {
            id: "gemstone-caverns-mana",
            oracleText:
                "{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaChoices: [{ C: 1 }],
            getManaChoices: (source) =>
                (source.counters?.luck ?? 0) > 0
                    ? [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }]
                    : [{ C: 1 }],
        },
    ],
}));

// Vesuva — Land (TSP). "You may have this land enter tapped as a copy of any
// land on the battlefield" is the declarative as-enters copy (CR 614.1c / 707.5)
// over the battlefield; `entersTappedAsCopy` taps it only when a land is
// chosen, so declining leaves the printed untapped Vesuva (CR 614.12). It has
// no abilities of its own.
// hand-tail: You may have this land enter tapped as a copy of any land on the battlefield. (#8644)
export const vesuva = defineCard(() => ({
    id: "82fc9498-7397-4857-87fe-7c9010944ed8",
    name: "Vesuva",
    rarity: "rare",
    oracleText:
        "You may have this land enter tapped as a copy of any land on the battlefield.",
    manaCost: {},
    types: ["Land"],
    entersWith: {
        asEnters: [
            {
                kind: "copy",
                filter: { types: "Land" },
                entersTappedAsCopy: true,
            },
        ],
    },
}));
