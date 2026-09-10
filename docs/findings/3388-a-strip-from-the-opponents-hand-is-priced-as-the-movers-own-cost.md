---
title: A hand pick out of the OPPONENT's hand is priced as the mover's own cost
discoveredBy: 3388
status: draft
confidence: high
---

**What is wrong.** `handPickCandidates` (`convex/gre/ai/choiceCandidates.ts`)
supports `PendingChoice.zoneOwnerId` — the chooser picking from ANOTHER player's
hand — but prices every pick the same way: `materialGivenUp`, ordered
cheapest-first. For a strip ("exile a card from target opponent's hand") the
worth moves away from the OPPONENT, so the sign is inverted and the ordering
points at the wrong end of their hand. `CHOICE_TOP_K` is 8, so with nine or more
nonland cards in the opponent's hand their best card is never enumerated at all.

**Evidence.** Deep-Cavern Bat and Elite Spellbinder are the two shipped cards
that reach this generator (`count: { min: 0, max: 1 }`, `zoneOwnerId` naming the
targeted opponent, destination `exile`). Their candidate list is ordered
worst-card-first, and the hint on the branch that exiles the opponent's Shivan
Dragon says the bot gave up 60 points. Issue #3388 nearly made the bias ACTIVE:
it routed `choose-hand-card` into the signed prior band, which would have
subtracted the opponent's loss from the bot's own prior and opened the best strip
LAST (measured 0.350 for the Shivan Dragon against 0.445 for their worst card).
That was caught in review and the new leg is gated to the mover's OWN hand, so
these picks keep the flat `NEUTRAL_PRIOR` they have always had — the bug is
exactly as it was, no better and no worse.

**Why it may not deserve its own issue.** Two cards, and it is a preference, not
a freeze or a fail-open: the search still decides on reward, and the prior is
only what opens first. Fixing it properly means signing the pick by whether the
pool is the decider's own zone as well as by its destination, plus a descending
order for the strip shape — a behaviour change that owes a discriminating blade
pair (strip their bomb, not their Mountain), which is what makes it a slice
rather than a line in a settle fix.
