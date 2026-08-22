---
title: check:ui is red on main for six draft-room rows — the Peek Panel rail, not a regression
discoveredBy: 2665
status: draft
confidence: high
---

**What is wrong.** `bun run check:ui` cannot go green on this machine today,
before any diff. Six rows are over budget — `draft-pick` and `draft-pool-stop`
at `1440x900x2`, `820x1180x2` and `1180x820x2` — and they are over budget on
`main` itself. Nothing in issue #2665 touches them (that fix only changes the
`(orientation: landscape) and (max-height: 500px)` rung), and the measurements
prove it: the six rows read the SAME numbers on both trees.

**Evidence.** Three runs on this machine, 2026-08-22, same local deployment:

| run                          | draft-pool-stop 1440x900x2 | 820x1180x2      | 1180x820x2      |
| ---------------------------- | -------------------------- | --------------- | --------------- |
| base `eda78643`, first walk  | ctrlsOcc 1, small 7 (pass) | ctrlsOcc 7 FAIL | ctrlsOcc 5 FAIL |
| base `eda78643`, second walk | ctrlsOcc 5, small 11 FAIL  | ctrlsOcc 7 FAIL | ctrlsOcc 5 FAIL |
| `fix/issue-2665`             | ctrlsOcc 5, small 11 FAIL  | ctrlsOcc 7 FAIL | ctrlsOcc 5 FAIL |

Two things are visible there. First, the fix column is identical to the base
column, row for row — so this is not a regression. Second, the FIRST base walk
passed at `1440x900x2` and the second did not: between them the seat's pool went
from 15 cards to 16, because **the walk itself makes a pick**
(`scripts/ui-gate/surfaces.ts`, the `draft-pick` walk commits one). A deeper pool
mounts the Peek Panel rail with a Selected Card, and the rail is what the probe
scores as `ctrlsOcc`.

`scripts/ui-gate/budgets.json` already predicts exactly this, in `draft-pick`'s
own `knownDebt`: _"Recorded with NO Selected Card, so the Peek Panel is not
mounted here; a run whose seat has one will also measure the rail's `ctrlsOcc`
and needs a re-record rather than a code change."_ The underlying shape is
already drafted as
`docs/findings/2583-peek-rail-occludes-controls-outside-the-reserve.md`.

The unwalked rows are a separate, declared matter: `limited-build` needs an event
in `playing`, `game-board`/`game-stress` are declared unwalked in the budget file.

**Why it may not deserve its own issue.** Two thirds of it is a re-record, not a
defect — and re-recording is the one thing an implement subagent must not do
unasked, because a re-record from a drifted seat RAISES ceilings, which the lane
exists to prevent. But it is not purely bookkeeping either, and that is the part
worth a human's eye: a lane whose walk MUTATES the state it measures cannot have
a stable budget, so `draft-pick`'s ceilings drift upward one pick at a time and
the lane teaches people to re-run it — the exact failure mode #2512 names. The
durable fix is a seat the walk resets (or a read-only pool stop), not a number.
Until then the six rows are noise every UI PR has to explain away, and that cost
is real.
