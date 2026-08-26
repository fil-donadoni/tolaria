---
title: merge ticks on a very busy day are hard to hover individually, though keyboard access is unaffected
discoveredBy: 2631
status: draft
confidence: low
---

**What is wrong.** The Now timeline draws one `.ls-tl-merge` tick per PR merged
in the last 24 hours, de-collided to a minimum 2% centre-to-centre spacing
(`now-timeline.js`'s `deconflict`, `MIN_TICK_GAP_PCT`). On this repo's own live
data (a genuinely busy day, 40 merges in the window, several within seconds of
each other) the shared occlusion probe (`scripts/ui-gate/probe.js`, driven
directly via Playwright since `chrome-devtools-mcp`'s shared browser profile was
held by a concurrent session for the whole of this verification pass) reports
`occ` in the low-to-mid 30s out of 62 controls at desktop/tablet viewports — all
of them `.ls-tl-merge` against a `.ls-tl-merge` neighbour.

**Evidence.** Direct measurement rules out the two hypotheses that would make
this a real code bug:

- `getBoundingClientRect()` on every flagged pair shows genuinely
  non-overlapping boxes (5px wide, ≥15px apart at 1440px width) — verified by
  hand for several pairs, not inferred.
- Keyboard access is unaffected: focusing each `.ls-tl-merge[data-pr="N"]`
  element directly (`el.focus()`) lands `document.activeElement` on exactly that
  element every time, with the correct `data-term="pr.merged"` — checked for
  every merge tick on the live desktop payload.

What DOES reproduce, repeatedly, across `elementFromPoint`, `page.mouse.move`
to a `boundingBox()`-measured centre, and `locator.hover()`: the browser's own
`:hover` state lands on a neighbouring tick, consistently one DOM-index off
from the one requested, from the very first hover with no prior interaction (so
it is not a stale-hover-carried-over-from-the-previous-iteration artifact
either). This is either a genuine density limit for a mouse pointer on 5px
targets 20-25px apart, or a headless-Chromium-specific hit-testing quirk for
many adjacent small absolutely-positioned siblings — this pass could not
distinguish the two, because the one environment that would have (a normal,
non-headless browser via `chrome-devtools-mcp`) was unavailable for the whole
verification window.

**Why it may not deserve its own issue.** The issue's own acceptance criteria
("keyboard-reachable, not hover-only") are met and verified; a mouse-only
precision gap on a specific, unusually busy dataset is a lesser concern than
what the ticket was actually about (distinguishing pass outcomes and showing
claim age/release status). If it turns out to be real (not a headless
artifact), the fix is probably a different visual treatment past some density
threshold — collapsing a tight cluster into one "+N merges" badge that expands
on click/focus, rather than trying to make 5px marks individually mouse-precise
20px apart. Worth re-measuring first in a real interactive session before
committing to that redesign.
