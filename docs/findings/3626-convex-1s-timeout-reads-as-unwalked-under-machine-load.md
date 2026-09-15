---
title: The local backend's 1s function timeout turns check:ui surfaces UNWALKED under machine load
discoveredBy: 3626
status: draft
confidence: medium
---

**What is wrong.** At machine load around 20 and above, ordinary queries and
mutations on the local Convex backend fail with
`Function execution timed out (maximum duration: 1s)`. The page renders an
error state or never advances, and `check:ui` reports a surface UNWALKED with a
reason that points at the surface ("the lobby rendered no main region", "reached
/game but no board affordance rendered within 10s") rather than at the backend.
Nothing in the run output ties the red to the timeout except the console-error
count.

**Evidence.** Issue #3626's end-to-end runs, each on its own per-run account, so
account state was ruled out:

- Load ~21, 11:26:13: `game:declareMulligan` timed out twice. The solo game's
  mulligan never landed, and `game-debug-sheet 1440x900x2` went UNWALKED.
- Load 50–96, 10:39–11:05: `game:myActiveGame`,
  `limitedEvents:getLimitedEvent` and `limitedEvents:myCurrentLimitedEvents`
  timed out repeatedly; both concurrent runs reported `lobby` and `lobby-vs-ai`
  UNWALKED, and coverage dropped to 4/21 and 5/21.
- The same code walked `lobby` clean in the first pair's other run, on its own
  account, minutes earlier at lower load.

**Why it may not deserve its own issue.** The cause is CPU contention from other
sessions on the shared machine, not a defect in any function. The PRD #3625
notes already record that machine load produces false UNWALKEDs, and slice B's
diff-scoped surfaces reduce the exposure. What might still earn a ticket is
visibility: have the lane count `Function execution timed out` console errors
and name them on the UNWALKED line, so a load red is not read as a UI
regression.
