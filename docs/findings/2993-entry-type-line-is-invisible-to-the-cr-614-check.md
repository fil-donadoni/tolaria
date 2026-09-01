---
title: The entry type line is applied after the CR 614 entry-replacement check, so Containment Priest still sees the printed creature
discoveredBy: 2993
status: draft
confidence: high
---

**What is wrong.** Issue #2993 made "return it to the battlefield. It's an
enchantment." apply its type line inside the entry funnel — `applyEntryTypeLine`
in `stageReanimatedOnBattlefield` (`convex/gre/state.ts`), after
`resetBattlefieldTransientState` and `clearZoneCharacteristics`, before the card
reaches the battlefield. That is early enough for the entry counters, the CR
611.2 grant passes, the CR 614.1c Kismet tap check and `emitPermanentEntered`.
It is **not** early enough for the CR 614 entry-REPLACEMENT check:
`enterBattlefieldDestinationFor` runs further up the same function and still
reads the card's printed type line.

**Evidence, and it is reachable with shipped cards.** Containment Priest ships
(`convex/cards/sets/c14/white.ts:24`) — "if a nontoken **creature** would enter
the battlefield and it wasn't cast, exile it instead" — and Enduring Innocence
ships (`convex/cards/sets/dsk/white.ts`). Kill an Innocence under a Priest and
its return is exiled as a creature, though what would enter is an enchantment.
The same ordering makes the Worms of the Earth land check
(`canLandEnterBattlefield`, CR 614) read the printed line; harmless today, since
no shipped `entersAs` names Land.

**What is NOT wrong.** The redirected card carries nothing away with it: every
abort branch (the land block, this exile redirect, the CR 303.4g hostless Aura,
the CR 614.12a as-enters abort) calls `discardEntryTypeLine`, so the card lands
in its new zone with its printed line and no live stamp. Regression test:
`gre/__tests__/entersBattlefieldReplacement.test.ts`, "a REDIRECTED entry
discards its pending entry type line".

**Why it may not deserve its own issue.** The fix is not the one-line move it
looks like. The redirect branches return _before_ the entry, so a stamp applied
above the destination check would mutate a card that ends up in exile or the
graveyard — undoable, but only by re-deriving the printed line, which is the
CR 400.7 revert the departure side already owns. And the CR 614.12a park would
then have to re-apply the line on resume, because the entry-side
`resetBattlefieldTransientState` wipes exactly that provenance. Both are
symptoms of the same thing: "the characteristics an object would have **as** it
enters" has no single authority in this engine, which is what ADR 0082 / PRD
#2064's layer-registry migration exists to build. A line on that migration reads
better than a ticket of its own — unless the Priest × Enduring interaction turns
up in real play first.
