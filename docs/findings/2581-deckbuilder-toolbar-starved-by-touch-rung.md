---
title: The deck-builder card-pile strip is starved at 3 of 5 viewports, and the 44px touch rung makes it 4
discoveredBy: 2581
status: draft
confidence: high
---

**What is wrong.** `/decks/create` renders each zone's card columns into a
`flex flex-1 items-start gap-3 overflow-auto` strip
(`src/components/deckbuilder/deck-zone-surface.tsx:590`) that takes whatever
height the chrome bands above it leave, and never grows to its content. That
strip — not the toolbar — is what the lane's `starved` probe flags (a scroll
container shorter than 0.9x its tallest child,
`scripts/ui-gate/probe.js:76-91`). It has been starved at `1440x900x2` and
`1180x820x2` since the budgets were first recorded, on a FINE pointer.
Shipping ADR 0101's pointer rung — `--control-h: 44px` under
`@media (pointer: coarse)` — makes it starved at `820x1180x2` too.

**The mechanism, precisely.** The rung did **not** make the strip's contents
taller. Its two children are `DeckColumnPile` (a label row plus a box sized
`height: pileHeight(n)` over absolutely-positioned tiles,
`deck-column-pile.tsx:84`) and `DeckColumnActions` (bare `<button>`s and an
`.input-field` that #2581 leaves alone). Nothing in that subtree reads
`--control-h`, and its tallest child measures **228px before and after**.

What the rung shrank is the **window**. The chrome ABOVE the strip grew:
`ZoneCreatureFilterSelect` (`deck-zone-surface.tsx:518`) became a
`.segment-pill` at `min-height: var(--control-h-sm)`, which is 40px on a
coarse pointer instead of its previous `py-1` height, and the `Button` rungs
grew with it. The strip is the `flex-1` sibling that absorbs the remainder, so
every pixel the header takes comes straight out of it: 171px left, against an
unchanged 228px child.

**Evidence.** Measured with `bun run check:ui`, one variable changed:

| viewport   | window (clientHeight) | tallest child | starved                                      |
| ---------- | --------------------- | ------------- | -------------------------------------------- |
| 1440x900x2 | 157                   | 182           | yes (pre-existing, fine pointer)             |
| 820x1180x2 | 171                   | 228           | yes — was `starved 0` before the coarse rung |
| 1180x820x2 | 57                    | 168           | yes (pre-existing, fine pointer)             |

Neutralising only the coarse rung (`--control-h: var(--control-h-fine)` inside
the `pointer: coarse` block, `src/index.css`) returns `820x1180x2` to
`starved 0` with **every other number on the surface unchanged** — so the rung
is the trigger and the strip is the defect. The ceiling was raised to 1 for
that one cell in `scripts/ui-gate/budgets.json`, with a `knownDebt` that now
names the real container.

**Tuning the rung cannot fix this cell.** The probe clears at
`clientHeight >= 0.9 * 228 = 205px`, so the strip needs **34px of chrome
height back**. Dropping the coarse rung to the 32px fine height returns only
~8px per control row — and it returns it by giving up the 44px WCAG 2.5.8
target that is the whole point of ADR 0101 §2. The height has to come from the
header disappearing, not from shrinking it.

**Which is exactly what #2585 does.** "Deckbuilder filters: bottom sheet
(phone) / popover (tablet, desktop) + applied-filters tag row; tablet/desktop
deck ≥60% height" moves this chrome off the band entirely. When it lands, this
cell's slack in `budgets.json` should be deleted and the row re-recorded — and
the 1440x900 and 1180x820 cells, which #2585 also owns, should clear with it.

**Why it may not deserve its own issue.** #2585 already owns the surface, the
mechanism and the acceptance criterion ("deck ≥60% height" is the same number
this measurement expresses from the other side). This is a line on that
ticket — a measurement to check against — not a second ticket. It earns its
own issue only if #2585 slips far enough that `820x1180x2` is worth fixing
alone, which is unlikely: the same cell already carries 9 STRANDED controls, a
strictly worse defect on a hard floor.
