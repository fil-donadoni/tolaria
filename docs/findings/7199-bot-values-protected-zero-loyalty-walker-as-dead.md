---
title: Bot values a walker protected from the zero-loyalty SBA as dead
discoveredBy: 7199
status: draft
confidence: medium
---

**What is wrong.** A `permanent-guard` with `survivesZeroLoyalty` keeps a
planeswalker on the battlefield at 0 loyalty (CR 704.5i exemption, issue #7199).
The Bot's evaluation does not know: `loyaltyRatioFor`
(`convex/gre/ai/loyaltyValue.ts:117`) gives `min(0, ceiling) / start = 0`, so
`evaluate.ts` values the walker at about 0 though it still offers a `+N` every
turn, and `walkerDamagePrice` (`evaluate.ts`, around line 2176) charges the
walker's whole realised value whenever `damage >= loyalty`, pricing a protected
walker as killed.

**Evidence.** Review of issue #7199's PR. Reachability is fine: `enumerateMoves`
offers the granted loyalty ability and the search applies SBAs through
`checkStateBasedActions`, which honours the guard. Only the valuation is off.

**Why it may not deserve its own issue.** No shipped card declares
`survivesZeroLoyalty` yet. The first one (Sanctum Lurker, Hand Tail issue #7247)
is where the Bot walk would surface it. It could be a line on that issue instead
of a ticket. Fix sketch: both readers ask `isGuardedAgainst(state, walker,
"survivesZeroLoyalty")`.
