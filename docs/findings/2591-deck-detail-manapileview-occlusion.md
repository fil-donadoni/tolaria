---
title: ManaPileView's card fan overlaps far more than the deckbuilder's own pile view
discoveredBy: 2591
status: draft
confidence: medium
---

**What is wrong.** `/decks/$slug`'s deck detail page (issue #2591 gave it its
first `check:ui` budget) measures `cardsOcc` 54/60 cards at desktop and both
tablet viewports — most of every pile is occluded by the card stacked in front
of it. This is pre-existing behaviour (unchanged by #2591; the page already
rendered `ManaPileView` before this slice, which only added the curve chart,
legality section and Edit/Play above it), not a regression.

**Evidence.** `src/components/lobby/mana-pile.tsx:9-34`: each card in a pile is
absolutely positioned `idx * OFFSET_Y_REM` (1.4rem) below the previous one,
with no ceiling relative to `--card-h`. At the desktop/tablet `CARD_BASE`
(`deck-detail.tsx:18`, `cardBase("8rem", "20vw", "19vh")`), the rendered card
height is well over 10× the 1.4rem stagger, so every card but the last few in
a tall pile has its centre point covered by the one drawn after it — exactly
what the probe's centre-point occlusion check (`scripts/ui-gate/probe.js`)
flags. Contrast the deckbuilder's own `DeckColumnPile` (`convex/deckLayout.ts`
consumer in `src/components/deckbuilder/`), whose `pileHeight(n)` formula
staggers cards just enough to keep every centre clear — that surface's
`deck-builder` budget row already carries `cardsOcc: 0` at every viewport.

**Why it may not deserve its own issue yet.** The deck detail page is a
read-only preview (no drag, no per-card actions), so the fan is arguably fine
as pure decoration — a human looking at the screenshot sees "a stack of
cards", which is the intended metaphor. It only becomes a real ticket if
either (a) product wants the pile visually thinned out (closer to the
deckbuilder's spacing) or (b) the `check:ui` probe should special-case an
intentional decorative fan the way it implicitly already tolerates the
deckbuilder's tighter one. Recorded as `knownDebt` on the `deck-detail` budget
row (`scripts/ui-gate/budgets.json`) rather than fixed here — the ceiling
matches what was actually measured, not zero, so a real regression on this
surface later would still show up as a fresh delta.
