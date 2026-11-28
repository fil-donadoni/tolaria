---
title: Search-world casts never advance the expend tally
discoveredBy: 10354
status: draft
confidence: medium
---

**What is wrong.** The expend tally (`PlayerState.manaSpentOnSpellsThisTurn`,
CR 700.14) advances only when `emitSpellCastEvent` is handed the mana the cast
paid. The real Cast Commit passes it (`castCommit.ts`); the two search-world
emitters do not — `commitCastInSearch` (`convex/gre/applyMove.ts`) and the
dominance probe (`convex/gre/ai/dominance.ts`) call `emitSpellCastEvent(state,
stackItem)` without it. So inside the Bot's lookahead no cast ever expends:
a "whenever you expend 4" payoff (Bark-Knuckle Boxer, Teapot Slinger) never
fires in a rollout, and the Bot cannot value sequencing a second spell to
cross the threshold.

**Evidence.** `emitSpellCastEvent`'s `manaSpentToCast` is optional and the
expend branch is gated on it being defined and positive (`gre/state.ts`). The
real game is unaffected: every graduated expend card is `botReach: played`,
and the trigger fires on the server whenever the Bot really casts.

**Why it may not deserve its own issue.** The search's mana model is coarse
(`searchCastManaSpent` in `gre/searchTapPlan.ts` rebuilds a per-colour record
from the tap plan, only for `noteManaSpent` cards). Passing its total — or the
stack mana value — from `commitCastInSearch` would close it, but it is a Bot
change owing a `must` blade pair (`/bot-change`), so it belongs on whichever
Bot tracker owns trigger valuation in lookahead rather than in the grammar
ticket that shipped the event.
