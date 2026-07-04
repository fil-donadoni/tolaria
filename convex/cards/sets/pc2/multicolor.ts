// PC2 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as pc2 from "./sets/pc2"` resolves through pc2/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Baleful Strix — {U}{B} Artifact Creature — Bird 1/1. "Flying, deathtouch.
// When this creature enters, draw a card." (CR 702.9 flying / 702.2
// deathtouch as static keyword strings; CR 603.6a self-ETB via
// `enteredTrigger` with an Effect Script body — the `draw` Op, ADR 0045.
// Part of the #674 card-draw/card-advantage FREE tranche.)
export const balefulStrix: CardDefinition = {
    id: "62090c97-7e3e-4854-bc44-c4a900133ec5",
    name: "Baleful Strix",
    rarity: "uncommon",
    oracleText: "Flying, deathtouch\nWhen this creature enters, draw a card.",
    manaCost: { U: 1, B: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying", "deathtouch"],
    triggeredAbilities: [
        enteredTrigger({
            id: "baleful-strix-etb-draw",
            oracleText: "When this creature enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
};
