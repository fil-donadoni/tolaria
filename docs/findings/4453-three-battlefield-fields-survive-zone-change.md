---
title: dealtDamageToOpponentThisTurn, canAttackDespiteDefenderThisTurn and tapBonusMana survive a battlefield zone change
discoveredBy: 4453
status: draft
confidence: medium
---

**What is wrong.** `resetBattlefieldTransientState` (CR 400.7 — a permanent
that leaves and re-enters is a new object) never cleared three optional
`CardInstanceState` fields that are only ever set on a battlefield permanent:
`dealtDamageToOpponentThisTurn` and `canAttackDespiteDefenderThisTurn` (both
cleared at the cleanup step, so the window is "left and came back within one
turn": a blinked Whirling Dervish still reads as having dealt damage to an
opponent this turn; a blinked Vodalian War Machine target still attacks past
defender) and `tapBonusMana`, which nothing but the departure clears.

**Evidence.** The Card Field Lifecycle table (`convex/gre/state/cardFieldLifecycle.ts`)
classifies every optional key; the review of PR #4669 compared its
`zone-change` scope against the hand-written ladder at `origin/staging` and
found these three as the ONLY rows the table would have added. They were taken
back out for parity — the PR is billed wire- and behaviour-neutral — and the
frozen scope sets in `cardFieldLifecycle.test.ts` pin them as `turn` /
`none`.

**Why it may not deserve its own issue.** The windows are one turn wide and
reachable only through a same-turn blink of a card carrying one of the two
flags, none of which is in a preset deck; `tapBonusMana` is written by one
mana-ability idiom and read in the same activation. Adding `"zone-change"` to
the three rows is the whole fix once someone wants it, with the frozen set in
the test edited on purpose.
