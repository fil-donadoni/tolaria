---
title: An "each player draws" one-shot and a Howling Mine price the same draw two ways on one board
discoveredBy: 5164
status: draft
confidence: medium
---

**What is wrong.** Inside a Differential Reading, "a player draws N" now has two
prices. The standing each-step engine (issue #5164, `eachStepDifferentialValue`
in `convex/gre/ai/opValuers.ts`) prices each side's `draw` with
`EachPlayerSide.drawUnits`: the side's library-top expectation, kept after the
cleanup discard (CR 514.1). The one-shot `forEach { set: "players" }` path of
issue #5162 (`valueEachPlayerSide`) still sends a literal `draw` on `$each` to
the flat `draw` valuer. That valuer is the same magnitude on every side, so it
nets to zero. On the same board, a symmetric "each player draws a card" sorcery
reads 0, while the Howling Mine's single firing reads the hand-room and library
gap.

**Evidence.** `opValuers.ts`: `stepSideDraw` is called from
`eachStepDifferentialValue`. `valueEachPlayerSide` calls `valueOp(op, sideCtx)`
for `draw`. The #5164 review flagged this as nit 5.

**Why it may not deserve its own issue.** Moving the #5162 path onto
`drawUnits` is not a one-line change.

- Wheel of Fortune's body discards the whole hand before it draws seven.
- `drawUnits` reads the hand as it stands before the script runs.
- So routing the one-shot draws through it needs the walk to carry the hand the
  earlier Ops leave behind.

That makes it a line on the ADR 0151 PRD (issue #5160) or on tracker issue #5156,
not a standalone gap.
