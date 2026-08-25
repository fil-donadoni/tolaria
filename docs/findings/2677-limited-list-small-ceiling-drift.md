---
title: limited-list / limited-your-events small-ceiling drift on a clean check:ui run
discoveredBy: 2677
status: draft
confidence: medium
---

**What is wrong.** A full `bun run check:ui` (all surfaces, no `--surface`
filter) on the same tree that fixes #2677 fails two UNRELATED rows:
`limited-list` (small 25>24 @1440x900x2, starved 1>0 + small 17>16 @390x844x3,
small 22>21 @820x1180x2, starved 1>0 @1180x820x2) and `limited-your-events`
(small 23>22 @1440x900x2, small 16>15 @390x844x3, small 21>20 @820x1180x2 and
@1180x820x2). All are `small`/`starved` ceilings exceeded by 1, at multiple
viewports.

**Evidence.** `/tmp/checkui-2677-fullrun.log` from this pass. Neither surface
is touched by #2677's diff (`scripts/ui-gate/surfaces.ts`,
`scripts/ui-gate/budgets.json` only touch the `draft-pick`/`draft-pool-stop`
rows and the shared `reachDraftRoom` walk, which neither of these two surfaces
calls). Both are `/limited` list views sharing chrome/toolbar components with
the Draft Room's own Sideboard-zone gap documented in
`2677-tablet-portrait-sideboard-toolbar-self-occlusion.md` — plausibly the same
family of recent tablet-portrait/toolbar changes (#2755/#2671), but I did not
verify the exact cause for these two rows the way I did for the Draft Room's.

**Why it may not deserve its own issue yet.** I have not confirmed whether
this is a genuine app regression vs. stale ceilings that simply predate a
`small`-affecting UI change elsewhere — that diagnosis (which #2677 did for
the Draft Room's own rows) was not repeated here since these surfaces are out
of scope for a `scripts/ui-gate/`-only issue ("Any other surface's recorded
ceilings" is explicitly out of scope in #2677's body). Whoever owns
`limited-list`/`limited-your-events` next should re-run
`bun run check:ui -- --surface=limited-list,limited-your-events --record` and
decide whether to `--accept` or treat it as a real regression to fix.
