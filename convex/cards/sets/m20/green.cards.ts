// m20 — green cards (ADR 0043 colour split).
import {
    defineCard,
    EFFECT_AFFECTS_SELF,
    type PermanentView,
    type StaticEffectStateView,
} from "../../types";

// Elvish Reclaimer — {G} Creature — Elf Warrior, 1/2. "This creature gets +2/+2
// as long as there are three or more land cards in your graveyard.\n{2}, {T},
// Sacrifice a land: Search your library for a land card, put it onto the
// battlefield tapped, then shuffle." (CR 611.3a / 613.4c conditional +2/+2 on
// itself, a layer-7c `pt-buff` gated by a source-level `condition` over the
// controller's graveyard; CR 602.1 activated ability with a land sacrifice
// cost, `sacrificeFilter` — the Dwarven Armory shape; CR 701.23 search with
// `min: 0` = "fail to find" legal, CR 701.24 shuffle.)
// hand-tail: This creature gets +N/+N as long as there are three or more land cards in your graveyard (#7231)
export const elvishReclaimer = defineCard(() => ({
    id: "39c431d7-d94b-46c4-bb89-f3db56214ab4",
    name: "Elvish Reclaimer",
    rarity: "rare",
    oracleText:
        "This creature gets +2/+2 as long as there are three or more land cards in your graveyard.\n{2}, {T}, Sacrifice a land: Search your library for a land card, put it onto the battlefield tapped, then shuffle.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Warrior"],
    power: 1,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: EFFECT_AFFECTS_SELF,
            condition: (source: PermanentView, state: StaticEffectStateView) =>
                (
                    state.players.find((p) => p.id === source.controllerId)
                        ?.graveyard ?? []
                ).filter((card) => card.types.includes("Land")).length >= 3,
            power: 2,
            toughness: 2,
        },
    ],
    activatedAbilities: [
        {
            id: "elvish-reclaimer-fetch",
            oracleText:
                "{2}, {T}, Sacrifice a land: Search your library for a land card, put it onto the battlefield tapped, then shuffle.",
            cost: {
                mana: { X: 2 },
                tap: true,
                sacrificeFilter: { types: "Land" },
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
                    tapped: true,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
}));
