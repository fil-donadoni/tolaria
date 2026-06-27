// TDM — blue cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../../../convex/cards/types";

// TODO(needs-triage): implement — needs a new engine capability.
// export const winternightStories: CardDefinition = {
//     id: "64d9367c-f50c-4568-aa63-6760c44ecaeb",
//     name: "Winternight Stories",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Sorcery"],
// };
