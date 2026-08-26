---
title: A tapped permanent's rotated box still overhangs the outer EDGE of its zone
discoveredBy: 2725
status: draft
confidence: medium
---

**What is wrong.** A tapped permanent is rotated 90° about its slot centre, so
its painted box is `cardHeight` wide where the row reserved `cardWidth` — about
`0.2 · cardWidth · scale` sticking out on each side. Between neighbours that is
deliberate and harmless (see below). At the two ENDS of a row it is not: the
outermost footprint is placed flush against the zone boundary, the battlefield
`SpatialZone` renders with `overflowVisible` (attackers lift out of the band),
and so a tapped land at the left or right end paints outside the zone it belongs
to — over the plaque column on one side, and into the reserved control-column
gutter on the other.

**Evidence.** `src/lib/board-layout.ts:rowLayout` centres the run inside
`[0, width]` and `splitRowLayout` packs its blocks flush to `0` and `width`;
`src/components/board/board-battlefield.tsx:587` passes `overflowVisible`;
`src/components/board/board-battlefield-card.tsx` (`tapTransform`) applies
`rotate(90deg)` about the slot centre with `pointer-events: none`. Issue #2725's
own acceptance criterion "tapped cards stay inside their zone footprint" is the
half of the story this leaves open.

**Why it may not deserve its own issue.** The obvious fix — reserving the
rotated width per item — is _already rejected_, three review rounds deep and
with browser measurements: `src/components/board/__tests__/board-battlefield-tapped-footprint.test.tsx:1-30`
records that `tappedFootprintWidth` shrank the row's one shared inter-item gap
for every card and took an untapped fetchland's clickable area from 408px² to
0px². The remaining fix is a _different_ mechanism — a zone-EDGE inset of
`(cardHeight − cardWidth)/2` applied once at each end, costing no per-item width
and leaving the inter-item gap untouched — but it moves every flush-left /
flush-right placement in `splitRowLayout`, so it needs its own measured pass
rather than riding along with the sizing rule. It is also purely cosmetic today:
the overhang is `pointer-events: none`, so it steals no clicks and the ui-gate
probe scores it neither `occ` nor `stranded`.
