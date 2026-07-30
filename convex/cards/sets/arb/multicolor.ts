// ARB (Alara Reborn) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as arb from "./sets/arb"` resolves through
// arb/index.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2).

import type { CardDefinition } from "../../types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

// Thopter Foundry — {W/B}{U} Artifact (Cube FREE residue token-maker, issue
// #1304, unblocked by issue #1926 / PRD #1736 hybrid mana wave). "{1},
// Sacrifice a nontoken artifact: Create a 1/1 blue Thopter artifact creature
// token with flying. You gain 1 life."
//
// Printed cost is {W/B}{U} — ONE guild-hybrid W/B pip plus a fixed {U},
// declared via `manaCost.hybrid` (issue #1338) and payable with mana off
// either colour of land (issues #1738/#1739, landed #1755) — see Figure of
// Destiny (eve/multicolor.ts) for the reference shape. This unblocks the
// stub previously tracked at #782 (closed).
//
// The ability itself is fully DSL-free — `createToken` (a vanilla flying
// Thopter, no ability of its own) + `gainLife`, gated by
// `cost.sacrificeFilter: { types: "Artifact", isToken: false }` (no
// self-exclusion needed: unlike Legion Extruder's "sacrifice ANOTHER
// artifact", "a nontoken artifact" legitimately allows the source to
// sacrifice ITSELF to pay its own cost, CR 602.1 — correct per the real
// card). Token art auto-resolves via `tokenPrintIdFor` — the
// (card id, "Thopter") pair is already present in
// `generated/token-prints.json` (reverse-linked from Thopter Foundry's own
// Scryfall `all_parts`).
const THOPTER_FOUNDRY_ID = "42b8d797-b01d-49cf-9818-d84bba17029d";

export const thopterFoundry: CardDefinition = {
    id: THOPTER_FOUNDRY_ID,
    name: "Thopter Foundry",
    rarity: "uncommon",
    oracleText:
        "{1}, Sacrifice a nontoken artifact: Create a 1/1 blue Thopter artifact creature token with flying. You gain 1 life.",
    manaCost: { hybrid: [["W", "B"]], U: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "thopter-foundry-make-thopter",
            oracleText:
                "{1}, Sacrifice a nontoken artifact: Create a 1/1 blue Thopter artifact creature token with flying. You gain 1 life.",
            cost: {
                mana: { generic: 1 },
                sacrificeFilter: { types: "Artifact", isToken: false },
            },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Thopter",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Thopter"],
                        power: 1,
                        toughness: 1,
                        colors: ["U"],
                        staticAbilities: ["flying"],
                        imagePrintId: tokenPrintIdFor(
                            THOPTER_FOUNDRY_ID,
                            "Thopter"
                        ),
                    },
                    controller: "controller",
                },
                { op: "gainLife", player: "controller", amount: 1 },
            ],
        },
    ],
};
