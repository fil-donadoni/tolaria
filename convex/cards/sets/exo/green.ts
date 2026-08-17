// EXO — green cards, split by colour per ADR 0043. The registry's
// `import * as exo from "./sets/exo"` resolves through exo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Survival of the Fittest — {1}{G} Enchantment. "{G}, Discard a creature
// card: Search your library for a creature card, reveal that card, put it
// into your hand, then shuffle." (CR 701.23 search / 400.7 zone change /
// 701.24 shuffle.) Unblocked by issue #901: `ActivatedAbility.cost` gained a
// `discardFilter` leg (mirrors `sacrificeFilter`'s player-choice discipline —
// the activator picks WHICH matching creature card in hand to discard via a
// dedicated picker, `selectActivationDiscardCost`; never auto-picked). The
// search/reveal/hand/shuffle tail is the same DSL composition Stoneforge
// Mystic's ETB uses (issue #677/#945): `choice`(kind: "search-library") +
// `reveal` + `moveZone`(library → hand) + `libraryLook`(shuffle).
export const survivalOfTheFittest: CardDefinition = {
    id: "c060c178-3c0e-493f-b6f0-ead5b1d6f191",
    name: "Survival of the Fittest",
    rarity: "rare",
    manaCost: { generic: 1, G: 1 },
    types: ["Enchantment"],
    oracleText:
        "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
    activatedAbilities: [
        {
            id: "survival-of-the-fittest-tutor",
            oracleText:
                "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
            cost: {
                mana: { G: 1 },
                discardFilter: { filter: { type: "Creature" }, count: 1 },
            },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a creature card.",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};
