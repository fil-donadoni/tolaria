---
title: The deckbuilder's "deck pane ≥60% of the height" needs the PANE SPLIT, and no chrome lever can reach it
discoveredBy: 2585
status: draft
confidence: high
---

**What is wrong.** #2585's one measurable acceptance criterion — _"deck pane
≥60% of the height at 1180×820 and 1440×900"_ — is **unmet on the merged
branch, and unreachable by every lever the issue and the previous finding doc
named**. The deck pane is structurally capped at **half** the post-chrome
column: `deck-builder-shell.tsx:243,268` makes the source panel and the zones
pane both `flex-1 basis-0` siblings of one flex column, and this PR does not
touch that file. Measured shares are ≈39% at 1440×900 and ≈33% at 1180×820.

The lever that _can_ reach it is the one clause of the issue nobody costed:
**"the preview becomes a dock"** — i.e. the source pane stops being an equal
half of the vertical stack. That is a screen-SHAPE decision (it trades the
Maindeck's width for its height), not a chrome tidy-up, which is why it is
recorded here instead of being slipped into a fixup round.

**Evidence — the arithmetic, at both AC viewports.**

Chrome (header band + ADD BASIC bar + legality band + `SaveDeckBar`) and the
free column left under it:

| viewport | chrome | free column | free as % of viewport |
| -------- | ------ | ----------- | --------------------- |
| 1440×900 | ~192px | 708px       | 78.7%                 |
| 1180×820 | ~284px | 536px       | 65.4%                 |

A 50/50 split therefore gives the deck 354px (39.3%) and 268px (32.7%). For the
deck to reach 60% of the viewport it needs 540px and 492px, so the **source
pane's whole budget** is:

- **1440×900 → ≤168px**
- **1180×820 → ≤44px**

One row of search results costs `CARD_BASE * 7/5` plus the results count
header. `CARD_BASE = max(4.5rem, min(8rem, 18vw, 9.5dvh))` (`cardSizing.ts`), so
the `9.5dvh` term binds at both: 85.5px core → ~120px tile at 900 tall, 77.9px
core → ~109px tile at 820 tall; ~150px and ~137px with the header.

- At **1440×900** a one-card-row dock (150px) fits the 168px allowance. The
  vertical axis can just about do it — with 18px of margin, which is thinner
  than the error bar on the chrome figures above (they are arithmetic from the
  source, not a probe reading).
- At **1180×820** the allowance is **44px** — a third of one card tile, and
  exactly the ADR 0101 §2 coarse-pointer control rung with nothing left for a
  label. **No vertical split reaches the AC there.** Even a source pane of
  height ZERO leaves the deck at 536/820 = 65.4%, so the entire margin the
  screen has is 5.4 points.

**Why the two levers the previous finding named cannot close it.** Folding the
zone toolbar (`deck-zone-surface.tsx:541`) changes nothing: it lives INSIDE the
zones pane, so collapsing it enlarges the card-pile strip within a fixed share.
Folding the ADD BASIC bar (~45px) and the legality band (~33px) is worth 78px of
chrome. Stack **all** of them and add a minimum one-row dock:

    1180×820: chrome 284 − 78 = 206 → free 614 → deck 614 − 137 = 477 = 58.2%

Still short. Every named lever, applied together, lands under the bar.

**What would actually satisfy it.** The source pane leaves the vertical axis at
tablet-landscape and desktop widths — a side dock / column split, search on one
side and the deck on the other. The deck then owns the whole free column:
708/900 = **78.7%** and 536/820 = **65.4%**, both clear. The cost is real and is
the decision to take: at 1440×900 the zones pane loses ~40% of its WIDTH, and
width is what the Maindeck's MV columns spend (`--split-main`,
`deck-zones-surface.tsx`) — the pane would go from ~7 columns to ~4. Height for
width is a product call on what a deckbuilder is for, and it needs a browser
measurement at all five viewports plus a `scripts/ui-gate/budgets.json`
re-record for the two cells it moves.

**Why it may not deserve its own issue.** It is not a bug — it is the unbuilt
half of #2585's own scope, and PRD #2405 has 16 slices of which this is 6. The
right home is probably whichever later slice owns the deckbuilder's tablet /
desktop geometry, alongside "toolbar collapsed into the bar" from the same ADR
0101 §7 sentence, rather than a ticket that re-opens #2585. What must NOT happen
again is the shape this doc replaces: a deferral that named levers which cannot
reach the number, leaving the AC reading as merely postponed.
