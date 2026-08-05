---
title: tappedFootprintWidth's widths[] reservation only guards a tapped permanent's RIGHT neighbour, not its left one
discoveredBy: 1994
status: draft
confidence: medium
---

**What is wrong.** The row layout (`rowLayout` / `splitRowLayout`,
`src/lib/board-layout.ts`) reserves a tapped permanent's rotated footprint by
widening ITS OWN `widths[]` entry (`tappedFootprintWidth`). That footprint
grows rightward from the item's own (unrotated) box left edge — the exact
convention `stackFootprintWidth` established for a fanned stack (issue #977),
reused here rather than reinvented, per review guidance on PR #2279.

But a rotated card's overhang is geometrically SYMMETRIC (24px on each side
at the default 120px card width — `(CARD_HEIGHT − CARD_WIDTH) / 2`), while the
`widths[]` reservation is asymmetric (rightward only). Concretely: item `i`'s
box left edge is fixed at `leftEdge_i` regardless of item `i`'s own footprint
entry — only item `i-1`'s footprint controls how far right `leftEdge_i` sits.
So when item `i` is tapped, its rotated box's LEFT edge sits
`(tappedFootprintWidth − cardWidth) / 2` px to the left of `leftEdge_i`
(24px at default scale) — outside the reservation entirely, exactly the same
amount it overhung BEFORE this fix.

In the default DOM stacking order (no explicit `zIndex` — the common case for
a permanent with no attached aura/exile-held card, `board-battlefield.tsx`'s
`hostHasAttachments`), a LATER item paints on top of an EARLIER one. So a
tapped item's unprotected LEFT overhang can still visually/hit-test cover the
permanent immediately before it in the row — which is the reported bug's
literal shape ("a tapped land visually covering an untapped fetchland"),
if the fetchland was played earlier (and so sits earlier in
`player.battlefield`, hence earlier in the row) and the tapped mana land was
played later.

The RIGHT side is fully protected by this fix (and slightly over-reserved):
a tapped item's own widened footprint pushes the FOLLOWING item clear, which
is what `board-battlefield-tapped-footprint.test.tsx` proves. The LEFT side
is not — no test in this PR exercises that direction because doing so
requires an ordering assumption (which item is later in `player.battlefield`)
that the fix doesn't currently make.

**Evidence.**

- `src/lib/board-layout.ts` — `rowLayout`'s accumulator: `x = leftEdge + halfBox;
leftEdge += w[i]*scale + onScreenGap;`. Item `i`'s box position depends on
  `w[i-1]`, never `w[i]`.
- `src/components/board/spatial-slot.tsx` — `zIndex: snap ? LIFTED_CARD_Z :
zIndex`, and `zIndex` is only set by `board-battlefield.tsx`'s
  `hostHasAttachments` check; a plain tapped land with no attached aura/exile
  gets no explicit z-index, so DOM order (= row left-to-right order) decides
  paint order, later-on-top.

**Why it may not deserve its own issue yet.** The review on #2279 explicitly
asked for "a tapped permanent reserving cardHeight instead of cardWidth" —
this fix does exactly that, following the #977 precedent literally, and it
demonstrably fixes the DISCLOSED blocking regression (the undisclosed global
shrink) which was the actual gate. Whether the residual left-side gap is a
real, reproducible click-stealing bug in practice depends on battlefield
ordering patterns this repo doesn't currently test or document (does a newer
permanent reliably render after an older one in `player.battlefield`? for
lands specifically, `backRowRank` only sorts lands-before-noncreature, not by
play order) — that's design/behavioral research, not a one-line fix. A full
symmetric fix would need either (a) a genuinely new reservation shape (extra
margin BEFORE an item, which `widths[]`'s "grows rightward" convention
doesn't express), or (b) centering the box within its reservation instead of
left-flush (which would change `stackFootprintWidth`'s fan-anchor semantics
too, since fans and taps would then need different anchor conventions on the
same array). Either is a bigger design change than this fixup's scope.
