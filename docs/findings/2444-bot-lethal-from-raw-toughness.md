---
title: The bot's combat predictors still compute lethal from raw effective toughness
discoveredBy: 2444
status: draft
confidence: medium
---

**What is wrong.** #2444 introduced `convex/gre/lethalDamage.ts` as "the single
authority for how much must be assigned to a blocker before excess goes
anywhere else" (CR 702.19b / CR 702.2c: subtract damage already marked, subtract
same-step damage from other creatures, collapse to 1 for a deathtouch source).
Two bot-side combat predictors were not migrated and still treat a creature's
**raw effective toughness** as the amount needed to kill it. PR #2483's body
claimed `setDamageAssignment` was "the only site" computing lethal from raw
toughness; that sentence was inaccurate — these two survive.

**Evidence.**

- `convex/gre/dangerClock.ts:107` `predictCombatOutcome` — the free-removal and
  trade branches ask `getEffectivePower(state, b) >= atkT` where
  `atkT = getEffectiveToughness(state, atk)` (`dangerClock.ts:153-167`). A
  first-strike step (or a `Pestilence` activation) that already marked damage on
  the attacker makes the block lethal for less; a blocker with **deathtouch**
  kills it for 1. Neither is modelled, so the clock under-counts the defender's
  removal and over-counts face damage.
- `convex/gre/evaluate.ts:1063` `cautiousBlockPenalty` — the held-pump branch
  walks the blockers spending `remaining >= bT` with
  `bT = getPermanentEffectiveToughness(state, b)` (`evaluate.ts:1097-1104`),
  again ignoring `damageMarked` and the attacker's own deathtouch.

Both call the layer pipeline correctly (CR 613.4 effective, not printed); the
gap is purely the CR 702.19b/702.2c adjustments, which
`lethalDamageThreshold({ effectiveToughness, damageMarked, sourceHasDeathtouch, other })`
already expresses.

**Why it may not deserve its own issue.** These are ADR 0018 heuristics,
explicitly documented as "crude" — `predictCombatOutcome`'s own doc comment says
toughness-only chumps are not modelled at all. Making them CR-exact would be a
behaviour change to the bot's evaluation surface, which per `/bot-slice` needs a
deterministic blade scenario and a strength claim, not a drive-by edit. It may
be better as a line on the bot-AI wayfinder tracker (#1254) than a ticket of its
own — unless someone can show a concrete misplay (a deathtouch blocker the bot
declines to use, say) that makes it defensible without #2444 as context.
