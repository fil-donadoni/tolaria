---
title: Nine shipped cards declare a non-CDA P/T effect as pt-cda, so it applies in sublayer 7a instead of 7b or 7c
discoveredBy: 3726
status: triaged
issue: 1992
confidence: high
---

**What is wrong.** CR 604.3a gives five criteria for a static ability to be a
characteristic-defining ability. Criterion (2) is that it "is printed on the
card it affects"; criterion (3) is that it "does not directly affect the
characteristics of any other objects". Nine shipped cards declare
`kind: "pt-cda"` for a P/T effect that meets neither, so every one of them
derives in sublayer **7a** (`LAYER_7_STATIC_EFFECT_KINDS`,
`convex/gre/layers.ts:706`) with `characteristicDefining: true`, when CR 613.4
puts it in 7b or 7c.

**Evidence.** 123 `pt-cda` declarations across `convex/cards/sets/**`; all but
these use `EFFECT_AFFECTS_SELF` and are genuine CDAs. The exceptions split by
what the oracle line actually does:

Should be **7c** (CR 613.4c — "effects and counters that modify power and/or
toughness"), because the line reads "gets +X/+X":

- `neo/white.ts:41` Lion Sash — "Equipped creature gets +1/+1 for each +1/+1 counter on this"
- `ice/colorless.ts:954` Infinite Hourglass — "All creatures get +1/+0 for each time counter on this artifact"
- `inv/white.ts:1416` Strength of Unity — "Enchanted creature gets +1/+1 for each basic land type among lands you control"
- `pls/white.ts:187` Heroic Defiance — "Enchanted creature gets +3/+3 unless ..."
- `mh2/colorless.ts:335` Nettlecyst — equipped creature gets +1/+1 for each artifact and enchantment you control
- `ice/green.ts:1372` Snowblind — "Enchanted creature gets -X/-Y"
- `inv/black.ts:1534` Exotic Curse — "Enchanted creature gets -1/-1 for each basic land type among lands you control"

Should be **7b** (CR 613.4b — "effects that set power and/or toughness to a
specific number or value"):

- `atq/green.ts:377` Titania's Song — "an artifact creature with power and toughness each equal to its mana value"
- `lea/blue.ts:82` Animate Artifact — "an artifact creature with power and toughness each equal to its mana value"

**What it changes, observably.** CR 613.4 applies the sublayers in order, so 7a
runs FIRST. Infinite Hourglass's "+1/+0 for each time counter" is therefore
applied before any base-P/T SET and is wiped by it: put Humility or Life and
Limb on the board and the time counters stop counting, where CR 613.4c says a
modify applied in 7c survives a 7b set. The same inversion hits every Aura and
Equipment in the 7c list. Second effect: CR 613.8a clause (c) makes a dependency
exist only when neither effect is from a characteristic-defining ability or both
are, and `gre/dependency.ts` reads the flag straight off the entry — so the
misclassification also suppresses dependency edges that should exist.

**Root cause is a missing primitive, not nine cards.** `StaticPTBuff` and
`StaticPTSet` both carry literal `power` / `toughness` numbers and neither has
a computed form, so `pt-cda` is the only layer-7 kind with a
`compute(source, state, ctx, target)` closure — the only one that can say "for
each basic land type" or "equal to its mana value" at all. The fix is a
`computeFor` field on each, the shape `StaticSubtypeSet.subtypesFor` already has
(ADR 0050's two forms), then re-pointing the nine declarations. It is one
`cards/types.ts` + `gre/layers.ts` slice.

**Where it is tracked.** Issue #1992 — filed long before this pass, from the
other end: it describes the same nine-card class as a sum-vs-overwrite
COLLISION between two `pt-cda` sources on one target, which is a symptom of the
misclassification above. Re-audited and corrected in a comment there rather
than re-filed: its body still cites `getCDAContribution`, which PRD #2064
S6b-part-2 deleted, and counts 39 declarations / 3 cards against the 123 / 9
measured here. The repro it gives (Nightmare + Heroic Defiance + 4 Swamps →
`0/0`, dead to the CR 704.5f SBA) still reproduces: the registry migration
replaced the machinery and preserved the bug, because `pt-cda` still maps to
sublayer 7a and 7a is still last-wins.

Untouched by issue #3726: `gre/lingeringStatics.ts` snapshots whatever slot and
flag the live derivation produced, so a lingering effect is exactly as right or
wrong as its card is. Fixing the kind fixes both sides at once.
