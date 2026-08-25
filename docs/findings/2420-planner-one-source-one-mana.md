---
issue: 2420
title: planManaPayment models one source = one mana, the castability census counts one unit per mana
confidence: high
area: gre/bot
---

## What

`planManaPayment` (`convex/gre/moves.ts`) builds **one `PlanSource` per untapped
permanent**, so a source that taps for two mana counts as one. The castability
census it is supposed to mirror — `coloredCostLeftover` →
`getProducibleManaUnits` (`convex/gre/rules.ts:1596`) — counts **one unit per
individual mana** (issue #132, "a {C}{C} source contributes two, not one").

The two therefore disagree on every board whose only surplus is a multi-mana
source, in the direction that matters: the census offers `cast`, the planner
returns `null`.

## Evidence

`convex/gre/__tests__/manaConverterParity.bot.test.ts` sweeps every ≤4-permanent
subset of an 8-card pool × 5 untargeted spells, both orders. On baseline
`45e0bdcc` **15** board/spell pairs have `getLegalActions` offering `cast` while
`planManaPayment` returns `null` — every one of them a **Sol Ring** board paying
a purely generic cost, e.g.:

```
[Sol Ring] casting Ankh of Mishra ({2}): cast offered, plan null
[Sol Ring, Ornithopter] casting Ankh of Mishra ({2}): cast offered, plan null
```

Sol Ring genuinely pays `{2}` alone. The human is offered the Cast and it works;
the BOT never enumerates the cast at all (`enumerateCastMoves`,
`convex/gre/moves.ts:1367`, drops a spell whose `planManaPayment` is `null`), so
this is a bot blind spot on one of the most-played artifacts in the pool rather
than a false-positive Cast button.

PR #2806 reduces the count to 11 without adding any (Urza can now supply the
missing unit by tapping a bare artifact), but does not close the class.

## Why it might NOT deserve a ticket

It is old, it fails in the SAFE direction (the bot under-plays; no unpayable
`pendingCast`, so it is not the #1695 trap), and the fix is not local: giving
`PlanSource` a quantity would move the greedy's tie-breaks on every board that
contains a Sol Ring / Gaea's Cradle / Mana Battery, i.e. exactly the boards the
blade tier and the ladder measure. That is a sized piece of work with its own
verification, not a rider on a card-shaped fix.

Against that: it is silently costing the bot Sol Ring, and the sweep above is
already written and would pin the fix.
