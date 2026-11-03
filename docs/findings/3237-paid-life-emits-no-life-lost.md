---
title: Paying life emits no LIFE_LOST event, so "whenever you lose life" never sees a life payment
discoveredBy: 3237
status: draft
confidence: medium
---

**What is wrong.** CR 119.4: "If a player pays life, the payment is subtracted
from their life total; in other words, the player loses that much life." A
"whenever you lose life" trigger therefore fires on a life payment. Every
life-cost leg (Phyrexian pips, `cost.life`, the caster-chosen additional cost's
`payLife`, granted mana abilities) lowers the total through `payLifeCost`
(`convex/gre/state.ts`) and no `LIFE_LOST` event is queued — only
`loseLifeEmitting` and the damage sinks emit one.

**Evidence.** `payLifeCost` (issue #3237) feeds the per-turn
`lifeLostThisTurn` tally but deliberately leaves the event alone: emitting it
would newly fire `lifeLostTrigger` cards (Oath of Lim-Dûl, ICE) off cost
payments, a behaviour change that wanted its own tests and its own review.
`loseLifeEmitting`'s own doc comment already claims to be "the single choke
point for a NON-damage life loss (CR 119.3): a 'lose life' effect … or a paid
life cost (CR 119.4)" — the payment half of that sentence was never wired.

**Why it may not deserve its own issue.** It needs a shipped card that
triggers on life loss AND a life-cost card in the same deck to be observable;
if no such pair is in the pool it is a line on a mechanics tracker.
