---
title: check:ui is already red on draft-pick / draft-pool-stop at desktop and tablet viewports, unrelated to any code diff
discoveredBy: 2664
status: draft
confidence: high
---

**What is wrong.** `bun run check:ui` fails today on `main`'s current live
Convex state — before and after the touch-action fix this issue makes — at
six (surface, viewport) pairs, all on desktop/tablet (mouse or `mobile,touch`
non-phone) viewports, never the two phone viewports:

```
FAIL  draft-pick       1440x900x2  ctrlsOcc 5 > 4, small 11 > 7
FAIL  draft-pick       820x1180x2  ctrlsOcc 7 > 4
FAIL  draft-pick       1180x820x2  ctrlsOcc 5 > 4
FAIL  draft-pool-stop  1440x900x2  ctrlsOcc 5 > 1, small 11 > 7
FAIL  draft-pool-stop  820x1180x2  ctrlsOcc 7 > 2, starved 1 > 0
FAIL  draft-pool-stop  1180x820x2  ctrlsOcc 5 > 1
```

`draft-pick`/`draft-pool-stop` at `390x844x3` and `844x390x3` (the phone
viewports #2664 actually targets) PASS cleanly in every run.

**Evidence.** Ran `bun run check:ui -- --surface=draft-pick,draft-pool-stop`
three times against the shared dev Convex deployment: (1) with #2664's fix
committed, (2) with #2664's diff reverted back to `touch-none` (a manual
`git checkout HEAD~1 --` on just the two touched files, then restored), and
(3) the original full-lane run before that. All three produced byte-identical
FAIL lines for the six rows above — the touch-action CSS class on
`limited-draft-pack-card.tsx` cannot affect `ctrlsOcc` (Peek Panel rail /
floating button occlusion) or `small` (sub-44px tap targets) at a
mouse-pointer or non-touch-scroll viewport in any case, and the measurement
confirms it doesn't.

The lane's own printed commentary (`scripts/ui-gate/index.ts`'s per-row notes,
lines ~130-139 of a full run) already documents these exact numbers as
**recorded ceilings** tied to two open, tracked issues — `ctrlsOcc`/`small`
at desktop/tablet is the Peek Panel rail occlusion
(`docs/findings/2583-peek-rail-occludes-controls-outside-the-reserve.md`) and
the sub-44px `--control-h-fine`/`--control-h-coarse` tap-target debt (#2658,
owned by #2659). So the mechanism is understood and already tracked — what's
new here is that the **measured value now exceeds the recorded ceiling**
(`ctrlsOcc 5 > 4`, `small 11 > 7`, etc.), which the annotation text doesn't
mention. Two live-state possibilities, not distinguished by this pass: (a) the
shared dev deployment's current draft has more pool cards / a taller pile than
when the ceilings were last recorded, naturally pushing `ctrlsOcc`/`small`
up, or (b) an unrelated change since the last recording (deliberately not
investigated — this issue's map explicitly excludes touching
`scripts/ui-gate/surfaces.ts` / `budgets.json`, which a concurrent sibling
issue #2671 is editing in a parallel worktree).

**Why it may not deserve its own issue.** It's very likely one line on #2659
(which already owns fixing the desktop-rail and tap-target debt these ceilings
encode) rather than a new ticket — the mechanism, not just the numbers, is
already tracked. It could also simply be a stale ceiling that needs
re-recording (`bun run check:ui -- --record --surface=draft-pick,draft-pool-stop`)
once #2671's concurrent `surfaces.ts`/`budgets.json` edits land, since
re-recording while two sessions are mid-flight on those exact files would
race. Confidence is high that this is pre-existing and code-diff-independent
(three identical measurements, one deliberately on the pre-fix tree); it's
`draft`, not `declined`, because nobody has yet decided whether it's (a) a
#2659 line item or (b) a ceiling that just needs a re-record post-#2671.
