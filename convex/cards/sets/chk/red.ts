// CHK (Champions of Kamigawa) — red cards, split by colour per ADR 0043.
// The registry's `import * as chk from "./sets/chk"` resolves through
// chk/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Lava Spike — "Lava Spike deals 3 damage to target player or planeswalker."
// (CR 120.1 damage.) First DSL-only card (ADR 0045, issue #800): the whole
// effect is a declarative Effect Script — a single `dealDamage` Op on the
// announced target — executed by the interpreter through the existing
// SpellContext primitives. No imperative `resolve()`.
export const lavaSpike: CardDefinition = {
    id: "60b2fae1-242b-45e0-a757-b1adc02c06f3",
    rarity: "common",
    name: "Lava Spike",
    oracleText: "Lava Spike deals 3 damage to target player or planeswalker.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    subtypes: ["Arcane"],
    targetRequirement: { type: ["player", "Planeswalker"], count: 1 },
    effects: [{ op: "dealDamage", amount: 3, to: { target: 0 } }],
};
