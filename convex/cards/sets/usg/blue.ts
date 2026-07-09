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

// Hibernation — {2}{U} Instant. "Return all green permanents to their owners'
// hands." (CR 400.7 zone change; CR 105 / 202.2 colour; CR 111.7 a bounced
// token ceases to exist, SBA-enforced.) A colour-filtered mass bounce — the
// Upheaval pattern (forEach over EVERY battlefield + `moveZone` to hand,
// ody/blue.ts) narrowed by a `filter: { color: "G" }` on the `forEach`
// selector. No `controller` scope — "all green permanents", every player's;
// no type restriction — any permanent type that is green. The colour predicate
// rides the existing `EffectCardFilter.color` field, matched against EFFECTIVE
// colours (`getBattlefieldIds` populates layer-5 colour via the shared
// static-effect derivation, CR 202.2), so a permanent made green by another
// effect is caught and a green card made colourless is spared. Reuse-only Ops
// (`forEach` + `moveZone`, both censused): the interpreter suite already
// exercises forEach-with-filter and the forEach+moveZone mass bounce; a
// dedicated colour-filtered-bounce assertion lives in the interpreter test.
//
// First printing is Urza's Saga (usg), 1998 — Hibernation was NOT printed in
// Nemesis despite the umbrella issue's nem/blue.ts file hint, so it lives here
// to keep the print id (`id`) consistent with its set (cf. Annul above).
export const hibernation: CardDefinition = {
    id: "68b7444c-fabb-4437-8db9-a1008ea09415", // USG 79
    rarity: "uncommon",
    name: "Hibernation",
    oracleText: "Return all green permanents to their owners' hands.",
    manaCost: { X: 2, U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { color: "G" },
            },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};
