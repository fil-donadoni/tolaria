---
title: game-stress and game-card-preview may now be walkable — their stated blocker is the bug issue #3493 fixed
discoveredBy: 3493
status: draft
confidence: high
---

**What is wrong.** Three `budgets.json` rows sit on `status: "unwalked"` with
reasons that describe a blocker which no longer exists. `game-card-preview`'s
reason names it precisely: "the click on the seeded `UI stress — full board,
full hand, deep piles` row times out (`click: Timeout 8000ms exceeded`) …
measured on 2026-09-02 from an EMPTY lobby, with the scenario confirmed present
on the deployment, so it is an actionability problem on the row". It was not an
actionability problem on the row. It was the mulligan dialog still being open.

**Evidence.** `ensureBoard` clicked `button:has-text('Keep')`, and Playwright's
`:has-text()` matches any DESCENDANT text — the board's phase list contains
"Up**keep**", so the selector resolved to the phase-list toggle and left the
mulligan prompt up. Every later click on the board then timed out against
`<div data-slot="dialog-overlay">`, wherever in the walk it happened to fall.
The same walk also picked the first selectable Deck Shelf tile, which is a
"Your decks" row — including the three-card decks this lane's own
`deck-builder` walk leaves behind — and a solo game on one of those is a draw
by decking before the first priority, i.e. a second modal scrim from a second
cause. Both are fixed in `scripts/ui-gate/surfaces.ts` (`button:text-is('Keep')`,
`selectPlayableDeck`), and the new `game-debug-sheet` surface — which reaches
the board through the same `ensureStressBoard` and loads that exact scenario
row — walks green at all five viewports.

**Why it may not deserve its own issue.** Closing those rows is a recording
exercise, not a fix: each needs a `--record` run from an empty lobby plus a
`knownDebt` note for whatever the fixed stress position measures, and
`game-board`'s own reason still stands on its merits (a dealt solo game lands
on a position nobody chose, and its `cardsOcc` flapped 4→5 on one unchanged
tree). So this is at most two rows — `game-stress` and `game-card-preview` —
and it may be a line on whatever tracker owns the lane's coverage rather than a
ticket of its own.
