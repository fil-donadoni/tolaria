---
title: applyTapPlan never debits floating mana, so a pool-funded cast is free inside the search
discoveredBy: 3569
status: draft
confidence: high
---

**What is wrong.** `applyTapPlan` (`convex/gre/search.ts`, and its twin in
`convex/gre/applyMove.ts`) is the search's coarse mana model: it marks the
planned sources tapped, sacrifices the ones whose payment does that, and spends
depletion counters — but it never touches `manaPool`. `planManaPayment` models
pool mana as ZERO-TAP sources, so the part of a cost the pool covers emits no
tap entry at all, and nothing anywhere else debits it: inside the tree a cast
or activation funded from the pool is FREE, and the pool is still there for the
next move to spend again.

**Evidence.** Measured on issue #3569's probe at `a10dde972`: Decree of Justice
cycled for {2}{W} out of a six-mana pool inside the search, and the pool was
still six afterwards.

**Why it may not deserve its own issue.** Real boards rarely hold a floating
pool at a decision point — CR 500.5 empties it at every step and phase boundary
— so the blast radius is small. What it does reach is every blade position that
PRE-FLOATS mana (the `landstill key line: pays {X} on the cycled Decree for
Soldiers` entry, the Errant Minion entry): those overstate the Bot's resources
by however much the pool covered. Issue #3569's own `number-choice` path is not
affected — it credits the exact shortfall and the submit spends exactly it, so
the pool is unchanged across the pair — but a fix here would change the mana
model for every cast and activation in the tree, which is a measurable strength
change and wants a ladder run, not a drive-by.
