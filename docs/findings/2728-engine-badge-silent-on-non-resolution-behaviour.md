---
title: the Engine View badge is silent about behaviour that is not a resolution body
discoveredBy: 2728
status: draft
confidence: medium
---

**What is wrong.** `computeEngineViewBadge` classifies a card by its
RESOLUTION bodies only — `resolve` / `resolveSteps` / the mana-ability
`effect` closure / `effects[]` / the `EffectShorthand`. Everything else a
definition can carry is invisible to it: `drawReplacement` and the other
replacement effects (CR 614), `staticEffects[]` (the layer system, CR
611/613), `staticAbilities[]` keywords. After PR #2845 such cards render
`{ kind: "none" }` — the slot with no chip, which is honest (no claim made)
rather than wrong; but Hullbreacher, whose whole behaviour is a replacement
effect with a hand-written `applies` predicate, presents the same empty chip
area as a French-vanilla Grizzly Bears.

**Evidence.** `src/lib/preview-body.ts` `resolutionSites()` /
`hasHandWrittenBody()` — neither reads `drawReplacement`, `staticEffects` or
`staticAbilities`. `convex/cards/sets/cmr/blue.ts:35` (Hullbreacher) is the
witness: a `drawReplacement` with an `applies` closure and a declarative
`redirect-to-token` outcome, and no resolution body anywhere.
`src/lib/__tests__/engine-view-badge.catalogue.test.ts` pins the same card as
`none`, because the deep-walk oracle deliberately stops at a nested
`TokenSpec` (the Treasure's mana closure is the Treasure's body, CR 111.1).

**Why it may not deserve its own issue.** #2704 is already chartered to fill
`[data-engine-view-tree]` with the real keyword / target / effect / triggered
/ activated tree read off the same `CardDefinition` — static effects, keywords
and replacement effects are precisely what that tree is for, so this may
resolve itself with no separate work. Inventing a fourth badge kind now
("static", "replacement") would also likely collide with whatever vocabulary
#2704 lands.
