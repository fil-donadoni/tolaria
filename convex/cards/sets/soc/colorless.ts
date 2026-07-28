// Secrets of Strixhaven Commander (SOC) — colorless cards, split by colour
// per ADR 0043. The registry's `import * as soc from "./sets/soc"` resolves
// through soc/index.ts. Lands and colourless artifacts (no coloured cost)
// live here per the colour-split convention.
import type { CardPrint } from "../../types";

// Staff of the Storyteller was first implemented here, against the SOC
// reprint. Home set = earliest paper printing (ADR 0041) = ONC, so the
// definition moved to `onc/white.ts` (its cost is coloured) and SOC keeps only
// this reprint entry — which is what makes the SOC edition selectable in the
// deck builder without claiming to be the card's first printing.
export const staffOfTheStorytellerSoc: CardPrint = {
    printId: "67083aca-b077-4b12-8218-876e22476f85", // SOC 111
    definitionId: "ab1d1461-1625-4163-aacd-a939f4871fad", // ONC 10
    setCode: "soc",
    rarity: "rare",
};
