---
title: probe.js counts every off-screen control as `stranded` on a page whose scroller is the document
discoveredBy: 2630
status: draft
confidence: medium
---

**What is wrong.** `scripts/ui-gate/probe.js`'s `stranded` bucket means "nothing
of this element is on screen and no gesture can bring it back". It decides
"no gesture can bring it back" by walking for a scrollable ANCESTOR
(`scrollPort`, `probe.js:75-86`) and treating `null` as unreachable
(`probe.js:167`). On the Tolaria app that is right: `<main>` is the scroller, so
a `null` port really does mean nothing scrolls. On a page whose scroller is the
DOCUMENT it is wrong — every ancestor is unscrollable, so every control merely
below the fold counts as `stranded`.

**Evidence.** The telemetry dashboard (`scripts/telemetry-dashboard.html`)
scrolls the document. Measured on `feat/issue-2630` at 844x390x3, live server:

- at scroll offset 0: `ctrls n8 stranded4 occ0` — the four traffic lights.
- after `scrollIntoView` on the fourth light: `ctrls stranded3 occ0`, and the
  three now-stranded controls are the header `theme` button and the two tabs,
  which scrolled off the top. Every light hit-tests to itself
  (`elementFromPoint` → `ls-light`), i.e. painted and unoccluded.

So the count tracks "controls outside the current viewport", not reachability,
and it moves as the page scrolls rather than describing the page.

**Why it may not deserve its own issue.** No surface in `surfaces.ts` scrolls
the document today, so `check:ui`'s own budgets are unaffected and nothing is
currently mis-gated. It matters only if a document-scrolled surface is ever
added to the lane — the telemetry dashboard is the obvious candidate, since
#2621 is actively building it out and its Now view is the one screen an operator
reads under time pressure. The narrow fix would be for `scrollPort` to report
the scrolling element when `document.scrollingElement` can scroll, rather than
`null`; the risk is that it changes `stranded`/`reachable` for every existing
budget key at once.
