// SHM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as shm from "./sets/shm"` resolves through shm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Manamorphose — "Add two mana in any combination of colors. Draw a card."
// (issue #1306, parent PRD #620.) STOP-AND-ISSUE, ONE remaining gap:
//  1. Cost: {1}{R/G} is a single HYBRID pip. This is no longer a blocker —
//     `ManaCost.hybrid` (cards/types.ts) now declares guild-hybrid pips,
//     `normalizeManaCost` folds them into composite keys, and the
//     payment/coverage layer settles them off either colour of land (issues
//     #1738/#1739/#1755). If this card shipped, its cost would be
//     `{ generic: 1, hybrid: [["R", "G"]] }` — same shape as Deathrite Shaman
//     (`rtr/multicolor.ts`).
//  2. Effect: the draw half is trivial (`draw` Op), but "any combination of
//     colors" needs a runtime colour choice PER mana instance at
//     spell-resolution time. `EffectManaPool` (the `addMana` Op's mana spec)
//     is explicitly fixed-pip-only — no variable/"any colour" runtime
//     choice — and the established `manaChoices` idiom that already covers
//     "any colour" is ACTIVATION-time only (a mana ability's cost-time
//     choice), not applicable to an Instant's one-shot resolution. Same
//     underlying gap as Coalition Relic (`convex/cards/sets/fut/
//     colorless.ts`), tracked-by #1368.
// `manaCost` is omitted below since the effect (point 2) still has no
// faithful encoding — the cost gap alone (point 1) is closed. Left as a
// tracked stub pending that ONE remaining engine capability. tracked-by:
// #1368
// export const manamorphose: CardDefinition = {
//     id: "50283122-b8c4-4fb3-8eba-6252b72222f4",
//     name: "Manamorphose",
//     rarity: "uncommon",
//     types: ["Instant"],
// };

export {};
