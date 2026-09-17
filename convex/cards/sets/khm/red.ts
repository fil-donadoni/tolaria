// KHM — red cards, split by colour per ADR 0043. The registry's
// `import * as khm from "./sets/khm"` resolves through khm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { EFFECT_TREASURE_TOKEN } from "../../sharedTokens";

// Magda, Brazen Outlaw — three clauses, each on a shipped primitive:
// - CR 613.4c anthem: a `pt-buff` over other Dwarves you control (Kobold
//   Taskmaster shape); Magda herself is excluded.
// - CR 701.26a tap trigger: `tappedTrigger` scoped to your permanents with
//   subtype Dwarf, any cause of tapping (Magda included), making the shared
//   Treasure (CR 111.10a).
// - The tutor: `sacrificeFilterCount: 5` (PR #2575) — the activator picks
//   which five Treasures through the unified sacrificeChoice layer — then a
//   library search on the cross-dimension `EffectCardFilter.any` (issue #897).
//   CR 701.23b: finding nothing is legal, so the pick is `{ min: 0, max: 1 }`
//   and the shuffle happens regardless.
export const magdaBrazenOutlaw: CardDefinition = {
    id: "079e6263-e54c-4899-a336-5315909b9322",
    name: "Magda, Brazen Outlaw",
    rarity: "rare",
    oracleText:
        "Other Dwarves you control get +1/+0.\nWhenever a Dwarf you control becomes tapped, create a Treasure token.\nSacrifice five Treasures: Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Dwarf", "Berserker"],
    power: 2,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Dwarf"),
            power: 1,
            toughness: 0,
        },
    ],
    triggeredAbilities: [
        tappedTrigger({
            id: "magda-dwarf-tapped-treasure",
            oracleText:
                "Whenever a Dwarf you control becomes tapped, create a Treasure token.",
            scope: "yours",
            filter: { subtypes: "Dwarf" },
            effects: [
                {
                    op: "createToken",
                    token: EFFECT_TREASURE_TOKEN,
                    controller: "controller",
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "magda-treasure-tutor",
            oracleText:
                "Sacrifice five Treasures: Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.",
            cost: {
                // CR 118.3 / 701.21a — five Treasures the activator controls,
                // chosen by the activator; illegal with fewer than five.
                sacrificeFilter: { subtypes: "Treasure" },
                sacrificeFilterCount: 5,
            },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: {
                        any: [{ type: "Artifact" }, { subtype: "Dragon" }],
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an artifact or Dragon card.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};
