---
title: Duration-scoped subtype changes share one slot per permanent
discoveredBy: 3809
status: draft
confidence: medium
---

**What is wrong.** `CardInstanceState.temporarySubtypeChange` holds ONE timed
subtype set. A second `setSubtypesUntil` on the same permanent overwrites the
first, duration included: Orcish Farmer's land-type change on a land creature
followed by Unnatural Selection's creature-type change loses the Swamp, and a
longer-lived timed set followed by an end-of-turn one reverts to the printed
line at end of turn instead of to the longer effect (CR 611.2 / 613.7).

**Evidence.** `convex/gre/state.ts` `setSubtypesUntil` ("only one is held at a
time"); `convex/gre/layers2to5.ts` derives a single `ce-subtypeset-timed-<id>`
row. Before issue #3809 only land-type changes wrote there.

**Why it may not deserve its own issue.** It needs two timed subtype effects on
one permanent in one window — rare in the shipped pool. The fix is the
`subtypeAddHolds` shape (a list of rows, each with its own seq and duration).
