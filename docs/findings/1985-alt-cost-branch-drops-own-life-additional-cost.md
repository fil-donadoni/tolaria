---
title: announceCast's no-target alt-cost branch never folds the card's own life additional cost into altPayLife
discoveredBy: 1985
status: draft
confidence: medium
---

**What is wrong.** `finalizeTargetSelection` (the targeted commit path) folds
`additionalCostLifePayment(effectiveAdditionalCosts, chosenX)` into its single
`payLife` accumulator unconditionally — so the card's own "pay X life" / "pay
N life" additional cost (CR 601.2b / 118.4, e.g. Fire Covenant, Fumarole) is
paid even when an alternative cost is also chosen. `announceCast`'s no-target
alt-cost branch computes its own `altPayLife` from only two terms —
`chosenAltCost.life` and `kickerLifeCost(...)` — and never includes
`additionalCostLifePayment(effectiveAdditionalCosts, chosenX)`.

**Evidence.** `convex/game.ts` — compare the targeted path's `payLife`
accumulator (includes `additionalCostLifePayment(effectiveAdditionalCosts,
chosenX)`) against the no-target alt-cost branch's `altPayLife`:

```ts
const altPayLife =
    (chosenAltCost.life ?? 0) + kickerLifeCost(cardDef, kickerPayments);
```

**Why it may not deserve its own issue yet.** Same shape as #1985 (a
card-owned additional cost dropped on the alt-cost no-target branch), but for
the LIFE leg instead of the SACRIFICE leg — and, like #1985's board-wide
sacrifice case before this fix, it is provably unreachable today: every
repo comment consistently asserts "alt-cost cards carry no additional cost of
their own" (mmq/black.ts, kicker.ts, and the no-target branch's own comments
all repeat this), and I found no shipped card with both `alternativeCosts`
and a life-based `additionalCosts` entry. Unlike Drought's sacrifice (which
IS board-wide and therefore reachable via any alt-cost card), there is no
board-wide LIFE additional-cost mechanism in the engine (`StaticAdditionalCost`,
`convex/cards/types.ts:7288`, is sacrifice-only) — so this gap has no
board-wide trigger at all, only a hypothetical future card-owned one. Worth a
one-line fix (`altPayLife += additionalCostLifePayment(effectiveAdditionalCosts,
chosenX)`) the day a card needs it, but adding it now would be untestable
against any real card and untested code is exactly what #1985's own review
guidance warns against shipping.
