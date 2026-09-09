---
title: "A delayed or reflexive trigger's stack item carries no `triggerSourceId`, so nothing can name the permanent it came from"
discoveredBy: 2708
status: draft
confidence: medium
---

**What is wrong.** An ACTIVATED ability's stack item is a `structuredClone` of
its source, so its id IS the source permanent's id; a TRIGGERED ability's item
carries `triggerSourceId`. A DELAYED or reflexive trigger has neither:
`buildDelayedTriggerStackItem` (`convex/gre/triggers.ts:47`) allocates a fresh
instance id and sets `delayedTriggerId` only, and `pushReflexiveTrigger`
(`convex/gre/state.ts`) does the same. `state.ts:9704` already states the
consequence for its own walk ("a queued DELAYED trigger carries neither
`triggerSourceId` nor an `interveningIf` … there is nothing there to stamp
today").

So any rule of the form "do X to the permanent whose ability this is" is
structurally unable to see a delayed trigger's source. Issue #2708's
`counter.bindSource` (CR 113.7a) is the first consumer to hit it: Teferi's
Response's "if a permanent's ability is countered this way, destroy that
permanent" destroys nothing when the countered object is a delayed trigger
created by a permanent's ability, which CR 603.7e says has that permanent as
its source. The behaviour is fail-CLOSED (nothing is destroyed that should not
be), so it is narrower than the rules allow rather than wrong in the dangerous
direction.

**Evidence.** `convex/gre/triggers.ts:47-70` (no `triggerSourceId` in the built
item), `convex/gre/state.ts:9700-9710` (the walk that says so), and
`convex/gre/state.ts` `counter()` — the derivation deliberately omits
`delayedTriggerId` because reading `triggerSourceId` there would be dead code.

**Why it may not deserve its own issue.** No shipped card reaches it: it needs
a delayed trigger created by a permanent, countered by an effect that then acts
on that permanent, and Teferi's Response is the only such effect in the
catalogue. Stamping `triggerSourceId` at the delayed-trigger builder looks like
a two-line change, but the field is read by the LKI walk, the intervening-if
check and the trigger view reducer, so it is a change to what every one of
those sees — cheap only if someone has checked all three. A line on the
triggers tracker is probably the right size unless a second consumer appears.
