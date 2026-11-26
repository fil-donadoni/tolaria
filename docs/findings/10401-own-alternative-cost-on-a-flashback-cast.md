---
title: announceCast does not refuse a card's own alternative cost on a flashback or escape cast
discoveredBy: 10401
status: draft
confidence: low
---

**What is wrong.** CR 118.9a allows one alternative cost per spell, and
flashback, escape and harmonize are alternative costs. `announceCast` refuses a
second one only off the top of the library (`libraryTopCastPayment`); for a
graveyard cast it resolves any announced `alternativeCostId` zone-blind and
checks only that its legs are payable. A card carrying both a graveyard
keyword and an entry in `alternativeCosts[]` could announce its own
alternative cost on the flashback cast.

**Evidence.** `convex/game.ts` (`announceCast`): `castAlternativeCostForZone`
returns the resolved cost unchanged for every announcement that is not a face
choice, and the only zone refusal that follows is the library-top one
(`"Can't apply an alternative cost to a spell cast from the top of your
library"`). The Bot does not enumerate the Move:
`zoneAdmitsOwnAlternativeCost` (`convex/gre/moves.ts`) opens the graveyard
only under a graveyard play permission, so the gap is reachable from the
client picker alone (`affordableAltCostsForCard`, zone-blind outside the
library).

**Why it may not deserve its own issue.** Not reproduced: no shipped card was
found carrying both a graveyard-cast keyword and an own alternative cost, so
nothing reaches the path today. If that holds it is one refusal in
`announceCast` the day such a card ships, mirroring the library-top one.
