---
title: game-board's ui-gate row was withdrawn for a flap that only affects cardsOcc — every other metric was stable across two trees
discoveredBy: 2722
status: draft
confidence: medium
---

**What is wrong.** `scripts/ui-gate/budgets.json` declares `game-board`
`status: "unwalked"` with the note "two consecutive runs of the SAME tree gave
`cardsOcc` 4 then 5 at 844x390x3 — hand-fan overlap scales with the hand"
(#2512). The consequence is that the board — the app's main surface — has **no
browser receipt at all**, so any diff that recolours or reflows it ships with a
five-viewport gap and the implementer has no in-lane way to close it. That is a
strong response to a flap in ONE metric.

**Evidence.** #2722 needed a board receipt for its AC. Flipping the row to
`status: "budgeted"` with throwaway 999 ceilings (never committed; reverted in
the same command) makes the lane walk it, and it walks cleanly — `coverage: 1/1
surfaces measured`, `console errors: none`, 128s. Run on two different trees
(branch `feat/issue-2722` and a detached worktree at its base `55d32f07`), the
results were **byte-identical at all five viewports**, including the axe rule
names:

```
game-board 1440x900x2  cards n20 zero0 occ7 stranded0 | ctrls n8 zero0 occ0 stranded0 | starved0 | axe s1/c0 (aria-prohibited-attr)                              | small7 tiny6 hOverflow0
game-board 390x844x3   cards n14 zero0 occ1 stranded0 | ctrls n15 zero0 occ0 stranded0 | starved0 | axe s0/c0                                                    | small4 tiny18 hOverflow0
game-board 844x390x3   cards n20 zero0 occ4 stranded0 | ctrls n7 zero0 occ0 stranded0 | starved0 | axe s2/c0 (aria-prohibited-attr,scrollable-region-focusable)   | small3 tiny3 hOverflow0
game-board 820x1180x2  cards n20 zero0 occ8 stranded0 | ctrls n8 zero0 occ0 stranded0 | starved0 | axe s1/c0 (aria-prohibited-attr)                              | small5 tiny6 hOverflow0
game-board 1180x820x2  cards n20 zero0 occ7 stranded0 | ctrls n8 zero0 occ0 stranded0 | starved0 | axe s1/c0 (aria-prohibited-attr)                              | small5 tiny6 hOverflow0
```

The withdrawal note names `cardsOcc` alone. A row that budgets `cardsZero`,
`cardsStranded`, `ctrls*`, `starved`, `axeSerious` and `axeCritical` and simply
**omits** `cardsOcc` (or gives it a wide ceiling) would deliver a real board
receipt without the flap — `budgets.json` rows are per-metric, so dropping one
metric costs nothing structurally. `axeSerious`/`axeCritical` in particular are
the floors most worth having on the board and were perfectly stable.

Two genuine pre-existing board defects surfaced in the same run, currently
invisible because nothing measures the surface: `aria-prohibited-attr`
(4 of 5 viewports) and `scrollable-region-focusable` (844x390x3).

**Why it may not deserve its own issue.** #2512's decision was explicitly
"close `game-stress` first, then this one", so the ordering may be deliberate
and a per-metric row would pre-empt a fix someone already has planned. Two
consecutive runs on two trees is also a small sample against a flap the note
says it measured directly — it may be position-dependent in a way both of my
runs happened to miss. This is a line on #2580 / #2512 rather than a ticket
unless the per-metric idea is new to them.
