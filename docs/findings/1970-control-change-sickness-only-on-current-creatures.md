---
title: A control change marks summoning sickness only on a permanent that is a creature at that instant
discoveredBy: 1970
status: draft
confidence: medium
---

**What is wrong.** CR 302.6 is about control, not type: "A creature can't
attack unless it has been under its controller's control continuously since
their most recent turn began." The control-relocation hook sets
`isSummoningSick` only when the permanent is a creature at the moment control
changes, so a non-creature that becomes a creature later in the same turn can
attack for its new controller.

**Evidence.** `convex/gre/state.ts:111` —
`if (card.types.includes("Creature")) card.isSummoningSick = true;` inside
`setControlRelocation`. Shapes that reach it: an impending permanent (issue
#1970, Overlord of the Balemurk) stolen and then stripped of its last time
counter that turn; a Reconfigure Equipment stolen while attached, then
unattached; a manland or Vehicle stolen and then animated or crewed.

**Why it may not deserve its own issue.** It needs a steal plus a same-turn
type change, a rare line in this pool, and the fix may belong to the
control-continuity record (`recordControlChangeThisTurn`) the attack check
could read instead of the flag.
