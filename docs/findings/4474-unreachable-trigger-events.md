---
title: Three trigger event types are fired by no catalogue card, seven by exactly one
discoveredBy: 4474
status: draft
confidence: medium
---

**What is wrong.** The 2026-09-24 reference sweep found no catalogue card whose
triggered ability listens to `TRIGGER_FIZZLED`, `BLOCKER_DECLARED` or
`LIBRARY_SEARCHED`, and seven further `GameEventType` members reached through
a single card. The event plumbing for the three exists in the engine with no
consumer, so no card-level test can exercise it.

**Evidence.** `convex/gre/types.ts` (`GameEventType`), `convex/gre/triggers.ts`;
sweep scripts in the session scratchpad (`suite/cov/`).

**Why it may not deserve its own issue.** An event with no consumer is either
future-proofing for a card the Target Lists will bring (then the card's ticket
covers it) or dead vocabulary. Check the Target Lists for a card that needs
each before deciding; a dead event is a one-line deletion under the trigger
event vocabulary's own census.
