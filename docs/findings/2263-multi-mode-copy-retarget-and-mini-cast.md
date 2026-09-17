---
title: A copy of a multi-mode spell is never offered new targets, and a resolution-time cast picks exactly one mode
discoveredBy: 2263
status: draft
confidence: high
---

**What is wrong.** Two announcement-adjacent paths still assume one mode
instance now that ADR 0094 lets a mode list choose several.

1. **Copy retarget (CR 707.10c).** `requestCopyRetargetOn` and
   `requestCastCopyRetarget` (`convex/gre/state.ts`) rebuild ONE requirement for
   the copy. With more than one chosen instance there is no single requirement,
   so they read the card-level one — undefined for a modal card — and return
   without prompting. The copy keeps the original's targets (CR 700.2g copies
   the modes and their spans correctly; `modalCardinality.test.ts` pins that),
   but its controller is never asked whether to choose new ones.
2. **Resolution-time casts.** Word of Command (`lea/black.ts`) and the
   cast-during-resolution Op (`effects/interpreter.ts`, the `cdr:mode` prompt)
   ask a single `requestOptionChoice` for the mode and pass
   `chosenModeIds: [id]` to `castChosenSpell`. A card whose `modeSelection`
   demands two modes would be cast with one, bypassing
   `validateChosenModeIds` entirely.

**Evidence.** `soleChosenModeId(copy.chosenModeIds)` is the guard in both
retarget producers; `castChosenSpell` writes `opts.chosenModeIds` straight onto
the stack item with no cardinality check.

**Why it may not deserve its own issue.** No shipped card declares a
`modeSelection` yet — issue #2266 ships the first four (Fiery / Mystic
Confluence, Kolaghan's Command, Flame of Anor), and none of them is copied or
mini-cast by anything in the pool today. It could be a line on PRD #2261 until
one of those interactions is reachable.
