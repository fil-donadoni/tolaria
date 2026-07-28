// TMP — blue cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
//
// Reprint-only entries: each CardPrint declares the per-edition Scryfall UUID
// (printId) and resolves printId -> definitionId -> the shared CardDefinition
// (ADR 0014).

import type { CardDefinition, CardPrint } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";

// Time Warp — {3}{U}{U} Sorcery. "Target player takes an extra turn after
// this one." (CR 500.7, Vintage Cube FREE tranche, issue #686.) DSL-first
// (ADR 0045): the `extraTurn` Op (mechanicsRegistry.ts) is a thin declarative
// skin over `SpellContext.takeExtraTurn` — the SAME primitive Time Walk's
// pre-DSL `resolve()` closure already calls (lea/blue.ts) — added as part of
// this card (no new engine capability, only the Op wrapper the primitive-reuse
// mandate calls for). `targetRequirement` is a single player (CR 601.2c);
// the announced slot feeds the Op's `player: { target: 0 }`.
export const timeWarp: CardDefinition = {
    id: "3447aeaf-3b26-442a-99d4-0a7ee76c8e76", // TMP 97
    rarity: "rare",
    name: "Time Warp",
    oracleText: "Target player takes an extra turn after this one.",
    manaCost: { X: 3, U: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [{ op: "extraTurn", player: { target: 0 } }],
};

// Counterspell — Premodern-legal reprint (Tempest, #980). Resolves to the LEA
// CardDefinition; the printId is the TMP per-print Scryfall UUID.
export const counterspellTmp: CardPrint = {
    printId: "dacdd380-71cf-4832-bd02-3697501325f3",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e", // Counterspell
    setCode: "tmp",
    rarity: "common",
};

// Shimmering Wings — {U} Enchantment — Aura, enchant creature. "Enchanted
// creature has flying. {U}: Return this Aura to its owner's hand." (CR 702.9
// continuous keyword grant via `keyword-grant` + `AURA_AFFECTS_HOST`, and the
// shipped self-bounce activated-ability template — ice/black.ts Leshrac's
// Sigil: "{cost}: Return this enchantment to its owner's hand".)
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/blue.ts`.
export const shimmeringWings: CardDefinition = {
    id: "a6a8dc46-04c7-479a-90c1-b55e6c67e0e3", // TMP 87
    name: "Shimmering Wings",
    rarity: "common",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nEnchanted creature has flying. (It can't be blocked except by creatures with flying or reach.)\n{U}: Return this Aura to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "flying",
        },
    ],
    activatedAbilities: [
        {
            id: "shimmering-wings-return",
            oracleText: "{U}: Return this Aura to its owner's hand.",
            cost: { mana: { U: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};
