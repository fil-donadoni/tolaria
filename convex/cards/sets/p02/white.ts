// P02 — white cards, split by colour per ADR 0043. The registry's
// `import * as p02 from "./sets/p02"` resolves through p02/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Angel of Mercy — "Flying. When this creature enters, you gain 3 life."
//
// Home set = earliest paper printing (ADR 0041) = Portal Second Age; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/white.ts`.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
export const angelOfMercy: CardDefinition = {
    id: "dac5c913-4eb5-4cfb-9c24-223f14f07064", // P02 8
    rarity: "uncommon",
    name: "Angel of Mercy",
    oracleText: "Flying\nWhen this creature enters, you gain 3 life.",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        enteredTrigger({
            id: "angel-of-mercy-etb",
            oracleText: "When this creature enters, you gain 3 life.",
            scope: "self",
            effects: [{ op: "gainLife", player: "controller", amount: 3 }],
        }),
    ],
};
