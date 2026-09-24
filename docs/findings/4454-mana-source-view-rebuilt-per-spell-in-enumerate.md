---
title: enumerateMoves rebuilds the mover's producible-mana-source view for every candidate spell
discoveredBy: 4454
status: draft
confidence: medium
---

**What is wrong.** `enumerateCastMoves` (6.2 %) and `castTapPlans` (2.6 %)
call the mana planner per spell, and each call rebuilds
`getProducibleManaSourceView`; nothing is cached per enumeration, and
`enumerateMoves` runs up to three times on the same state.

**Evidence.** `convex/gre/moves.ts` `enumerateMoves` (~5100) and the cast
branch; 2026-09-23 profile.

**Why it may not deserve its own issue.** Building the view once per
enumeration and passing it to every `planManaPayment` is 3–5 %, but the
planner's ~9 consumers span client and server (a server-only signature change
freezes the Bot). Do it after PRD (c) #4437's search cast kernel, when the
search side has one call site.
