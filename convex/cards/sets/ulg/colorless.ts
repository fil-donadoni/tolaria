// ulg (Urza's Legacy) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import type { CardDefinition } from "../../types";
import { makeTapForMana } from "../../abilities";

// Grim Monolith — "This artifact doesn't untap during your untap step.
// {T}: Add {C}{C}{C}. {4}: Untap this artifact." (CR 502.1 untap
// restriction, CR 605.1a/605.3a mana ability `useStack: false`.) Identical
// shape to LEA's Basalt Monolith (`convex/cards/sets/lea/colorless.ts`) — the
// `{4}: Untap this artifact` ability reuses the same `tapUntap` Op pattern.
// Vintage Cube free tranche (issue #675, ADR 0041).
export const grimMonolith: CardDefinition = {
    id: "9ddc9fe1-17c8-4e1d-aeb8-c4214e881280",
    rarity: "rare",
    name: "Grim Monolith",
    oracleText:
        "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticAbilities: ["does-not-untap"],
    activatedAbilities: [
        makeTapForMana({
            id: "grim-monolith-mana",
            oracleText: "{T}: Add {C}{C}{C}.",
            produces: { C: 3 },
        }),
        {
            id: "grim-monolith-untap",
            oracleText: "{4}: Untap this artifact.",
            cost: { mana: { X: 4 } },
            useStack: true,
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
    ],
};
