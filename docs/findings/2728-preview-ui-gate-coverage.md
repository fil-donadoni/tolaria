---
title: card preview lateral zoom / anchored pin / Inspect Overlay have no dedicated ui-gate walk
discoveredBy: 2728
status: draft
confidence: medium
---

**What is wrong.** `scripts/ui-gate/surfaces.ts` only exercises the
Draft-pool peek surface (`draft-pool-peek`, `DRAFT_PEEK_PANEL =
"[data-peek-panel]"`) in this area. The desktop lateral zoom
(`CardPreviewDock`, `[data-card-preview-dock]`), the beside-the-card anchored
pin (`CardPreviewAnchored`, `[data-card-preview-anchored]`) and the editing
surfaces' `InspectOverlay` (`[data-inspect-overlay]`) have no walk of their
own — `bun run check:ui` never opens any of them, so a viewport regression on
these three surfaces (including the v4 reskin and the new Engine View slot
landed by issue #2728) reaches production without a probe catching it.

**Evidence.** `scripts/ui-gate/surfaces.ts:1082` is the only site referencing
this area (`draft-pool-peek`); grepping the file for
`card-preview-dock`/`card-preview-anchored`/`data-inspect-overlay` finds
nothing else.

**Why it may not deserve its own issue yet.** The three surfaces are all
reachable from runbook flows that check:ui does walk today (hover a
battlefield card opens the dock; right-click opens the anchored pin;
Peek Panel → Inspect opens the overlay) — this may be closeable by widening
an EXISTING surface's click sequence rather than adding a new one. Worth a
scoping pass before cutting a ticket.
