// NEM — green cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Blastoderm — "Shroud (This creature can't be the target of spells or
// abilities.) Fading 3 (This creature enters with three fade counters on it.
// At the beginning of your upkeep, remove a fade counter from it. If you can't,
// sacrifice it.)" (CR 702.18 Shroud; CR 702.32 Fading.)
//
// Fading is expanded implicitly at the getDefinition seam (ADR 0054): the
// `"fading 3"` string injects `entersWith` three fade counters plus the upkeep
// remove-or-sacrifice trigger — no per-card boilerplate. Shroud follows the
// established per-card pattern (Blurred Mongoose `inv/green.ts`): the
// `staticAbilities: ["shroud"]` string is decorative reminder data, and an
// unconditional self-scoped `permanent-guard` static effect enforces CR 702.18.
export const blastoderm: CardDefinition = {
    id: "9db5d6c2-b11f-442a-b172-c0c99c9bec07",
    rarity: "common",
    name: "Blastoderm",
    oracleText:
        "Shroud (This creature can't be the target of spells or abilities.)\nFading 3 (This creature enters with three fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 5,
    toughness: 5,
    staticAbilities: ["shroud", "fading 3"],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "blastoderm-shroud",
            cantBeTargeted: true,
            applies: (target, source) => target.id === source.id,
        },
    ],
};
