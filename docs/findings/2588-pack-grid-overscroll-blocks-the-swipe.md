---
title: A scrolling Booster grid swallows the swipe between the Draft Room's two snap stops
discoveredBy: 2588
status: draft
confidence: medium
---

**What is wrong.** The phone Draft Room's two panes live in one
`scroll-snap-type: mandatory` scroller, and the Booster grid inside the pack
pane is itself a scroller with `overscroll-behavior: contain`. `contain`
stops scroll CHAINING, so once the grid actually overflows — the `4×4`
density rung on a short viewport, or a 15-card pack in portrait at a large
text size — a vertical swipe that begins on a card tile scrolls the grid to
its end and then stops. It never reaches the snap scroller, so the gesture
the chevron advertises does nothing when the finger starts on the pack.

Reaching the pool still works by TAP (the pool strip is a button, which is
the documented affordance and what the runbook drives), and a swipe that
starts on the strip or the status bar chains normally. So this is a
degraded hint, not an unreachable pane.

**Evidence.** `src/components/limited/draft-room/draft-portrait-panes.tsx`
(the pack pane's inner `overflow-y-auto overscroll-contain` wrapper) inside
`[data-slot=draft-snap-scroller]`, which is itself `overscroll-contain`. The
same shape in `draft-landscape-panes.tsx`. The prototype
(`touch-draft-surface.tsx` on `prototype/touch-gestures`, the surface whose
verdicts this slice reproduces) has the identical pair, so the behaviour was
in what was play-tested rather than introduced here.

**Why it may not deserve its own issue.** Dropping `contain` from the grid
trades this for the opposite bug — a flick through the pack overshooting into
the other pane mid-gesture — which is the failure mode `overscroll-behavior`
exists to prevent, and the deckbuilder's MV rows chose `contain` for the same
reason (issue #2584). It may simply be the right trade, in which case the
honest fix is a sentence in the runbook rather than a ticket. Worth a real
device before anyone changes it.
