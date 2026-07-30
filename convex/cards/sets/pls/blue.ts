// PLS (Planeshift) — blue cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Planar Overlay — {2}{U} Sorcery. "Each player chooses a land they control
// of each basic land type. Return those lands to their owners' hands." (CR
// 601.2b / 701.10, issue #1945, parent PRD #1935.) Symmetric —
// `forEach { set: "players" }` runs the clause once per side, in APNAP order
// (CR 101.4), each choosing among their OWN battlefield only (no player
// chooses for another). Per player, `chooseCategorized` offers the five
// basic land types as categories (`{ subtype: "Plains"|"Island"|"Swamp"|
// "Mountain"|"Forest" }`) over `zone: "battlefield"` (already public — no
// preceding `reveal`), `onPicked: "returnToHand"` bounces each nominated land
// via `SpellContext.returnToHand` (CR 701.10); no `sweep` — the Oracle text
// never mentions the unpicked lands, so they are left exactly where they
// are. A land with several basic land types may be chosen as EACH of those
// types with the same physical nomination — Gatherer: "If you have a land
// which counts as multiple land types, you can choose that land as each of
// those types. For example, a dual land could be chosen as two of your land
// types." So a player controlling a Plains and a Tundra may return the
// Tundra ALONE; the pick runs `categorizedPick.ts`'s COVER rule (every
// non-empty type answered, no gratuitous extra) with its floor at the
// smallest covering set, never the maximum matching, which would have forced
// two lands back. Categories are read through the layer pipeline via
// `getBattlefieldIds`; a type with no matching land is simply not filled (CR
// 608.2b). Mandatory ("chooses", not "may choose") — `optional` defaults to
// false.
export const planarOverlay: CardDefinition = {
    id: "1315fef0-234e-44f5-a7a3-bf3db78943c3", // PLS 28
    name: "Planar Overlay",
    rarity: "rare",
    oracleText:
        "Each player chooses a land they control of each basic land type. Return those lands to their owners' hands.",
    manaCost: { X: 2, U: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "chooseCategorized",
                    player: { ref: "$each" },
                    zone: "battlefield",
                    categories: [
                        { label: "Plains", filter: { subtype: "Plains" } },
                        { label: "Island", filter: { subtype: "Island" } },
                        { label: "Swamp", filter: { subtype: "Swamp" } },
                        { label: "Mountain", filter: { subtype: "Mountain" } },
                        { label: "Forest", filter: { subtype: "Forest" } },
                    ],
                    onPicked: "returnToHand",
                    prompt: "Choose a land of each basic land type to return to hand.",
                },
            ],
        },
    ],
};
