---
title: The gesture engine, the drag ghost and the keyboard module ship with no consumer at all
discoveredBy: 2583
status: draft
confidence: high
---

**What is wrong.** Issue #2583 shipped `src/lib/gesture/**` and
`src/components/editing/drag-ghost.tsx` as engine capability with **zero shipped
callers**. `useGestureEngine`, `DragGhost`, `dropTargetProps` and
`editingKeyAction` are imported by their own tests and by nothing else; the only
production importer of `~/lib/gesture` is
`src/components/deckbuilder/useDeckDragSensors.ts`, and it reads three
CONSTANTS, not the engine. So two of the issue's acceptance criteria are
satisfied only against a synthetic fixture:

- "long-press → drag ghost → drop on `[data-drop]` fires the surface callback"
  is exercised in `useGestureEngine.test.tsx`, which supplies the `[data-drop]`
  element itself (see the sibling finding
  `2583-drop-target-set-is-still-dnd-kit-only.md` — no shipped droppable carries
  the attribute).
- "arrows select, Enter primary, S secondary, `/` search" has **no consumer
  whatsoever**. `keyboard.ts` is a pure function nothing calls.

What DID reach a user in this slice: the Peek Panel, the Inspect Overlay, the
hold-preview removal on the editing surfaces, and the sensor-threshold dedup.
Those are wired into the Draft Room and the two deckbuilders and are covered by
surface tests.

**Evidence.** `grep -rn 'from "~/lib/gesture' src/` outside `src/lib/gesture/`
returns exactly two files: `useDeckDragSensors.ts` (constants) and
`drag-ghost.tsx` (a prop TYPE). `grep -rn 'DragGhost\|useGestureEngine' src/`
finds no mounter. This is now pinned by a closed-set assertion in
`src/components/cards/__tests__/editing-surface-hold-preview.test.tsx`
("no shipped surface imports the gesture engine yet"), so the first adoption is
a deliberate edit to that list rather than an accident.

**Why it may not deserve its own issue.** This is the slice boundary PRD #2405
chose, and `.claude/rules/gre-development.md` explicitly permits it: "If
genuinely too large for one PR, slice so intermediate states are engine
capabilities with no card exposing them." Swapping a surface's drag TRANSPORT
from dnd-kit to the engine changes what every drag on that surface does, needs
`[data-drop]` on four droppable hosts, and needs its own five-viewport receipt —
it is the whole of slices 5+, not a fixup. The finding earns a ticket only if
those adoption slices get deferred indefinitely, at which point the right move is
to DELETE the unused engine rather than keep dead code with a test suite.
