// Time Spiral (TSP) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as tsp from "./sets/tsp/index.cards"`
// resolves through tsp/index.cards.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n`.
import { defineCard } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Chromatic Star — {1} Artifact. A colour-fixing sac outlet that replaces itself
// on death (CR 605.1a mana ability with a {1} + tap + self-sacrifice cost; CR
// 603.6c leaves-the-battlefield-to-graveyard trigger draws). The death trigger
// fires whether the star is sacrificed for mana or dies any other way, since it
// keys off entering a graveyard from the battlefield.
export const chromaticStar = defineCard(() => ({
    id: "1d7a1357-debd-49b0-9fd5-560d5b3f589e",
    name: "Chromatic Star",
    rarity: "common",
    oracleText:
        "{1}, {T}, Sacrifice this artifact: Add one mana of any color.\nWhen this artifact is put into a graveyard from the battlefield, draw a card.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "chromatic-star-mana",
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    triggeredAbilities: [
        leftTrigger({
            id: "chromatic-star-death-draw",
            oracleText:
                "When this artifact is put into a graveyard from the battlefield, draw a card.",
            scope: "self",
            toZone: "graveyard",
            // Migrated resolve()→effects[] (ADR 0045, closes #1280): the
            // self-death draw rides `leftTrigger`'s `effects` site.
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
}));

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
