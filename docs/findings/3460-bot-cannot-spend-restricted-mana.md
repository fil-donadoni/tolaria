---
title: The Bot's tap planner ignores restrictedMana, so it never spends a restricted unit
discoveredBy: 3460
status: draft
confidence: high
---

**What is wrong.** `getLegalActions` counts restricted mana toward affordability
(CR 106.6 — a unit whose restriction permits THIS spell is spendable), but the
Bot's own tap planner does not model that pool at all. So a spell only restricted
mana can pay for is legal for a human and invisible to the Bot: `enumerateMoves`
drops the cast and the seat passes. Nothing in the engine is wrong — the two
authorities simply disagree in the direction that makes the Bot weaker, and
`enumerateMoves`' whole contract is that it never offers a move the server would
reject, not that it offers every move the server would accept.

**Evidence.** `convex/gre/rules.ts:2268` adds one source per restricted unit that
`restrictedUnitAllowsSpell` permits, which is why `getLegalActions` returns
`["cast"]` for Grizzly Bears on a board whose only mana is
`[{ color: "G", amount: 2, restriction: "creature-spell" }]`.
`planManaPayment` (`convex/gre/moves.ts:786`) reads only `player.manaPool` —
its own doc says "Pool mana is modelled as zero-tap sources" and names no second
pool — so it returns `null` for the same cost and `enumerateMoves` yields only
`pass`. Measured on that exact board while building issue #3460's tests:
`getLegalActions` → `["cast"]`, `enumerateMoves` → `pass`.

**Why it may not deserve its own issue.** The producers are rare in the shipped
catalogue (Metamorphosis, Mishra's Workshop, the cumulative-upkeep payment path,
Ice Cauldron's instance-keyed noted mana), and the lowering sweep (issue #3461,
PR #3465) measures restricted floating mana as the least-firing spec gap of
thirteen — so the class may be worth a line on the Bot map (issue #1892) rather
than a ticket. What argues the other way: it is a fail-CLOSED disagreement
between two authorities that are supposed to mirror each other, so it will not
show up as a blunder anyone can debug — the move simply is not there.
