---
title: INV's real Limited coverage crossed the 80% per-sheet Draftability gate once compiled `ready` cards join `tryGetDefinition`
discoveredBy: 2702
status: draft
confidence: high
---

**What happened.** `convex/limited/__tests__/draftable.test.ts` asserted INV
computes as NOT Draftable (a fixed regression test for `computeDraftability`,
ADR 0059). After #2702 registers compiled `ready` rows into the same
`tryGetDefinition` seam `computeDraftability` (`convex/limited/draftable.ts`)
reads, INV's REAL measured coverage moved to 86% / 80% / 81% per sheet — all
three at or above the gate — so `computeDraftability` now genuinely reports
`draftable: true` for INV, with 58 cards still missing. This is not a test
bug; it is `tryGetDefinition` telling the truth about a wider registry.

**Evidence.** `bun scripts/tmp-inv-check.ts` (throwaway, not committed) built
INV's real Booster Config from the vendored `data/json/INV.json` via
`buildBoosterConfig` and ran it through `computeDraftability`:
`draftable=true, missing=58, sheets=[0.86, 0.80, 0.81]`. The fix landed in
#2702 (swapped the test's "still partial" fixture to LEG, which is at
76%/52%/71% with much more margin).

**Why it may deserve a ticket of its own.** `project_inv_batch_plan` (agent
memory) tracks INV as an active, incomplete batch effort. If the project
wants INV formally promoted to a shipped Draftable Set config (checked-in
Booster Config under `data/boosters/`, per the LEA precedent), that's real,
positive, and unplanned progress this PR incidentally produced — worth a
maintainer decision on whether to ship it, not something a headless
implement-subagent should decide unilaterally. The 58 still-missing card ids
are enumerable directly from `computeDraftability`'s `missingCardIds` return
value if someone wants the remaining gap list.

**Why it may not deserve one yet.** INV crossing the LIMITED gate says
nothing about whether those specific 1,429 newly-compiled cards are
individually correct/desired for constructed play, Bot valuation, or the
`/new-set` v2 pipeline this PRD explicitly defers (#2693 "Second lane").
Shipping INV as a real Draftable Set is a product decision with its own
scope (booster config generation, art/print selection, playtesting), not a
one-line flip.
