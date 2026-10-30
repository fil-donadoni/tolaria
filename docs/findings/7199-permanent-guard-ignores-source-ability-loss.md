---
title: permanent-guard keeps guarding after its source loses all abilities
discoveredBy: 7199
status: draft
confidence: high
---

**What is wrong.** `isGuardedAgainst` (`convex/gre/permanentGuard.ts`) reads the
source's DEFINITION `staticEffects` and never checks whether the source has lost
its abilities (`abilitiesSuppressedBy`, CR 613.1f). A Guardian Beast under
Humility still makes artifacts indestructible. The same goes for issue #7199's
`survivesZeroLoyalty`: a Sanctum Lurker turned into a vanilla Frog still
protects walkers from the CR 704.5i SBA.

**Evidence.** `permanentGuard.ts`, the `for (const source of player.battlefield)`
loop: `tryGetDefinition(cardId)?.staticEffects`, with no suppression check. By
contrast, `getEffectiveActivatedAbilities` (`gre/activatedAbilities.ts`) applies
ability loss per timestamp.

**Why it may not deserve its own issue.** The gap predates issue #7199 and
covers every guard clause. It is defensible without any card, so it is probably
worth a ticket: skip a source whose abilities are suppressed (timestamp-aware,
as `grantOutrankedByAbilityLoss` does), plus a test on one clause.
