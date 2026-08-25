---
title: limited-list / limited-your-events budgets.json ceilings are stale — every viewport but 844x390x3 now over budget
discoveredBy: 2671
status: triaged
issue: 2822
confidence: medium
---

**What is wrong.** `bun run check:ui` (full run, all surfaces) reds on
`limited-list` and `limited-your-events` at every viewport except
`844x390x3`, with the same shape at each: `small` measures 1 over the
recorded ceiling, and `1440x900x2`/`820x1180x2` also gained a new
`starved 1` where the budget records `0`.

```
FAIL  limited-list         1440x900x2   small25 — over budget: small 25 > 24
FAIL  limited-list         390x844x3    starved1, small17 — over budget: starved 1 > 0, small 17 > 16
FAIL  limited-list         820x1180x2   small22 — over budget: small 22 > 21
FAIL  limited-list         1180x820x2   starved1 — over budget: starved 1 > 0
FAIL  limited-your-events  1440x900x2   small23 — over budget: small 23 > 22
FAIL  limited-your-events  390x844x3    small16 — over budget: small 16 > 15
FAIL  limited-your-events  820x1180x2   small21 — over budget: small 21 > 20
FAIL  limited-your-events  1180x820x2   small21 — over budget: small 21 > 20
```

**Evidence it is pre-existing, not caused by this PR's diff.** The working
tree on this branch is clean — every change is committed — so there is
nothing a `git stash` isolates back to a base tip; an earlier draft of this
finding described that step and it did not happen. What actually grounds
"pre-existing" is diff scope, not a comparison against a separately-checked-
out base tree: `git diff main...HEAD --stat` shows this PR's diff touches
only `src/components/deckbuilder/**`, `scripts/ui-gate/surfaces.ts`'s
`deck-builder` walk, and `scripts/ui-gate/budgets.json`'s `deck-builder`
cells — nothing under `src/components/limited/**` or either surface's own
walk in `surfaces.ts`. `bun run check:ui -- --surface=limited-list,limited-your-events`
reproduces the same FAILs on this branch's HEAD; since nothing this PR
touches can affect either surface's walk or rendering, the drift predates
this PR regardless of what a base-tree run would show.

**Likely cause.** Probably account-state drift (the number of events/rows
`/limited` renders for the `TOLARIA_UI_EMAIL` test account has grown since
these cells were last recorded — each event row adds several `small`
controls), not a code regression. `small`'s per-control debt at these two
surfaces already has an open tracker.

**Why it may not deserve a new issue.** #2659 ("Coarse-pointer tap targets:
Limited list controls at 22-40px, overflow-menu items at 28px") already
owns the `small`/touch-target debt on this exact surface family — this may
just be #2659's existing ceiling needing a re-record pass rather than a new
problem. The `starved 1` at `390x844x3`/`1180x820x2` (new, not just
"budget exceeded" but a genuinely new starved-container reading at those
two cells) is the one piece that might warrant its own look — I did not
investigate what specifically starves there, since it is outside this
issue's target files.

**Disposition.** Re-record `scripts/ui-gate/budgets.json`'s `limited-list`
/ `limited-your-events` cells against current numbers (or fix the
underlying account-state assumption in `surfaces.ts` if the walk should be
pinning a fixed event count), and confirm whether the two new `starved 1`
readings are real regressions or the same account-state drift.

**Triaged 2026-08-25 → #2822.** Confirmed on a clean `main` (`91b355bb`): the
same eight FAILs reproduce with byte-identical numbers, so the drift is stable
rather than growing, and the guessed cause was right. The mechanism is now
named: `/limited` renders the union of `listOpenLimitedEvents` +
`myLimitedEvents` for `TOLARIA_UI_EMAIL`, so its control count is a function of
the deployment's event list; and `reachDraftRoom` (`surfaces.ts`) picks its
subject by list position, so `draft-pool-stop` moved the same way at
`390x844x3` (`small` 6 → 9) and `844x390x3` (`cardsOcc`/`ctrlsOcc` 2 → 3). The
ten cells were re-recorded with notes naming #2822; the fixture-pinning fix
that makes the readings a function of the code alone is #2822's own work.

The `starved 1` readings this finding flagged as "the one piece that might
warrant its own look" are the `<main>`-as-page-scroller false positive already
drafted in `docs/findings/2582-ui-gate-main-scroller-starved.md` — the event
list simply grew past `probe.js`'s 10% threshold at two more viewports. Not a
new defect.
