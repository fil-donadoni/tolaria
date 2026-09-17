---
title: Titania's Song models an other-object P/T set as pt-cda, so it applies in sublayer 7a instead of 7b
discoveredBy: 3726
status: draft
confidence: medium
---

**What is wrong.** CR 604.3a lists five criteria for a static ability to be a
characteristic-defining ability, and criterion (3) is that it "does not directly
affect the characteristics of any other objects". Titania's Song's "power and
toughness each equal to its mana value" affects OTHER permanents — every
noncreature artifact on the battlefield — so it is not a CDA. Under CR 613.4b it
is an effect that "set[s] power and/or toughness to a specific number or value",
which is sublayer **7b**, not 7a.

**Evidence.** `convex/cards/sets/atq/green.ts` declares the clause as
`kind: "pt-cda"`. `LAYER_7_STATIC_EFFECT_KINDS` (`convex/gre/layers.ts:706`) maps
`pt-cda` to `"7a"` and `deriveLayer7` sets `characteristicDefining: sublayer ===
"7a"`, so the effect derives at 7a with the CDA flag. The reason is mechanical
rather than a rules judgement: `StaticPTSet` carries literal `power` / `toughness`
numbers and has no computed form, so `pt-cda` is the only layer-7 kind with a
`compute(source, state, ctx, target)` closure — the only one that can express
"equal to its mana value" at all.

**What it would change.** Two things, both observable. Ordering: 7a is applied
before 7b, so any effect that SETS the artifact's P/T (Humility, a base-P/T set)
currently loses to the Song where it should win. Dependency: CR 613.8a clause (c)
makes a dependency exist only when neither effect is from a CDA or both are, and
the flag is read straight off the entry by `gre/dependency.ts`, so the
misclassification also suppresses edges that should exist.

**Why it may not deserve its own issue.** The fix is not the card, it is the
missing primitive: a computed `pt-set`, or a `computeFor` field on `StaticPTSet`
of the shape `StaticSubtypeSet.subtypesFor` already has (ADR 0050's two forms).
That is a `cards/types.ts` + `gre/layers.ts` slice, and it should be scoped
against every `pt-cda` in the catalogue that affects other objects rather than
against this one card — a grep, not a ticket, until someone has counted them.

Untouched by issue #3726: `gre/lingeringStatics.ts` preserves whatever slot and
flag the live derivation gave the effect, so the snapshot is exactly as right or
wrong as the card is. Fixing the kind fixes both sides at once.
