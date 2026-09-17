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

**Also noted in review (same reach condition — no multi-mode card ships yet):**

- **Divide-as-you-choose across instances.** `divideTotal` is computed for the
  primary group only and `applyRequirementToPendingTarget` clears
  `divideAmounts` between groups, so a divide mode that is not the first group
  falls back to the ≥1-each auto split; `targetAmounts` is keyed by target, so
  two instances dividing onto the same object collide.
- **CR 608.2b filter re-check** (`resolvingTargetRequirement`,
  `spellTargetStillMeetsRestrictions`) skips an item with several instances,
  like the existing additional-group carve-out. `modeTargetCounts` makes an
  exact per-instance re-check possible now.
- **Mode legality for abilities** (`modeHasLegalTargets`) does not apply
  `effectiveRequirementForSource` / source power; it only sizes the CR 609.3
  shortfall, while the real per-group check still runs.
- **CR 609.3 at announcement** is ADR 0094's reading (700.2a only forbids an
  illegal mode); worth checking against the Oracle rulings of the first
  "Choose two" card issue #2266 ships.
