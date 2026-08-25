---
title: check:ui's `lobby` row has the same account-state dependence #2822 cured for the Limited surfaces
discoveredBy: 2822
status: draft
confidence: high
---

**What is wrong.** #2822 pinned every `limited-*` / `draft-*` surface to a
seeded fixture, so those ceilings no longer move when the deployment gains an
event. The `lobby` surface still does, through the SAME mechanism one component
over — and it is the only row left in `budgets.json` that a Limited event can
move.

**Evidence.** `src/components/lobby/lobby.tsx:137,142` feeds
`DashboardLimitedBox` from two live queries, and neither is bounded by anything
the lane controls:

- `useMyCurrentLimitedEvents()` → the re-entry strip, **uncapped**
  (`dashboard-limited-box.tsx`'s `sortedEvents`): one row, with its own
  controls, per in-progress event the viewer holds a Seat in.
- `useOpenLimitedEvents()` → the joinable strip, capped at
  `MAX_DASHBOARD_OPEN_EVENTS = 3` (`dashboard-limited-box.tsx:21`) but fed by
  the query that returns **every open event on the deployment to everyone**
  (`convex/limitedEvents.ts`'s `listOpenLimitedEvents`).

Measured on this branch, two consecutive full `bun run check:ui` runs with one
unrelated `createLimitedEvent` between them (#2822's own acceptance
experiment): every `limited-*` and `draft-*` row byte-identical, and
`lobby @ 1440x900x2` `small 21 → 22`, over its ceiling — one open event, one
extra joinable row, one FAIL on a surface nobody touched. The two `ui-gate/*`
fixture events #2822 seeds also moved `lobby.small` by +1 at `390x844x3` and
`1180x820x2` when they landed (they are seated, so they enter through the
re-entry strip, not the capped one).

**Why it may not deserve its own issue.** It might be one line on #2580's lane
rather than a ticket: the mechanism is already understood and written up, and
the fix could be as small as walking the lobby with the same `?label=` idea
(there is no such filter on the dashboard today) or capping the re-entry strip
the way the joinable one already is — which is a product question, not a lane
one. It is also strictly smaller than what #2822 fixed: one surface, one key,
and the interference is a slow additive drift rather than "which seat did the
walk land on". Against that: it is the last data-dependent row in the file, and
the budgets header now claims the Limited side is pinned — a reader could
reasonably read that as covering the lobby's Limited box too.
