// ROE — white cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Oust — {W} Sorcery. "Put target creature into its owner's library second
// from the top. Its controller gains 3 life." (Modern Scryfall oracle text,
// ADR 0004.) Authored DSL-first as an Effect Script (ADR 0045) out of two
// already-shipped Ops.
//
// The stub that used to sit here declared the positional library insert
// absent; that stopped being true when issue #1726 shipped `moveZone`'s
// battlefield→library `position` (1-based from the top, routed through
// `putIntoLibraryFromBattlefield` — the same leaves-the-battlefield funnel a
// bounce uses; a library shorter than the position puts the card on the
// bottom). Teferi, Hero of Dominaria's −3 is the shipped precedent at
// `position: 3` (`dom/multicolor.ts`); Oust is the same Op at `position: 2`.
//
// "Its controller" is the CREATURE's controller (CR 109.5), not Oust's, and
// it must be read as LAST KNOWN INFORMATION (CR 608.2h): by the time the life
// gain runs the creature is in a library and no longer has a controller, so
// `{ controllerOf: { target: 0 } }` would resolve to nothing. The snapshot
// idiom is what the DSL provides for exactly this — `bind` the object on the
// Op that removes it, then read `{ ref: "$c.controller" }` (Crumble,
// `atq/green.ts`, does the same across a `destroy`).
//
// Guard C (issue #2701): the Oracle compiler consumes neither half of this
// card's text yet — the positional library insert and the
// controller-of-the-target life gain are both unparsed today.
// compiler-gap: "Put target creature into its owner's library second from the top." (#2693)
// compiler-gap: "Its controller gains 3 life." (#2693)
export const oust: CardDefinition = {
    id: "07313dd3-d0dc-40ca-98a3-fa4d39e5bcae",
    name: "Oust",
    rarity: "uncommon",
    oracleText:
        "Put target creature into its owner's library second from the top. Its controller gains 3 life.",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "library",
            position: 2,
            bind: "$c",
        },
        {
            op: "gainLife",
            player: { ref: "$c.controller" },
            amount: 3,
        },
    ],
};
