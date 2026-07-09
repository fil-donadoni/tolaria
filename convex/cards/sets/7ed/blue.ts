// 7ED — blue cards, split by colour per ADR 0043. The registry's
// `import * as 7ed from "./sets/7ed"` resolves through 7ed/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardPrint } from "../../types";

// Counterspell — 7ED reprint of the LEA instant ("Counter target spell").
// CardPrint onto the LEA definition (ADR 0014).
export const counterspell7ed: CardPrint = {
    printId: "29bb1b85-9444-4bfa-b622-092a6873631c",
    definitionId: "0df55e3f-14de-46ef-b6b1-616618724d9e",
    setCode: "7ed",
    rarity: "common",
};
