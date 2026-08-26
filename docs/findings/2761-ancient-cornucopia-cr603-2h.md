---
title: "Do this only once each turn" (CR 603.2h) is implemented as a trigger-count cap, not an action-taken gate
discoveredBy: 2761
status: draft
confidence: medium
---

**What is wrong.** Ancient Cornucopia (`convex/cards/sets/big/green.ts`,
`ancient-cornucopia-lifegain`) reads "Whenever you cast a spell that's one or
more colors, you may gain 1 life for each of that spell's colors. Do this only
once each turn." CR 603.2h says precisely: "This ability triggers only if its
source's controller has not yet taken the indicated action that turn" — i.e.
the gate is on whether the life gain was actually TAKEN, not on how many times
the ability has fired. A player who declines the life gain on an earlier,
low-colour-count spell should still see the ability trigger again later that
turn on a higher-colour-count spell.

The shipped implementation instead sets `TriggeredAbility.maxTriggersPerTurn:
1` (`convex/gre/triggers.ts`), which caps the TRIGGER itself regardless of
whether the "may" was accepted or declined — the coarser, already-shipped
primitive named by the issue that unblocked this card (#2761), not a
CR-precise reading of 603.2h.

**Evidence.** `convex/cards/sets/big/green.ts` (`ancientCornucopia`), comment
directly above the definition. `bun run cr 603.2h` prints the exact rule text.
`convex/gre/triggers.ts:298-311` is where `maxTriggersPerTurn` is enforced —
purely a per-ability trigger tally (`CardInstanceState.triggersThisTurn`), with
no concept of "did the may-effect actually resolve to a yes."

**Why it may not deserve its own issue.** The divergence is only reachable if
a rational player deliberately declines FREE life gain with no downside —
which only matters against a small number of "punishes gaining life" effects
(none of which currently key off "did you use Ancient Cornucopia specifically
this turn," since none exist against a single named source). Fixing it
precisely needs new per-instance "action taken this turn" engine state
(`convex/gre/**`), which is a genuine primitive question (is it worth a
general "once-per-turn effect" primitive, given CR 603.2h is a real, if
uncommon, printed template?) rather than a one-line fix — worth grilling
before ticketing, not a given P2 bug.
