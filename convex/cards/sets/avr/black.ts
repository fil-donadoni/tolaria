// AVR — black cards, split by colour per ADR 0043. The registry's
// `import * as avr from "./sets/avr"` resolves through avr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// TODO(needs-triage): implement — needs a new engine capability.
// export const griselbrand: CardDefinition = {
//     id: "b51666ae-2aef-4cb1-9cd4-44aec81530f8",
//     name: "Griselbrand",
//     rarity: "mythic",
//     manaCost: { X: 4, B: 4 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Demon"],
//     power: 7,
//     toughness: 7,
// };
