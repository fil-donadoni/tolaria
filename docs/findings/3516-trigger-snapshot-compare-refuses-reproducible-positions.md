---
title: The CR 608.2h snapshot compare is applied to a trigger, whose resolution reads the LIVE source — so it refuses positions the rebuild would reproduce exactly
discoveredBy: 3516
status: draft
confidence: medium
---

**What is wrong.** `lowerStack` (`convex/gre/scenarioBuilder.ts`) compares a
clone-shaped stack item against its source permanent and refuses the whole
declared stack on any key they differ on — `snapshot:counters`,
`snapshot:damageMarked`, and so on. For an ACTIVATED ability that is exactly
right: CR 608.2h says the item keeps the characteristics the ability was
activated with, so a source that has changed since is a second object the spec
has no entry for. For a TRIGGER the same compare is stricter than the engine
is: `resolveTopOfStack`'s own tier-2 comment says a permanent that never left
is the same object, "so counters or combat history it gained AFTER the trigger
went on the stack are legitimately visible here", and `buildSpellContext` pins
the resolution to `item.triggerSourceId` rather than to the stale spread. The
rebuild re-spreads from the rebuilt source, which IS the live source — so the
refused position is one it would have reproduced.

**Evidence.** The compare loop sits in `lowerStack`'s `isClone` branch
(`convex/gre/scenarioBuilder.ts`, the `snapshot:<key>` refusals); the engine's
own reading is in `gre/state.ts`'s triggered-ability resolution, tiers 1–3 of
the CR 608.2h / 113.7a LKI comment. Issue #3516's sweep (robots vs
erhnamgeddon, seeds 1..6, 60 iterations) left 14 decisions on
`trigger-source-not-on-battlefield` and none on a `snapshot:` key, so the cost
today is zero on that pairing — the shape is what is worth recording, not a
measured loss.

**Why it may not deserve its own issue.** It is FAIL-CLOSED: it refuses
verdicts, never produces a wrong one, and on the one pairing measured so far it
refuses nothing at all. If a later sweep shows `snapshot:` keys costing real
decisions on a deck that gains counters mid-turn (a Tetravus / Triskelion
board), that number is the ticket; until then it is a line on PRD #3397.
