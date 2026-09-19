---
title: Hand-written "gets +N/+N for each / as long as" bonuses sit in layer 7a
discoveredBy: 4126
status: draft
confidence: high
---

**What is wrong.** A `pt-cda` static is applied in layer 7a
(`convex/gre/layers.ts`, the `"pt-cda": "7a"` row). A printed "this creature
gets +N/+N …" is a MODIFIER — layer 7c (CR 613.4c) — so under any 7b
base-P/T set (Humility, Life and Limb) the bonus is overwritten when it must
survive. Issue #4126 moved the three fixed-magnitude cards (Kird Ape, Sedge
Troll, Mire Kavu) to a layer-7c `pt-buff` with a `condition`. Twelve remain,
with a DYNAMIC magnitude or a non-"you control" condition: Rabid Wombat,
Water Wurm, Nettlecyst, Lion Sash, Crusading Knight, Exotic Curse, Goham
Djinn, Kavu Scout, Marauding Knight, Strength of Unity, Tek, Wayfaring Giant.

**Evidence.** `convex/oracle/__tests__/controlsCondition.test.ts` ("the
hand-written conditional buffs apply in layer 7c, not 7a") goes red when the
old `pt-cda` Kird Ape is restored; the same probe applies to each card above.

**Why it may not deserve its own issue.** Only a 7b set effect exposes it,
and few are in the pool. The fix needs a layer-7c modifier whose amount is
computed (a `pt-buff` with an `EffectValue`-like amount, or a `pt-cda` kind
variant tagged 7c), which is an engine decision rather than a per-card edit.
