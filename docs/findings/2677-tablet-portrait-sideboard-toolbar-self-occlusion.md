---
title: Sideboard zone toolbar self-occludes at tablet-portrait after #2755
discoveredBy: 2677
status: draft
confidence: high
---

**What is wrong.** `CompactChromeDisclosure`'s `View ▾` control
(`src/components/deckbuilder/deck-zone-surface.tsx:587`) is occluded by its own
wrapped `Sideboard 0` header at `820x1180x2` (tablet portrait). Browser-verified
via `elementFromPoint`: the control's own visible centre hit-tests to the header
`<div>` wrapping it, not to itself.

**Evidence.** Measured on the Draft Room's `draft-pick`/`draft-pool-stop`
surfaces while re-recording their ceilings for issue #2677 —
`ctrlsOcc` went from a documented 4 (the Peek Panel rail gap) to 5, and the
5th item is `View ▾` occluded by `Sideboard 0View ▾`. This surface shares
`DeckZoneSurface` with the deckbuilder proper, so the same gap likely exists
on any tablet-portrait Sideboard-zone header elsewhere in the app.
`useIsTabletPortrait()`/`CompactChromeDisclosure`'s fold predicate landed in
#2755/#2671 ("fold the Sideboard zone toolbar at tablet-portrait to stop
starving the card port") — this is a residual gap in that same fold, not
something #2677's seat-state fix causes or touches.

**Why it may not deserve its own issue yet.** Only one control (`View ▾`) is
affected and it is self-occluded by adjacent text in the same header, not
covered by anything a user would consider "different content" — a minor
visual/hit-test overlap rather than an unreachable control (the header text is
adjacent, not on top in a way that blocks the click; `ctrlsStranded 0` at this
viewport). Worth a fold-width tweak in the same family as #2755/#2671, but
whether it is worth a standalone ticket vs. a line item the deckbuilder-header
owner picks up is a judgment call I did not make — I only pinned the ceiling in
`scripts/ui-gate/budgets.json` (`draft-pick`/`draft-pool-stop` @ 820x1180x2) so
the Draft Room's own lane rows describe it accurately, without touching
`deck-zone-surface.tsx` itself (out of scope for a `scripts/ui-gate/` issue).
