---
title: The trigger scan is events × sources × abilities with no index by event type, and its inner loop is written four times
discoveredBy: 4437
status: draft
confidence: medium
---

**What is wrong.** Every triggered ability matches with its own event list plus
a `matches()` predicate; there is no index from event type to candidate
abilities, so every action pays events × sources × abilities. The inner matching
loop exists four times and delayed triggers get seven separate passes.
`triggerEventVocabulary.ts` plays no part in matching (it is a scenario
serialisation table).

**Evidence.** `convex/gre/triggers.ts` — the four copies of the inner loop
(around the collect / place / delayed sections) and the seven delayed-trigger
passes; 2026-09-23 audit.

**Why it may not deserve its own issue.** The cost does not show in the Bot's
profile (<5 %); the duplication is a readability tax, not a correctness one.
An `eventTypes = new Set(events.map(e => e.type))` prefilter plus one extracted
`fireAbilityAgainstEvents` would be ~200 lines in one file, APNAP order (CR
603.3b) untouched — do it opportunistically when the next trigger zone or
delayed-timing kind is added.
