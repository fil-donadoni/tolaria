// jud — white cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Ray of Revelation — {1}{W} Instant. "Destroy target enchantment." with
// Flashback {G} (CR 702.34 — cast from the graveyard for the flashback cost,
// then exile it). The effect is a plain DSL `destroy` on the announced
// enchantment target. Flashback is the engine capability
// (convex/gre/flashback.ts); the `flashback` field carries the alternative
// (off-colour green) cost so the ray can be cast twice, once from hand and
// once from the graveyard. Mirrors ody/red.ts Firebolt's flashback shape.
export const rayOfRevelation: CardDefinition = {
    id: "6d762c8c-6172-4dc0-8fcc-d0f6dd8ca013",
    rarity: "common",
    name: "Ray of Revelation",
    oracleText: "Destroy target enchantment.\nFlashback {G}",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    flashback: { G: 1 },
    targetRequirement: { type: "Enchantment", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
};
