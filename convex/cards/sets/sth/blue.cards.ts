// sth — blue cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Mana Leak — "Counter target spell unless its controller pays {3}." (CR
// 701.6a counter-unless-pay, CR 118.12a may-pay). Same mayPay + if(not $paid)
// + counter shape as Force Spike (leg/blue.cards.ts), just a bigger tax (issue
// #683).
export const manaLeak = defineCard(() => ({
    id: "abcaf16d-aa02-43e2-aa38-bb1835d47a05",
    rarity: "common",
    name: "Mana Leak",
    oracleText: "Counter target spell unless its controller pays {3}.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 3 },
            prompt: "Pay {3} to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.6a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
}));

// Volrath's Shapeshifter — CR 612.6 full-text effect: while the top card of
// its controller's graveyard is a creature card, this creature has that
// card's full text (name, mana cost, colour, types, abilities, P/T) plus its
// own "{2}: Discard a card." Layer 3 (CR 613.1c), not copiable (CR 707.2);
// the engine side is `gre/fullText.ts` (issue #6741).
export const volrathsShapeshifter = defineCard(() => ({
    id: "ec89ee13-34ef-41c8-8fe4-0a6b21df2032",
    rarity: "rare",
    name: "Volrath's Shapeshifter",
    oracleText:
        'As long as the top card of your graveyard is a creature card, this creature has the full text of that card and has the text "{2}: Discard a card." (This creature has that card\'s name, mana cost, color, types, abilities, power, and toughness.)\n{2}: Discard a card.',
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Phyrexian", "Shapeshifter"],
    power: 0,
    toughness: 1,
    fullText: {
        from: "controller-graveyard-top",
        requiresType: "Creature",
        retainedActivatedAbilityIds: ["volrath-s-shapeshifter-ability"],
    },
    activatedAbilities: [
        {
            id: "volrath-s-shapeshifter-ability",
            oracleText: "{2}: Discard a card.",
            cost: { mana: { X: 2 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        },
    ],
}));
