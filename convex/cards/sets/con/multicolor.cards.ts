// CON — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as con from "./sets/con/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard, EFFECT_AFFECTS_SELF } from "../../types";

// Knight of the Reliquary — {1}{G}{W} Creature — Human Knight, 2/2. "This
// creature gets +1/+1 for each land card in your graveyard.\n{T}, Sacrifice a
// Forest or Plains: Search your library for a land card, put it onto the
// battlefield, then shuffle." (CR 613.4c +N/+N on itself, a layer-7c `pt-buff`
// whose `computeFor` counts the controller's graveyard land cards at every
// read — not a characteristic-defining ability, the card keeps its printed
// 2/2 base; CR 602.1 activated ability with a Forest-or-Plains sacrifice cost,
// `sacrificeFilter.subtypes`; CR 701.23 search with `min: 0` = "fail to find"
// legal, CR 701.24 shuffle.)
// hand-tail: This creature gets +N/+N for each land card in your graveyard (#7238)
export const knightOfTheReliquary = defineCard(() => ({
    id: "ad8b8518-c09e-4cb7-95b2-08e4e370d89c",
    name: "Knight of the Reliquary",
    rarity: "rare",
    oracleText:
        "This creature gets +1/+1 for each land card in your graveyard.\n{T}, Sacrifice a Forest or Plains: Search your library for a land card, put it onto the battlefield, then shuffle.",
    manaCost: { X: 1, G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            computeFor: (source, state) => {
                const lands = (
                    state.players.find((p) => p.id === source.controllerId)
                        ?.graveyard ?? []
                ).filter((card) => card.types.includes("Land")).length;
                return { power: lands, toughness: lands };
            },
        },
    ],
    activatedAbilities: [
        {
            id: "knight-of-the-reliquary-fetch",
            oracleText:
                "{T}, Sacrifice a Forest or Plains: Search your library for a land card, put it onto the battlefield, then shuffle.",
            cost: {
                tap: true,
                sacrificeFilter: { subtypes: ["Forest", "Plains"] },
            },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a land card.",
                    bind: "$land",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$land" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
}));
