// ody — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Firebolt — {R} Sorcery. "Firebolt deals 2 damage to any target." with
// Flashback {4}{R} (CR 702.34 — cast from the graveyard for the flashback cost,
// then exile it). The effect is a plain DSL `dealDamage` to the announced "any
// target" (CR 115.4 — creature / planeswalker / battle / player). Flashback is
// the engine capability (convex/gre/flashback.ts); the `flashback` field
// carries the alternative cost so the bolt can be thrown twice, once from hand
// and once from the graveyard.
export const firebolt: CardDefinition = {
    id: "d5e45005-dd81-4d80-b043-02f719aca929",
    rarity: "common",
    name: "Firebolt",
    oracleText: "Firebolt deals 2 damage to any target.\nFlashback {4}{R}",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    flashback: { X: 4, R: 1 },
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
};
