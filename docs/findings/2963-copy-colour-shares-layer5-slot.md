---
title: A copy effect's colour and a later layer-5 setColor share one colorOverride slot
discoveredBy: 2963
status: draft
confidence: medium
---

**What is wrong.** A copy effect's "except it's black" (CR 707.2, a layer-1
copiable value) is written to `CardInstanceState.colorOverride`. A noncopy
colour-setting effect (layer 5, CR 613.1e) writes the same field. When the copy
effect is re-applied or ends, `applyCopyEffect`'s `priorCopyOwnsColour` and
`rematerialiseTimedCopies`' `writesColour` (`convex/gre/copy.ts`) delete
`colorOverride` because the copy effect owns _a_ colour, even if a later layer-5
effect overwrote it. Scenario: a Clone of an Eternalize token is black. A later
"becomes red" effect makes it red. The Clone is then re-copied by Vesuvan, or a
timed copy over it expires, and the red is lost. Under CR 613.7 the later
layer-5 effect should survive.

**Evidence.** Before issue #2963 this applied only to the copy that named the
colour itself. Issue #2963 made the colour inheritable (`CopyExcept.colorOverride`),
so a copy of the copy now has the same exposure. The fix is to hold the layer-1
colour apart from the layer-5 override (for example, read it from `copyExcept`
in `getEffectiveColors` beneath `colorOverride`).

**Why it may not deserve its own issue.** It needs three things at once: a
copy-with-colour, a noncopy colour-setting effect, and then a re-copy or a timed
copy expiring. No preset or shipped deck is known to assemble that, and the
layer-5 colour ledger work may already plan to absorb it.
