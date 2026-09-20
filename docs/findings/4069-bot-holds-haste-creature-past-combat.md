---
title: the Bot passes a haste creature precombat into an untapped blocker and casts it postcombat
discoveredBy: 4069
status: draft
confidence: medium
---

**What is wrong.** In the Bot-play sweep's generated position (PRECOMBAT_MAIN,
turn 3, an untapped 2/2 on the opponent's side) the root search picks `pass`
over `cast` for a creature with haste, on every seed and seat, and casts it in
POSTCOMBAT_MAIN. The same creature without haste is cast precombat. Issue #4069
closed by posing the card a second time (`REACH_WINDOWS`), which makes the sweep
read `played` — it does not explain the precombat preference.

**Evidence.** `searchWithTrace`, 400 iterations, seeds 0xb07 / 0x5eed, both
seats: `pass` 216 visits / meanReward 0.648 against `cast` 184 / 0.629 for a
2/2 with haste; controls cast precombat with vigilance, flying, defender or 6/6
stats, and with the opponent's creature removed. A reviewer's 1/1 for {4}{R}
with haste behaves the same, so attack profitability is not the whole cause.
The leaf evaluation scores the cast higher (369 against 336), so the
preference is not the evaluator's: `selectRootMove` settles outcome-equal
candidates on the subtree-accumulated `meanMargin`, and the `pass` subtree
contains the same cast one ply later.

**Why it may not deserve its own issue.** The Bot does play the card, one
window later, and holding a creature until combat is over is not wrong against
an untapped blocker. It matters only if a real game shows the Bot skipping the
precombat cast when the attack it enables would have been the right line; until
then it is a line on the Bot roadmap map (issue #1892), not a ticket.
