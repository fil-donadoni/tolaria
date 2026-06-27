// BLC — white cards, split by colour per ADR 0043. The registry's
// `import * as blc from "./sets/blc"` resolves through blc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// TODO(needs-triage): implement — needs a new engine capability.
// export const jackedRabbit: CardDefinition = {
//     id: "2c695df6-6bf2-4e6b-8500-e3116137ca27",
//     name: "Jacked Rabbit",
//     rarity: "rare",
//     manaCost: { X: "X", W: 1 },
//     types: ["Creature"],
//     subtypes: ["Rabbit", "Warrior"],
//     power: 1,
//     toughness: 2,
// };
