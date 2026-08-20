---
title: The Sideboard zone's header toolbar row has no scroll port, so any narrowing of the zones pane's width strands more of it
discoveredBy: 2585
status: draft
confidence: high
---

**What is wrong.** `deck-zone-surface.tsx:507-535` lays out each zone's header
row (title + filter/grouping/ordering/card-size controls) as a `flex-wrap`
row whose trailing cluster (`ml-auto flex min-w-0 flex-wrap items-center gap-2
self-center md:shrink-0`, line 535) does not shrink below its children's
min-content width. When that cluster's natural width exceeds the zone's own
box, the excess is clipped by an ancestor with `overflow-hidden` and no
scroll port (`min-h-0 min-w-0 flex-1 overflow-hidden`) — content past the
clip edge is genuinely unreachable by any gesture (`stranded`, not
`reachable`, in `scripts/ui-gate/probe.js`'s vocabulary). The comment at
`deck-zone-surface.tsx:525-534` already documents this exact mechanism from
issue #2511 ("the pane clips … unreachable by any gesture (4 stranded
controls at 844x390, 1 at 390x844) … Above `md` nothing changes").

**Evidence.** Issue #2585's dock split (`deck-builder-shell.tsx`) narrows the
zones pane's own width at landscape-and-roomy viewports (it now shares the row
with a bounded-width source-panel dock instead of owning the full width). The
Sideboard zone's box is a fixed ~25% share of that width
(`--split-main`/`splitDefault` 3/4, `deck-zones-surface.tsx:278`), so the
narrower total directly shrinks the Sideboard's own box, and more of its
already-overflowing toolbar row clips:

| viewport | zones-pane width | Sideboard box width | stranded/occ (before → after #2585) |
| -------- | ---------------- | ------------------- | ----------------------------------- |
| 1440×900 | 1440 → 1088      | 354 → 266           | 3 → 7 (the 4 color-filter pips)     |
| 1180×820 | 1180 → 828       | ~290 → 202          | 6 → 6+2occ+3 = 9 stranded, 2 occ    |

Measured live via CDP `getBoundingClientRect()` against `feat/issue-2585` and
`main` on the same account/deck (`docs/findings/2585-*` receipt in the PR).

**Why it may not deserve its own issue.** It is not a NEW bug — it is #2511's
already-accepted, already-documented trade-off ("Above `md` nothing changes:
`shrink-0` still protects the controls from a long zone title" was already an
approximation, not a guarantee, and 3/6 controls were already stranded at
these two viewports before #2585 touched anything). #2585 only widens the
blast radius by reducing the zones pane's available width, which any future
width-reducing change to this shell would do identically. The actual fix —
give the trailing toolbar cluster its own `overflow-x-auto` scroll port so
overflow becomes `reachable` instead of `stranded` — is a one-line change
`deck-zone-surface.tsx` owns, independent of the dock split, and is exactly
the kind of "zone toolbar" surface #2585's own scope explicitly excludes
touching. Worth a slice under #2511 or the ADR 0101 tablet/desktop chrome
work, not a re-open of #2585.
