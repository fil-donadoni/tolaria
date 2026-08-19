---
title: TriggeredAbility and AbilityMode still cannot declare additional target groups
discoveredBy: 2361
status: draft
confidence: low
---

**What is wrong.** `additionalTargetRequirements` (CR 601.2c — several targets of
DISTINCT descriptions in one announcement) now exists on three of the five
places a target requirement can be declared: `CardDefinition`, `SpellMode` and —
added by this issue for Oko, Thief of Crowns' `−5` — `ActivatedAbility`. It is
still missing on `TriggeredAbility` and on `AbilityMode` (the per-mode
requirement of a modal activated/triggered ability). Both build a `PendingTarget`
from a single requirement and never set `remainingRequirements`, so a trigger
whose Oracle line names two differently-filtered targets cannot be expressed at
all.

**Evidence.** `convex/cards/types.ts:8844` (`TriggeredAbility.targetRequirement`)
and `convex/cards/types.ts:889` (`AbilityMode.targetRequirement`) have no
`additionalTargetRequirements` twin. `raiseTriggerTargetSelection`
(`convex/gre/rules.ts:3169-3173`, building the pending target at `:3228-3242`)
resolves exactly one requirement. The machinery BEHIND the field is already
generic — `advanceTargetGroupOrFinalize` (`convex/game.ts:5762`) and
`applyRequirementToPendingTarget` (`:5731`) read `PendingTarget` without caring
about `kind`, which is why the activated-ability thread in this PR needed only
the announce-side plumbing.

**Why it may not deserve its own issue.** No card in the catalogue currently
wants it — the gap was noticed by symmetry, not by a blocked implementation. The
right time to add it is when a card demands it, and the work is then two dozen
lines on the trigger announce path, not a project. Filing it now would put an
un-demanded capability in the queue.
