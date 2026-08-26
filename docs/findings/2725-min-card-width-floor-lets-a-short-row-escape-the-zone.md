---
title: MIN_CARD_WIDTH's scale floor lets an interior footprint escape the zone on a short landscape board
discoveredBy: 2725
status: draft
confidence: high
---

**What is wrong.** `src/lib/board-layout.ts:146` sets `MIN_CARD_WIDTH = 28`, and
`zoneFitScale` turns that into a _relative_ scale floor —
`scaleFloor = min(1, minCardWidth / cardWidth)` (`src/lib/board-layout.ts:199`).
Main's floor was the flat `MIN_SCALE = 0.7`. So for any zone whose **base** card
is narrower than 40px (28 / 40 = 0.7) the new floor is **higher** than main's,
and the row is allowed to shrink **less** than it used to. Whatever the shrink
cannot absorb is then dumped into the row's ONE shared inter-item gap
(`onScreenGap`, `src/lib/board-layout.ts:303`). That gap is derived so the
_whole run_ spans exactly `width` — first left edge at 0, last right edge at
`width` — but it says nothing about the edges in between. With **heterogeneous**
footprints (a 1-card group next to a 7-card fan) an interior footprint's own
edge escapes the zone, which contradicts the invariant this PR's own module
comment now asserts: _"Nothing is ever placed off the board"_
(`src/lib/board-layout.ts:19-20`).

**Evidence.** Two measurements, `rowLayout` with real
`stackFootprintWidth(n, cardWidth)` entries, zone `0..620`, edges taken as
`min`/`max` over **all** items (not just the first and last):

| groups              | cardWidth | main                  | this PR                     |
| ------------------- | --------- | --------------------- | --------------------------- |
| `[1,7,7,7,7]`       | 34        | L=0.0 R=620.0 s=0.700 | **L=−20.0** R=620.0 s=0.824 |
| `[7,7,7,2,2,1,1,1]` | 31        | L=0.0 R=620.0 s=0.794 | L=0.0 **R=629.5** s=0.903   |

In both, the PR's `scale` is _exactly_ the legibility floor (28/34 = 0.8235,
28/31 = 0.9032) — the floor is what binds. Case 1: the row's first footprint is
one 28px card while the shared gap is −48px, so item 1's left edge lands at
−20.0. Case 2: item 4 (a 2-card fan, w=65) has its right edge at 629.5 while the
run's _last_ item still ends at 620.0 — the overflow is interior and invisible
to a first/last check.

Reproduce (`bunx tsx`, from the repo root):

```ts
import * as L from "./src/lib/board-layout";
const cw = 34,
    width = 620,
    groups = [1, 7, 7, 7, 7];
const w = groups.map((n) => L.stackFootprintWidth(n, cw));
const p = L.rowLayout({
    count: w.length,
    width,
    centerY: 0,
    cardWidth: cw,
    widths: w,
});
const half = (cw * p[0].scale) / 2;
console.log(Math.min(...p.map((q) => q.x - half))); // −20
console.log(Math.max(...p.map((q, i) => q.x - half + w[i] * p[0].scale))); // 620
```

`splitRowLayout` reproduces the identical numbers at every split point, because
the two blocks collide at these counts and it falls back to the same centred
`rowLayout` (`src/lib/board-layout.ts:418-427`) — the fallback is not a second
chance at fitting, it is the same math.

**The regime where it bites.** Only where the base card is under ~40px wide,
i.e. the landscape-compact band: `landscapeCardMetrics` (
`src/lib/landscape-board-bands.ts:227`) returns `cardWidth` 29..39 for board
heights up to ~344px (h280→31, h300→34, h340→39, h345→40). Swept over
`[1,7,7,7,7]` at width 620: cw28 → L=−56.0, cw31 → −36.3, cw34 → −20.0,
cw39 → 0.0, and 0.0 at every larger card. Above the crossover this PR is
strictly better than main: at cw120 **main** itself puts an interior edge at
L=−8.8 while the PR holds 0.0. So this is not a bug the PR introduces — it is a
pre-existing weakness in the shared-gap residue model whose reachable window the
new floor _moves_ from very-large cards to very-small ones.

**Why it is unreachable today.** The five gated viewports (ADR 0101) put
`cardWidth` at 46 (844x390 landscape phone), 69 (tablet landscape) and 120
(desktop, non-compact) — all at or above the crossover, all measuring L=0.0 /
R=620.0 under this PR. A board short enough to reach cw ≤ 39 is under ~345px
tall, which no gated viewport produces. That is why it does not block: the lane
cannot see it, and the surfaces it _can_ see are improved by the same change.

**Why it may not deserve its own issue.** No user reaches it at any supported
viewport, main is not immune to the same mechanism at the other end of the card-
size range, and the honest fix is not a constant tweak but a change to how the
residue is distributed — which is a bigger design call than a bug ticket wants.
It may be better as a line on the ADR 0103 follow-up than a ticket of its own.
If it does become one, the shape of the fix: stop expressing the residue as one
uniform gap. Either allocate the overlap **proportionally to each item's own
footprint** (so a 28px singleton is not asked to absorb a 48px overlap sized for
its 196px neighbour), or run a final monotone clamp pass that pins every
placement's footprint into `[0, width]` — and, either way, make the guarding
test measure `min`/`max` over **all** items, since the existing bound checks
look only at the ends and are blind to case 2.
