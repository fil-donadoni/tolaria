---
title: BattlefieldCard (battlefield-card.tsx) is dead code with the same tap-rotation bug this issue fixed
discoveredBy: 1994
status: draft
confidence: high
---

**What is wrong.** `src/components/board/battlefield-card.tsx` exports a
default component `BattlefieldCard` that applies a bare
`transform: tapped ? "rotate(90deg)" : "rotate(0deg)"` on a `position:
absolute; inset: 0` inner element filling the card's full 5:7 box — the exact
same footprint-overflow shape fixed in `board-battlefield-card.tsx` for issue
#1994 (a tapped card's rotated bounding box swaps to 7:5, wider than its own
slot, and can paint/hit-test over a neighbour).

**Evidence.** `grep -rln "^import BattlefieldCard" src/` (default-export
import, as opposed to the `CardVisualState`/`ActivatableAbility` _type_
imports several files carry from this module) returns nothing — no
production component, and no test file either (there is no
`__tests__/battlefield-card.test.tsx`), ever renders it. The spatial board
(`board-battlefield.tsx`, the only battlefield renderer `board.tsx` mounts)
calls `BoardBattlefieldCard` (a different file, `board-battlefield-card.tsx`),
never `BattlefieldCard`. `manual-board.tsx` (the debug/manual board) has no
`rotate`/`BattlefieldCard` references at all — it doesn't render rotated
cards.

**Why it may not deserve its own issue.** It costs nothing at runtime (dead
code, tree-shaken or simply never invoked) — the risk is purely maintenance
confusion (a future reader might "fix" the bug there believing it's live, or
duplicate work). Cheapest resolution is likely either (a) delete the file and
re-home its two exported types (`CardVisualState`, `ActivatableAbility`) onto
`board-battlefield-card.tsx` or a shared types module, or (b) apply the same
`TAPPED_ROTATE_SCALE` fix there too for consistency if it turns out something
does still reach it that this quick grep missed. Low urgency either way — a
line on a cleanup tracker rather than a standalone ticket.
