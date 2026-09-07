// SHM — green cards, split by colour per ADR 0043. The registry's
// `import * as shm from "./sets/shm"` resolves through shm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #1307 residue re-audit, 2026-07-18 — originally issue #676,
// closed without landing Persist) — Persist, CR 702.79, is still `planned` in
// mechanicsRegistry.ts: no "return with a -1/-1 counter on death" primitive
// exists. The ETB destroy trigger alone would be DSL-clean, but Persist is
// half of the card's identity — shipping without it misrepresents the card.
// Stop-and-issue per gre-development.md; tracked stub. tracked-by: #1372
// (engine: implement Persist keyword, CR 702.79).
// export const woodfallPrimus: CardDefinition = {
//     id: "43aa7e35-55ee-4e02-a8aa-ea2b267055d1",
//     name: "Woodfall Primus",
//     rarity: "rare",
//     manaCost: { X: 5, G: 3 },
//     types: ["Creature"],
//     subtypes: ["Treefolk", "Shaman"],
//     power: 6,
//     toughness: 6,
// };

import type { CardDefinition } from "../../types";
import { BASIC_LAND_SUBTYPES } from "../../types";

// Prismatic Omen — {1}{G} Enchantment. "Lands you control are every basic land
// type in addition to their other types." CR 205.1b's "in addition to its
// other types" phrasing and CR 305.7's closing sentence ("If a land gains one
// or more land types in addition to its own, it keeps its land types and rules
// text") both say the same thing: this ADDS land types, it never replaces
// them. So it is Urborg's `subtype-add` kind (`sets/plc/colorless.ts`), never
// `subtype-set` — a Tropical Island under Prismatic Omen is Forest Island
// Plains Swamp Mountain and keeps its own abilities.
//
// All five basics at once, which is why every land you control taps for any
// colour with no `activatedAbilities` of its own: intrinsic basic-land mana is
// derived from the LIVE subtypes at read time (CR 305.6), and
// `getManaTapOptionsDetailed` offers one option per basic land type the
// permanent effectively has. "Lands you control" reads the live type line and
// the live controller, so a land that only becomes a land — or only becomes
// yours — later is picked up on the next layer recomputation.
//
// CR 613.8 dependency ordering is unimplemented (tracked-by: #2068): Blood
// Moon's "Nonbasic lands are Mountains" and this card each change what the
// other applies to (613.8a), so 613.8b should order them by dependency —
// Prismatic Omen applies first, then Blood Moon overwrites, leaving nonbasic
// lands as Mountains only. The engine applies both in CR 613.7 timestamp
// order, so the board depends on which was played first.
// compiler-gap: Lands you control are every basic land type in addition to their other types. (#2693)
export const prismaticOmen: CardDefinition = {
    id: "e75594cc-de47-49f2-9a8b-ba76c576368e",
    rarity: "rare",
    name: "Prismatic Omen",
    oracleText:
        "Lands you control are every basic land type in addition to their other types.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: (target, source) =>
                target.types.includes("Land") &&
                target.controllerId === source.controllerId,
            subtypes: [...BASIC_LAND_SUBTYPES],
        },
    ],
};
