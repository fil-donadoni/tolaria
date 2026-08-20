---
title: Landscape-compact pile tiles stay under the 44px coarse-pointer WIDTH floor
discoveredBy: 2589
status: draft
confidence: medium
---

**What is wrong.** `pile-chip.tsx`'s own convention is that the touch-target
floor (WCAG SC 2.5.8) is "governed by the SMALLER of an element's two axes."
For the landscape-compact pile tile (`PILE_TILE_BOX`, 5:7 portrait-card
aspect), the smaller axis is WIDTH. Round-2's fix for #2589 finding 4 floors
the tile at `LANDSCAPE_PILE_TILE_MIN_PX = 32` px WIDTH
(`src/lib/landscape-board-bands.ts`), which restores the HEIGHT to compliant
(32 × 7/5 = 44.8px, fixing the regression this issue's `LANDSCAPE_PILE_SCALE`
cut introduced) but leaves WIDTH at 32px — still under 44, by the same
convention this codebase otherwise applies to touch targets.

**Evidence.** `landscapeCardMetrics(390).cardWidth` is 46; at
`LANDSCAPE_PILE_SCALE = 0.5` the raw tile is 23px wide, floored to 32px by
this round's fix. A true 44px-WIDE floor was evaluated and rejected for
budget reasons — see the doc comment on `LANDSCAPE_PILE_TILE_MIN_PX`: it
costs +21px of the ≤25% right-rail width budget (`landscape-board-bands.test.ts`
"phone-landscape width budget"), on top of the ~9px `LANDSCAPE_PILE_TILE_MIN_PX=32`
already spends and the finding-7 nameplate fix's own (zero-budget-cost) padding
trim — arithmetically impossible to fit inside the ~3px of headroom the budget
has left after this round's changes.

**Why it may not deserve its own issue yet.** WIDTH was 32.2px before #2589
too (pre-issue scale 0.7) — this is NOT a regression #2589 introduced, only a
pre-existing gap this round's fix restores parity with rather than closes. A
real fix needs either (a) a genuine hit-slop (an invisible padded hit box,
the `minimize-choice-button.tsx` `before:-inset-2.5` pattern) sized to clear
44px on the narrow axis without enlarging the visual tile — but the pile
column's own geometry doesn't have room for it: only ~8px of gap exists
between the battlefield's right edge and the piles' left edge, and only 4px
(`gap-1`) between stacked tiles, both well under the ~10-15px inset a
symmetric hit-slop would need at the smallest board heights
(`LANDSCAPE_MIN_CARD_H = 40` → an 14.5px-wide raw tile) — so a naive hit-slop
would swallow taps meant for battlefield cards or a neighbouring pile tile;
or (b) redesigning the pile column's layout (e.g. wider gaps, fewer
simultaneous tiles, a scroll-snap single-tile view) to make room for a real
44px hit box, which is a bigger design change than a fixup round should carry
un-discussed.
