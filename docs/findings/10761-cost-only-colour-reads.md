---
title: Three colour reads still derive from the mana cost alone, missing a colour indicator
discoveredBy: 10761
status: draft
confidence: medium
---

**What is wrong.** Issue #10761 put a front face's colour indicator on
`CardDefinition.colorIndicator` and folded it into `getCardColors` /
`getEffectiveColors`. Three readers bypass both and still read the mana cost
only, so Living End, Inevitable Betrayal, the Pacts and the Legends Kobolds stay
colourless there:

- `convex/cards/registry.ts` `setColorDefiningCostLookup` (a `ManaCost`, so it
  cannot carry an indicator) → `colorDefiningCostForCardId`, read by
  `cards/abilities/triggers/graveyardEntryTrigger.ts` (colour-filtered "put into
  a graveyard" triggers) and seven per-card helpers (Jihad, `arn`/`fem`/`ice`/
  `inv`/`leg`/`pls` sets).
- `convex/cards/colors.ts` `getCardColorIdentity`: CR 903.4 counts a colour
  indicator in colour identity; the deck builder and draft grouping read Living
  End as colourless.
- `src/lib/ai/bot-view.ts` and `src/lib/ai/selfplay/playGame.ts` build the
  Brain's view colours with `getColorsFromCost(def.manaCost)`, not
  `getCardColors(def)`.

**Evidence.** `graveyardEntryTrigger.ts:148` —
`getColorsFromCost(colorDefiningCostForCardId(cardId))`.

**Why it may not deserve its own issue.** The cards reaching these paths are a
handful (≈15 indicator cards in the catalogue); the lookup's shape change (cost
→ colours) touches seven card modules, and the Bot sites need a `/bot-change`
walk — one small tracker line may be enough.
