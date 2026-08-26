---
title: history-filters.js underscore-stripping is a second naming authority for dimensions
discoveredBy: 2629
status: draft
confidence: medium
---

**What is wrong.** #2629 makes `scripts/dashboard/glossary.js` the single
authority for what an abbreviation is CALLED on the dashboard. One surface
already derives its own label for the same tokens, by string transform, and
will now disagree with the glossary rather than being missing from it — a
divergence no test can see, because both sides are "correct" in isolation.

**Evidence.** `scripts/dashboard/history-filters.js:24` renders every dimension
option as `d.replace(/_/g, " ")`. For the ten dimensions in
`scripts/telemetry-serve.ts:148` that yields `cmd bucket`, `model req`,
`agent type`; the glossary's labels for the same keys are `command family`,
`model requested`, `agent type`. So after the History surfaces are labelled
(the next two tickets, per #2629's own scope note), the filter picker and the
column header will name the same column differently on the same screen.

**Why it may not deserve its own issue.** It is squarely inside the stated
scope of #2629's successors ("applying them across the History surfaces is the
next two tickets"), so the natural fix is one line in whichever of those
touches `history-filters.js` — replacing the transform with `lookupTerm(...)
?.label ?? d`. It only becomes a ticket of its own if those two land without
touching the filter row, at which point the divergence is shipped and visible.
