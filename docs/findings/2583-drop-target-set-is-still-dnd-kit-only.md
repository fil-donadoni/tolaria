---
title: The [data-drop] drop-target set exists in the engine but no shipped droppable carries the attribute
discoveredBy: 2583
status: draft
confidence: medium
---

**What is wrong.** The gesture engine resolves a touch drop with
`document.elementFromPoint` walked up to the nearest `[data-drop]` ancestor
(`src/lib/gesture/drop-targets.ts:32`). Every droppable region on a shipped
editing surface today registers with **dnd-kit** instead — `useDroppable`, which
keeps its own registry and its own collision detection and puts no attribute in
the DOM. So the two drop-target sets are disjoint: the engine's `dropIdAt` would
return `null` over every real drop region in the app.

That is harmless right now (no shipped surface drives its drags through
`useGestureEngine` — the Draft Room and the deckbuilder both still use dnd-kit as
the transport, which is what issue #2583 explicitly allows), but it means the
`[data-drop]` set is declared and untested against reality. The first surface to
adopt the engine has to add the attribute to every one of its drop regions in the
same change, or its drags will silently drop on nothing.

**Evidence.** `grep -rn 'data-drop' src/` outside `src/lib/gesture/` and its
tests returns nothing. The four droppable hosts are
`src/components/deckbuilder/deck-column-pile.tsx:60`,
`src/components/deckbuilder/deck-zone-surface.tsx:445`,
`src/components/limited/limited-draft-pool.tsx:70` and the Sideboard pane inside
`deck-zone-surface.tsx` — all `useDroppable`. The engine's own test supplies the
attribute itself (`src/lib/gesture/__tests__/useGestureEngine.test.tsx:38`), so
the suite proves the walk works but not that anything in the app is walkable.

**Why it may not deserve its own issue.** The natural home for this is the first
surface-adoption slice (PRD #2405, slices 5+), which has to touch those four
hosts anyway — a separate ticket to "add `data-drop` attributes" would land
attributes nothing reads, which is worse than the current honest gap. It earns a
ticket only if the adoption slices are deferred and someone wants the attribute
set in place as a guard (`dropTargetProps` beside every `useDroppable`, with a
catalogue test that the two registries agree).
