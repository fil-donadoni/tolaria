---
title: A card's keyword ORDER diverges from its compiled twin, and the comparator has no axis for it
discoveredBy: 3052
status: draft
confidence: medium
---

**What is wrong.** `staticAbilities[]` is a SET of keywords — no engine path
reads its order — but `behaviouralProjection`
(`convex/oracle/gold.ts`) compares it as a sequence, so a card whose
hand-written text lists its keywords in a different order from the corpus's
Oracle text reports as a behavioural divergence.

**Evidence.** Ancient Spider (`convex/cards/sets/pls/multicolor.ts:245`) writes
`staticAbilities: ["first strike", "reach"]` from its own text
`"First strike; reach (…)"`; the corpus prints
`"Reach (…)\nFirst strike"`, so the lockfile row is
`["reach", "first strike"]`. Nothing else about the two definitions differs.
It is the only such case across the 212 twins the catalogue merge checks
(`scripts/lib/catalogue-divergence-baseline.ts`), and it does not appear in
`KNOWN_DIVERGENCES` (`convex/oracle/__tests__/gold.test.ts`) because that
harness recompiles the card's OWN text, where the order is the card's.

**Why it may not deserve its own issue.** ADR 0114 §4 makes adding a
normalisation axis a deliberate decision, not a convenience: the comparator
must never fold a field the engine reads, and `staticAbilities` IS read (Guard
A, the layer system). The honest fix is narrow — sort the keyword ARRAY on both
sides, justified by the CR's treatment of keywords as an unordered set — but it
is one card today, and a one-card axis is exactly the kind of widening §4 warns
about. It sits in the merge baseline as `undetermined` until a second instance
argues for the axis.
