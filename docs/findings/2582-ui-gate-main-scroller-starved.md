---
title: check:ui counts the app's page scroller (<main>) as a "starved" container, so any page taller than ~1.1 viewports reds a starved-0 row
discoveredBy: 2582
status: draft
confidence: high
---

**What is wrong.** `scripts/ui-gate/probe.js:76-91` flags a scroll container
whose `clientHeight < 0.9 * tallest child`. The bug class it was written for is
a **component** window: "a 66px window around a 101px card tile"
(`.claude/rules/chrome-debug.md`). But `<main>` is the app's PAGE scroller
since issue #2056 — `flex-1 min-h-0 overflow-y-auto` — and most routes render
exactly ONE child into it. So `<main>` trips the same rule whenever a page is
more than about 1.11 viewports tall, which is what "the page scrolls" means.
The count is real; the reading is not. A `starved: 0` ceiling on such a row is
therefore a bet on the page's CONTENT staying short, not on its layout being
right.

**Evidence.** Measured on this deployment at 844x390x3 (phone landscape), with
`scripts/ui-gate/surfaces.ts`'s own walks and the real `probe.js`:

| tree                  | surface               | `<main>` window | tallest child | verdict     |
| --------------------- | --------------------- | --------------- | ------------- | ----------- |
| `feat/issue-2582`     | `limited-list`        | 314px           | 673px         | `starved 1` |
| `origin/main`'s `src` | `limited-list`        | 340px           | 673px         | `starved 1` |
| `feat/issue-2582`     | `limited-your-events` | 314px           | 639px         | `starved 1` |
| `origin/main`'s `src` | `limited-your-events` | 340px           | 639px         | `starved 1` |

Same tree, same deployment, same walk — only `src/` swapped. The recorded
ceiling of 0 dates from 2026-08-19, when this deployment's event list was short
enough to fit; the rows went red because events were ADDED, not because any
layout changed. The `<main>` window would have to reach 607px out of 390px of
viewport to clear the threshold, so no shell height can buy it off.

The same false positive is already carried elsewhere under a wrong
attribution: `design-system-dialog`'s note calls its `starved 1` "the census
page's own table scroller", but the probe's own detail names
`main.flex.flex-1.min-h-0.flex-col.overflow-y-auto` — 788px window, 12176px
column at 1440x900x2, on `origin/main` as well.

**Why it may not deserve its own issue.** It is a one-predicate change in
`probe.js` — skip the element that IS the page scroller, or require the child
to be a repeated tile rather than the route's single content column — but it
re-baselines the `starved` reading on every surface in the lane at once, which
is #2580's call, not a slice's. Issue #2582 re-recorded the two `limited-*`
rows to 1 with the measurement above rather than change the heuristic under
every other row's note. Related and already drafted:
`docs/findings/2581-ui-gate-card-probe-counts-ambient-backdrop.md`.

**Adjacent, same lane, NOT fixed here.** `scripts/ui-gate/index.ts:452` loops
viewport-outer / surface-inner, and `game-board` is `status: "unwalked"`, so
the lane never creates a game — nothing in it makes the shell's
`AppReturnBanner`, the header/nav in-progress badges, or the
banner-stacked-on-context-bar case render on purpose. They were measured at
every viewport during issue #2582's verification only because a game happened
to be live on the deployment. A surface whose walk REQUIRED the banner would
print `UNWALKED` (a red) whenever no session is in flight, so closing the hole
means the lane creating and tearing down its own session — the restructuring
`game-stress` is already blocked on.
