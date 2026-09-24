---
title: buildSpellContext is one 7,200-line closure of 305 members, 19 duplicate groups, 52 single-set primitives
discoveredBy: 4447
status: draft
confidence: high
---

**What is wrong.** The `SpellContext` closure defines 305 members (10 data, 295
methods): 190 read only `state` and their arguments, 104 are thin forwards to
an exported function, 19 groups of near-identical bodies cover 52 primitives
and 357 lines (22 one-field setters, 31 one-field getters), 52 primitives are
used by exactly one set file (card-shaped), and one primitive builds a whole
second context to call one method. Every resolution allocates 295 closures.

**Evidence.** `convex/gre/state.ts` (~16394–23590); interface
`convex/cards/types.ts` (~3746–7424); 2026-09-23 audit tables.

**Why it may not deserve its own issue.** Splitting it into domain factories
spread into one object is mechanical and API-preserving (~7,200 lines moved,
~500 deleted), but it is cosmetic until the zone-change core has a module of
its own — the closure would still import everything. PRD (a) #4447 deletes the
9 dead primitives; the decomposition waits for the cost-payment and
zone-change extractions, and for a second reader of the primitives (the Oracle
compiler emits Ops, not primitives, so the pressure is low).
