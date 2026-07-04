// dft — multicolor cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// TODO(issue #676 stub — Exhaust, CR 702.177, is `planned` in
// mechanicsRegistry.ts, not implemented): Loot exhausts its three mana/draw/
// damage abilities ("activate each exhaust ability only once") — the engine
// has no exhaust-tracking primitive, so this can't be modelled faithfully
// yet. Stop-and-issue per gre-development.md DSL-first authoring; left as a
// tracked stub rather than a card-shaped `resolve()` workaround.
// export const lootThePathfinder: CardDefinition = {
//     id: "33c59c04-4c0b-4a60-826e-3a7757d0b2a2",
//     name: "Loot, the Pathfinder",
//     rarity: "mythic",
//     manaCost: { X: 2, U: 1, R: 1, G: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Beast", "Noble"],
//     power: 2,
//     toughness: 4,
// };

// Brightglass Gearhulk — {G}{G}{W}{W} Artifact Creature 4/4. "First strike,
// trample. When this creature enters, you may search your library for up to
// two artifact, creature, and/or enchantment cards with mana value 1 or
// less, reveal them, put them into your hand, then shuffle." (CR 701.19 /
// 400.7 / 701.20.) `filter.type` is an OR-array (Artifact/Creature/
// Enchantment, issue #677); `filter.manaValueAtMost: 1` is the fixed
// mana-value ceiling (issue #677); `count: { min: 0, max: 2 }` is "up to two"
// (issue #677) — the `moveZone` cards-shape moves every picked id (0, 1, or
// 2). The "reveal them" clause is dropped (CR 701.20 "Reveal" is a `planned`
// Op, no other game state reads it here).
export const brightglassGearhulk: CardDefinition = {
    id: "3dea5b45-925c-4732-8e9d-fa8232792736",
    name: "Brightglass Gearhulk",
    rarity: "mythic",
    manaCost: { W: 2, G: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 4,
    toughness: 4,
    staticAbilities: ["first strike", "trample"],
    oracleText:
        "First strike, trample\nWhen this creature enters, you may search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.",
    triggeredAbilities: [
        enteredTrigger({
            id: "brightglass-gearhulk-etb-search",
            oracleText:
                "When this creature enters, you may search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less, reveal them, put them into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        type: ["Artifact", "Creature", "Enchantment"],
                        manaValueAtMost: 1,
                    },
                    count: { min: 0, max: 2 },
                    prompt: "Search your library for up to two artifact, creature, and/or enchantment cards with mana value 1 or less.",
                    bind: "$picked",
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
        }),
    ],
};
