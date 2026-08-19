---
title: The smart auto-tap solver has no notion of colour DIVERSITY, so it can silently cost a Sunburst permanent its counters
discoveredBy: 2378
status: draft
confidence: medium
---

**What is wrong.** Sunburst (CR 702.44a) pays out per DISTINCT COLOR of mana
spent to cast the spell. Every other cost consumer in the engine cares only
about whether a cost is _covered_ — which mana pays a generic pip is
interchangeable to it. So for a Sunburst spell the auto-tap plan silently
decides the size of the payoff, and it decides it by criteria that know nothing
about the payoff: casting Pentad Prism for {2} off two Mountains yields ONE
charge counter, off a Mountain and an Island TWO, and nothing anywhere ranks
the second plan higher.

This bites both seats. A human clicking "cast" takes whatever
`solveSmartAutoTap` picked (manual land-tapping is still available, so the
human at least has a workaround). The Bot has no workaround at all: it
enumerates a cast move with a `tapPlan` chosen by the same solver
(`convex/gre/moves.ts:1307`, `planManaPayment`), so "prefer diverse colours
when a Sunburst permanent is the spell" is not a decision it can currently
express.

**Evidence.**

- The payoff is computed from the payment, at
  `convex/gre/state.ts:6117` — `manaSpentToCast: item.notedManaSpent ?? {}` —
  which is `manaSpentDelta` (`convex/gre/state.ts:19582`) over the pool around
  `payManaCostForSpell`. Whatever the tap plan put in the pool IS the counter
  count.
- Nothing on the plan-ranking side reads the spell's `entersWith`:
  `evaluateAutoTapPosition` (`convex/gre/evaluate.ts`, called from
  `convex/game.ts` for HUMAN auto-tap plans) ranks plans on board/mana
  considerations only.
- Issue #2378's acceptance criteria named this ("a hint the bot's
  mana-spending heuristic should prefer diverse colors when casting a Sunburst
  permanent"), but the implementation brief scoped the slice to capture,
  placement, registry, wire projection and the bot-visible ACTIVATION. It was
  deliberately excluded, not overlooked.

**Why it may not deserve its own issue.** Exactly one shipped card is affected
today (Pentad Prism), its cost is {2}, and the whole delta between the best and
worst plan is one charge counter — i.e. one mana, once. Against that, the change
touches the shared payment solver every cast in the game goes through, which is
a poor risk/benefit trade for a single common. The honest framing is that this
is a **generic seam gap** ("the payment solver cannot be told the payment
itself has a payoff"), which will also be wanted by Converge and by
"spend only black mana on X"-style riders — so it is probably a line on a
cost-system tracker rather than a Sunburst ticket. If a second Sunburst or
Converge card ships, that is the moment to build it.
