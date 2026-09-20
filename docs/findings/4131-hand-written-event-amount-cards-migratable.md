---
title: Hand-written "that much" cards still say the DSL cannot read an event amount
discoveredBy: 4131
status: draft
confidence: high
---

**What is wrong.** `{ ref: "$event.amount" }` now exists (`EVENT_FIELD_REGISTRY`
`DAMAGE_DEALT.amount`, the `number` family — issue #4131), but the hand-written
catalogue still carries `resolve()` closures that read `event.amount`
(`convex/cards/sets/**`, 38 call sites) and several justify staying imperative
with a claim that is no longer true: `inv/multicolor.ts` (Armadillo Cloak, "no
trigger-event `amount` row in `EVENT_FIELD_REGISTRY`"), `arn/black.ts`
(El-Hajjâj, "the gained amount is event.amount"), `leg/white.ts` (Spirit Link,
"Blocked on: a numeric $event ref family").

**Evidence.** `bun run oracle:compile` now compiles Spirit Link, Armadillo Cloak,
El-Hajjâj and Horned Cheetah to a DSL definition (`gainLife` with
`amount: { ref: "$event.amount" }`), so each round-trips and left Guard C's
baseline in the same PR.

**Why it may not deserve its own issue.** Only the `DAMAGE_DEALT` row is
censused; every other event whose closure reads an amount needs its own row
first. A line on the migration tracker, not a ticket.
