---
title: Bot values the chosen-type / chosen-colour cards off their payoff
discoveredBy: 3809
status: draft
confidence: medium
---

**What is wrong.** Three valuation seams around issue #3809's cards:

- Zombie Boa's `delayedTrigger` body (`destroy $event.blockerId`) is priced as
  full board removal by `victimUnitsFor`, so the Bot may pay {1}{B} every main
  phase whether or not it will attack; no colour prior exists (`colorMode` is
  set only for protection modes), so the pick is pure rollout.
- Unnatural Selection is `chooseCreatureType` + `setSubtype`, both valued ZERO
  (`opValuers.ts`), so the Bot activates it only if search finds a payoff.
- Brass Herald's as-enters pick uses `subtypeModePrior`, which counts types on
  BOTH battlefields and can open on the opponent's dominant type.

**Evidence.** `convex/gre/ai/opValuers.ts` (`delayedTrigger`, `destroy`,
`setSubtype`, `chooseCreatureType`); `convex/gre/ai/choicePriors.ts`
(`subtypeModePrior`).

**Why it may not deserve its own issue.** Each is a magnitude/prior question,
not a freeze; a delayed-body discount for conditional watches would be the
class fix and could ride an existing Bot valuation tracker.
