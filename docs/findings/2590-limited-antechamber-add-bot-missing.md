---
title: The antechamber's "add bot" action has no backing mutation — bots only auto-fill on Start
discoveredBy: 2590
status: draft
confidence: high
---

**What is wrong.** Issue #2590's prose lists "join / leave / add bot / start /
share" as the antechamber's action set. There is no `addBot`-shaped mutation
in `convex/limitedEvents.ts` — free seats are filled with Bot Drafter
placeholders only as a side effect of `startLimitedEvent`
(`convex/limited/eventStatus.ts`'s `seatingOpen` gate; see
`limited-event-detail.tsx:279-284`'s hint text: "The free seats will be
managed by bots, both for draft and for gameplay"). A creator who wants ONE
bot seated while still recruiting humans for the rest — the shape "add bot"
implies — cannot do that today; the only lever is Start, which fills every
still-open seat at once and ends seating.

**Evidence.** `convex/limitedEvents.ts` exports `createLimitedEvent`,
`joinLimitedEvent`, `leaveLimitedEvent`, `cancelLimitedEvent`,
`startLimitedEvent`, `submitPick`, `setPoolArrangementEntry`,
`selectDraftPick` — no bot-seat mutation among them.
`src/hooks/useLimitedEvent.ts`'s `useLimitedEventMutations()` mirrors that
list exactly (no `addBot`).

**Why it might not deserve its own issue.** No acceptance criterion in #2590
tests it, and the issue's own "Target files" list is `src/**` only — adding a
mutation is `convex/**` work, a different blast radius. It may also be a
non-goal by design: `startLimitedEvent`'s "fill everything and go" model is
simple and matches how every shipped event on this deployment has been
created so far. Worth a ticket only if a real workflow needs a mixed
human/bot table assembled incrementally, which nothing today demonstrates.
