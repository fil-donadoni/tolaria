---
title: A stale leaves-the-battlefield trigger returns a later object that shares its card's instance id
discoveredBy: 3997
status: draft
confidence: high
---

**What is wrong.** A persist or undying trigger on the stack finds its card by
instance id alone. If the card returned to the battlefield in response (a
reanimation spell) and went back to the graveyard without that return's own
trigger firing (it died with the counter), the older trigger still finds it and
returns it. Under CR 400.7 the card in the graveyard is a new object the older
trigger cannot find.

**Evidence.** `moveZone` of `$source` from the graveyard
(`convex/cards/abilities/keywordTriggers.ts`, `returnWithCounterTrigger`). A
throwaway test on an undying 1/1: destroy it, move the graveyard card back with a
+1/+1 counter, destroy it again (no new trigger), drain the stack: it is back on
the battlefield where it should stay in the graveyard. The instance id is stable
across zone changes, and nothing stamps a trigger with the object it looked back
at.

**Why it may not deserve its own issue.** It needs a reanimation effect at
instant speed with the trigger on the stack, and a second death in the same
window. It is also wider than these two keywords, since any `$source` return from
a graveyard reads the same way, so the fix belongs in `$source` resolution, not
in either keyword.
