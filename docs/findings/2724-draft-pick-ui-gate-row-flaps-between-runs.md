---
title: draft-pick's ui-gate row flaps between runs of the same tree — the shape game-board was withdrawn for, on a still-budgeted surface
discoveredBy: 2724
status: draft
confidence: high
---

**What is wrong.** `draft-pick` gives different budget verdicts on two
consecutive `bun run check:ui` runs of the _identical_ tree. That is the exact
failure `game-board`'s `unwalked` row was withdrawn for — its own `reason` in
`budgets.json` says "two consecutive runs of the SAME tree gave cardsOcc 4 then
5 … A ceiling that flaps is worse than no ceiling: a lane people learn to
re-run is a lane they route around (#2512)" — except `draft-pick` is still
budgeted, so it fails a PR instead of being skipped.

**Evidence**, all on `feat/issue-2724` at `31fccee1`, same tree, same
deployment, runs minutes apart:

```
run 1  FAIL draft-pick 390x844x3   cards zero1 …  — over budget: cardsZero 1 > 0
run 2  PASS draft-pick 390x844x3   cards zero0 …
run 1  PASS draft-pick 1180x820x2  ctrls … occ0 …
run 2  PASS draft-pick 1180x820x2  ctrls … occ4 …
```

`cardsZero` counts card images measuring under 4px — i.e. the pack's art had
not been laid out yet when the probe ran. `ctrlsOcc` moving 0 ↔ 4 at the same
viewport is the same timing, on the pick controls. The surface deals a live
draft, so what the probe sees depends on where the pack animation and the
bots' picks happen to be.

**Not the same as `docs/findings/2670-limited-draft-surfaces-preexisting-ui-gate-drift.md`**,
which is on disk already and covers the `limited-list` / `limited-your-events` /
`draft-pool-stop` `small`/`starved` failures — those are _stable_ over-budget
readings from deployment data drift, and this issue re-confirmed all ten of
them byte-identically in a detached worktree at the branch point (`45e0bdcc`).
Stable-but-stale is a re-record; flapping is a different defect, and only
`draft-pick` has it.

**Why it may not deserve its own issue.** It is arguably one line of the same
work #2670's finding describes ("re-record these surfaces against a fixed
fixture"), and a fixed fixture would cure both. The reason to separate them is
that the REMEDIES differ: a stale ceiling is fixed by re-recording, a flapping
one is not — re-recording a flapping row just moves which run fails. Either
`draft-pick` needs its walk pinned (wait for the pack to settle, as the
deck-builder walk pins its own decklist) or it needs `game-board`'s treatment.
