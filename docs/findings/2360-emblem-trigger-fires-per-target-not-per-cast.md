---
title: Dack Fayden's emblem puts N triggers on the stack for one cast, where CR 603.2c calls for one
discoveredBy: 2360
status: draft
confidence: medium
---

**What is wrong.** Dack Fayden's −6 emblem reads "Whenever you cast a spell that
targets one or more permanents, gain control of those permanents." CR 603.2c —
an ability triggers once per occurrence of its trigger event — makes one cast one
event, so paper Dack produces ONE trigger that gains control of every targeted
permanent. The shipped mapping rides `BECAME_TARGET`, which fires once PER
target, so a spell targeting N permanents puts **N emblem triggers** on the
stack, each stealing its own permanent.

This is a deliberate, reasoned divergence — but it is documented only in a doc
comment on the emblem definition, where no guard and no query can find it.
`divergenceMarkers.test.ts` scans `convex/cards/sets/**` and excludes
`__tests__`, so `convex/cards/emblems.ts` is outside its reach entirely: the
divergence carries no `tracked-by:` ref and nothing would red if it were silently
deleted or if a second emblem copied the shape.

**Observable consequences** (the end state is identical — all N permanents change
controller — so only the path differs):

1. **N stack objects instead of 1.** The stack renders N emblem triggers for one
   cast.
2. **An extra priority window** between each individual steal, where paper offers
   none.
3. **Per-target Stifle granularity.** Countering one emblem trigger saves exactly
   one permanent; against paper Dack, countering the single trigger saves all of
   them. This is the consequence with real gameplay weight.

**Evidence.** `convex/cards/emblems.ts:255-267` (the divergence paragraph inside
the `DACK_FAYDEN_EMBLEM_ID` doc comment) and `:284-309` (the
`event: "BECAME_TARGET"` triggered ability). The reason the obvious collapse is
unavailable: `oncePerEventBatch` (Leovold's shape) cannot be used because
`buildTriggerItem` carries a SINGULAR `triggerEvent`, so a collapsed trigger
would see only the FIRST event of the batch and steal exactly one permanent —
wrong in the other direction. The multi-target shape is asserted as-shipped in
`convex/cards/sets/cns/__tests__/multicolor.test.ts` (the CR 603.2c N-trigger
case), so the divergence is locked in by a passing test.

**Why it may not deserve its own issue.** Fixing it properly means teaching
`buildTriggerItem` to carry a batch of trigger events rather than one — an engine
change well beyond this card, and one no other shipped card needs today. The
narrower, cheaper outcome is a findability fix rather than a behaviour fix:
either extend `divergenceMarkers.test.ts`'s scan to `convex/cards/emblems.ts`
(and `convex/cards/sharedTokens.ts`, which has the same blind spot) so a
divergence there must carry a ref, or accept that emblem-level divergences live
in prose. Worth noting the guard gap is the general finding here; Dack is just
the instance that surfaced it.
