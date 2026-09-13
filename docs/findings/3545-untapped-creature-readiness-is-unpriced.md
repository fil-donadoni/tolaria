---
title: An untapped creature is worth nothing to evaluate, so a per-pick untap cost always settles to the decline
discoveredBy: 3545
status: draft
confidence: medium
---

**What is wrong.** Paying to untap a creature (Magnetic Mountain's "pay {4} for
each creature chosen this way") is scored as a pure loss. The mana term drops
by the lands tapped to pay, and no term credits the creature being able to
attack or block this turn. `bestBranchThroughChoice` (`convex/gre/search.ts`)
settles the pay-per-pick `may-pay` by material margin, so "choose one creature"
settles to the same position as "choose none".

**Evidence.** The blade entry "choose-permanents: Magnetic Mountain picks exactly
the one creature it can pay for" (`convex/gre/ai/blade/registry.ts`, tier
`stretch`). The `choose-permanents` generator emits the right candidates:
decline, both extremes at max, and both size-1 branches. Measured over five
seeds:

- 2–3/5 seeds pick one creature, at 400 and at 1200 iterations.
- The result is the same at opponent life 20 and at 4, even though at 4 the
  untapped 4-power flier is lethal past two ground Wurms.
- The settled `eval.total` is identical on every branch (781.7).
- On a lopsided board the open-band reward also clips at 1 − terminalBand
  (0.750 on every branch).

**Why it may not deserve its own issue.** Magnetic Mountain is the only shipped
pay-to-untap-a-creature site found in this pass. A readiness term would run on
every ISMCTS leaf in every game, a much larger change than this one card
justifies, unless other readiness gaps (vigilance, untap effects, tap-down
removal) turn out to share it.
