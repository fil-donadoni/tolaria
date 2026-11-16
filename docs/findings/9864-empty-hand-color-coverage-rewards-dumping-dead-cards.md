---
title: Own-seat colour coverage rewards emptying a hand the mana base cannot cast
discoveredBy: 9864
status: draft
confidence: medium
---

**What is wrong.** `ownHandColorCoverage` (`convex/gre/ai/colorCoverage.ts`)
returns 1 for an empty denominator, and otherwise covered / demanding. With no
mana source at all, every coloured card in hand is uncovered, so the ratio is 0. Spending those cards raises it to 1. The term was built to price colour
screw. With zero sources it prices mana screw, which `manaDevelopment`
already covers, and it pays the seat for throwing away the cards it cannot
cast. The header says an empty hand reads 1 so that emptying a hand cannot
"invent a preference". A ratio still rewards removing an uncovered card.

**Evidence.** The blade position `evoke: Solitude is never evoked with no
threat, spending two cards` (0 lands, Solitude + Savannah Lions in hand,
opponent Ornithopter). The one-ply breakdown after the evoke has self
`colorCoverage` 22.6. After `pass` the hand stays and the term reads 0. That
puts the evoke at 11.3 against 8.1 for `pass`. Measured with the term held at
a constant 0.5 whenever the base is empty: the evoke drops to 0.0 and `pass`
rises to 19.5. Issue #9864 fixed the root pick in the search instead
(`isEvokeCast`). The static reading is why that blade entry is still a
predicate and not a `forbidden` verdict: the fit would chase the 3.2-point
lean.

**Why it may not deserve its own issue.** It only matters with an empty mana
base, and then only between lines that differ in coloured cards held. Holding
the term constant on an empty base adds a step when the first land enters,
which needs its own measurement over the `must` tier.
