// SHM — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as shm from "./sets/shm"` resolves through shm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Manamorphose — "Add two mana in any combination of colors. Draw a card."
// (issue #1306, parent PRD #620.) STOP-AND-ISSUE, TWO independent gaps:
//  1. Cost: {1}{R/G} is a single HYBRID pip. `ManaCost` (cards/types.ts) has
//     no hybrid representation at all (no `hybrid`/alternate-pip field, only
//     fixed per-colour counts) — no faithful way to declare "castable for
//     either {1}{R} or {1}{G}" today. Tracked by #782 ([engine] Hybrid mana
//     cost encoding), the same gap blocking Deathrite Shaman (`rtr/
//     multicolor.ts`) and the ecl hybrid cards.
//  2. Effect: the draw half is trivial (`draw` Op), but "any combination of
//     colors" needs a runtime colour choice PER mana instance at
//     spell-resolution time. `EffectManaPool` (the `addMana` Op's mana spec)
//     is explicitly fixed-pip-only — no variable/"any colour" runtime
//     choice — and the established `manaChoices` idiom that already covers
//     "any colour" is ACTIVATION-time only (a mana ability's cost-time
//     choice), not applicable to an Instant's one-shot resolution. Same
//     underlying gap as Coalition Relic (`convex/cards/sets/fut/
//     colorless.ts`), tracked-by #1368.
// `manaCost` is omitted below (mirrors the Deathrite Shaman stub) since #782
// leaves no faithful encoding to write. Left as a tracked stub pending BOTH
// engine capabilities. tracked-by: #782, #1368
// export const manamorphose: CardDefinition = {
//     id: "50283122-b8c4-4fb3-8eba-6252b72222f4",
//     name: "Manamorphose",
//     rarity: "uncommon",
//     types: ["Instant"],
// };

export {};
