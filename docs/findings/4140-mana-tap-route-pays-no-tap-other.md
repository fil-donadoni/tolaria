---
title: a mana ability with {T} plus a tap-other cost is never paid its tap-other leg (tapUntap route)
discoveredBy: 4140
status: draft
confidence: high
---

**What is wrong.** A `useStack: false` ability is paid by one of three routes
(`lowerManaAbility`, `convex/oracle/lowerActivated.ts`): `tapUntap` for a `tap`
or self-`sacrifice` cost, the cost-pick window for a filtered give-up cost, or
`activateManaAbility` otherwise. Only the last calls `payTapOtherAbilityCost`
(`convex/game.ts`); `activateManaAbility` even throws "Use tapUntap for tap
mana abilities" when `cost.tap` is set, and `tapUntap` pays mana, life,
counters and discard but never a `tapOtherFilter` pick. So "{T}, Tap an
untapped creature you control: Add one mana of any color" (Springleaf Drum,
Loam Dryad, Saruli Caretaker, Jaspera Sentinel, Citanul Stalwart, Gene
Pollinator, Survivors' Encampment, Holdout Settlement, Scene of the Crime)
would tap the source, tap nothing else and produce mana. `isAutoPayableManaAbilityCost`
(`convex/gre/constants.ts`) also admits `cost.tap` unconditionally, so the bot's
planner would fund from it.

**Evidence.** Read statically: `grep -n tapOther convex/game.ts` finds the pick
only in `activateManaAbility` (~15068) and the stack path
(`pendingActivation.tapOtherChoice`); none inside `tapUntap`. Issue #4140's
review caught it; the grammar now refuses the shape (`lowerManaAbility`,
tests in `tapOtherCost.test.ts`) rather than compile a free-mana definition.
The stack-using shape ("{T}, Tap two untapped creatures you control: Return
target permanent…", Tradewind Rider) is paid by `tapOtherChoice` and is fine.

**Why it may not deserve its own issue.** It is defensible without the ticket
that found it — nine corpus cards wait behind it — but it is engine work
across `tapUntap`, the mana-tap options list and the bot's `planManaPayment`,
so it wants a full-path test and its own issue rather than a line on #4140.
