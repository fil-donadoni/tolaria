// usg — blue cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Annul — {U} Instant. "Counter target artifact or enchantment spell."
// (CR 701.5a counter; CR 114.1 spell targeting.) A conditional Counterspell
// restricted to a subset of spell CARD TYPES. Expressed DSL-first (ADR 0045):
// the `counter` Op reused unchanged, and the artifact-OR-enchantment
// restriction rides the existing `spellTypeFilter` on a `type: "spell"`
// target — the same filter Fork uses for "instant or sorcery spell". An array
// filter matches a spell whose `types` include AT LEAST ONE of the listed
// types (OR semantics, CR 202.2 / 114.1), and abilities on the stack are never
// legal spell targets (CR 701.5a). No new Op or TargetRequirement type.
//
// First Premodern-legal printing in Tolaria's pool is Urza's Saga (usg); Annul
// was NOT printed in Nemesis despite the umbrella issue's file hint, so it
// lives here to keep the print id (`id`) consistent with its set.
export const annul: CardDefinition = {
    id: "3f8c73ff-be92-41ca-93a7-76f9823adb38",
    rarity: "common",
    name: "Annul",
    oracleText: "Counter target artifact or enchantment spell.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: ["Artifact", "Enchantment"],
    },
    effects: [{ op: "counter", target: { target: 0 } }],
};
