---
title: The deckbuilder and the lobby search grid lost their touch read path with no Peek Panel to replace it
discoveredBy: 2583
status: draft
confidence: high
---

**What is wrong.** Issue #2583's acceptance criteria require "no hold-preview on
editing surfaces", and the change delivers that: `holdPreview={false}` now sits
on the deckbuilder tile, the Draft Room pack card and the lobby search result
card. But the replacement read path — tap → Peek Panel → Inspect — was only
_adopted_ by the Draft Room. On the other two surfaces a touch user now has **no
way at all to read a card's rules text**: the long-press is gone and nothing
took its place.

The Draft Room could adopt in this slice because its tap already MEANS "select"
(ADR 0060, issue #1248) — the gesture core's `tap → select` needed no change of
meaning. On the other two, tap already means something else, which is the census
row that blocked them:

| Surface                                             | What tap means today              | Blocker                                         |
| --------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| `src/components/deckbuilder/deck-card-tile.tsx:88`  | `onClick` = move zone / remove    | Peek-on-tap would need the move to become a CTA |
| `src/components/lobby/deck-builder/result-card.tsx` | `onClick` = quick-add to the deck | same — the add is the tap                       |

**Evidence.** `src/components/deckbuilder/deck-card-tile.tsx:88` binds `onClick`
straight to the surface's move handler, documented at line 39 as "the primary tap
gesture (move zone / toggle)". `src/components/lobby/deck-builder/draggable-card.tsx:11`
documents the same for the lobby: "Fired on a plain click (no drag) — quick-add
or remove." Neither surface renders `PeekPanel`; the only file that does is
`src/components/limited/limited-draft-table.tsx`. The deckbuilder retains its
"Move to…" menu (`deck-card-move-menu.tsx`) and the pack card its right-click
context menu, but a context menu is a mouse affordance and the move menu shows no
rules text.

**Why it may not deserve its own issue.** PRD #2405 is a 16-slice umbrella and
slices 5+ are the surface rewrites — deckbuilder and search are named there, so
this may already be scheduled work rather than a gap. It becomes a ticket only if
those slices are not imminent, because the window in which the two surfaces ship
with no touch read path is exactly the gap between this slice and those. If the
gap is more than one release, the cheap stopgap is to restore
`holdPreview` on those two surfaces until they adopt — the AC's intent is that
hold is the drag, and neither of them routes a hold to a drag through the new
engine yet (both still use dnd-kit's 250ms Delay, which does).
