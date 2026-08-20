---
title: Three viewport predicates disagree about what a tablet is, and two of them call it a desktop
discoveredBy: 2585
status: draft
confidence: medium
---

**What is wrong.** The app now has FOUR predicates that split the viewport, and
they do not agree on the roomy touch device. #2585 added the fourth
(`useSurfaceClass`, `phone | roomy-coarse | roomy-fine`) because the existing
three cannot express "roomy but coarse-pointered", but it only rewired the ONE
consumer that slice owned — the deckbuilder's Filters entry point. Everything
else still classifies an iPad as a desktop.

**Scope note (added in the #2585 fixup round).** This finding is about the
PREDICATES only. It is **not** the reason the issue's "deck pane ≥60% of the
height" criterion is unmet, and folding the two chrome bands below cannot
satisfy it — see
`docs/findings/2585-deck-pane-60-percent-needs-the-pane-split.md`, which carries
the arithmetic. The earlier version of this file implied otherwise; that was
wrong.

**Evidence.**

- `src/hooks/useViewportMode.ts:19,34` — `portrait` needs `max-width: 767px`
  and `landscape-compact` needs `max-height: 500px`, so tablet portrait
  (820×1180) and tablet landscape (1180×820) both fall through to `"desktop"`.
- `src/index.css:55` — the `compact-chrome` CSS variant mirrors those same two
  queries verbatim, deliberately (`compact-chrome.test.tsx:104-113` pins the
  mirroring). So the CSS half is tablet-blind for the same reason.
- `src/components/deckbuilder/compact-chrome-disclosure.tsx:56-57` — gates on
  `useViewportMode() !== "desktop"`. Consequence: the zone toolbar
  (`deck-zone-surface.tsx:541`, `label="View"`) and the ADD BASIC bar
  (`pool-basic-lands-bar.tsx:81`) still render UNFOLDED on a tablet, each
  paying the coarse-pointer 44px rung. Worth ~78px of chrome at 1180×820 — real,
  but a third of what the 60% criterion needs.
- `src/components/editing/peek-panel.tsx` + `usePeekPanelLayout.ts` — splits
  two ways in the OTHER direction, filing phone-landscape with desktop.
- `src/hooks/useSurfaceClass.ts` is itself a capability ahead of its consumer:
  its only reader branches on `=== "phone"`, and that branch is today identical
  to `useViewportMode() !== "desktop"`. The `roomy-coarse` / `roomy-fine` seam
  it adds is what a `CompactChromeDisclosure` rewire would consume.

**Why it may not deserve its own issue.** Two reasons to hold. (1) Changing
`CompactChromeDisclosure`'s predicate without changing the `compact-chrome` CSS
variant desynchronises the pair that `src/index.css:52-54` explicitly warns must
stay in step — a control would vanish from the layout while keeping its tab
stop, which is exactly what the browser probe counts as a `zero`-size control.
So this is a paired change with a browser measurement, not a one-line edit, and
it belongs with whichever remaining PRD #2405 slice owns the deckbuilder's
tablet geometry. (2) `useViewportMode`'s `"desktop"` bucket is CORRECT for
layout — a tablet really does get the two-pane split — so this is not a bug in
that hook, only in the consumers that borrowed it to ask a different question.
