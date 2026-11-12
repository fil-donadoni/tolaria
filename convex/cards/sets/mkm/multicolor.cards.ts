// MKM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard, BASIC_LAND_SUBTYPES } from "../../types";

// No More Lies — {W}{U} Instant. "Counter target spell unless its controller
// pays {3}. If that spell is countered this way, exile it instead of putting
// it into its owner's graveyard." (CR 701.6a counter-unless-pay, CR 117.3a
// may-pay, and the new `destination` parameter on `SpellContext.counter` —
// issue #683's "exile it instead" redirect clause.) Same mayPay + if(not
// $paid) + counter shape as Force Spike (leg/blue.cards.ts), with a `destination`
// override on the consequence.
export const noMoreLies = defineCard(() => ({
    id: "1e0c695d-62f9-4805-9e2f-7032e8464136",
    rarity: "uncommon",
    name: "No More Lies",
    oracleText:
        "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.",
    manaCost: { W: 1, U: 1 },
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
            // CR 701.6a — counter unless the payment was made; redirect to
            // exile instead of the graveyard default.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [
                {
                    op: "counter",
                    target: { target: 0 },
                    destination: "exile",
                },
            ],
        },
    ],
}));

// Leyline of the Guildpact — {G/W}{G/U}{B/G}{R/G} Enchantment. "If this card is
// in your opening hand, you may begin the game with it on the battlefield.
// Each nonland permanent you control is all colors. Lands you control are every
// basic land type in addition to their other types."
//
// CR 103.6a — `openingHandAction: "begin-on-battlefield"`, taken in the
// pre-game window (`gre/mulligan.ts`). CR 105.3 / CR 613.1e — "is all colors"
// is a layer-5 `color-grant` of the five colours (the permanent's printed
// colours are a subset, so a grant and a set coincide); it applies to
// nonland permanents the source's controller controls, itself included.
// CR 205.1b / CR 305.7 — the land clause ADDS every basic land type, exactly
// Prismatic Omen's `subtype-add` (`sets/shm/green.cards.ts`); basic-land mana
// is derived from the live subtypes (CR 305.6).
// hand-tail: Each nonland permanent you control is all colors. (#9275)
export const leylineOfTheGuildpact = defineCard(() => ({
    id: "6b2e6a51-b9e6-4848-b7d7-98f02f2b897f",
    rarity: "rare",
    name: "Leyline of the Guildpact",
    oracleText:
        "If this card is in your opening hand, you may begin the game with it on the battlefield.\nEach nonland permanent you control is all colors.\nLands you control are every basic land type in addition to their other types.",
    manaCost: {
        hybrid: [
            ["G", "W"],
            ["G", "U"],
            ["B", "G"],
            ["R", "G"],
        ],
    },
    types: ["Enchantment"],
    openingHandAction: "begin-on-battlefield",
    staticEffects: [
        {
            kind: "color-grant",
            reads: [{ characteristic: "types", values: ["Land"] }],
            applies: (target, source) =>
                !target.types.includes("Land") &&
                target.controllerId === source.controllerId,
            colors: ["W", "U", "B", "R", "G"],
        },
        {
            kind: "subtype-add",
            reads: [{ characteristic: "types", values: ["Land"] }],
            applies: (target, source) =>
                target.types.includes("Land") &&
                target.controllerId === source.controllerId,
            subtypes: [...BASIC_LAND_SUBTYPES],
        },
    ],
}));
