---
title: The entry type line is applied after the CR 614 entry-replacement check, so Containment Priest still sees the printed creature
discoveredBy: 2993
status: draft
confidence: medium
---

**What is wrong.** Issue #2993 made "return it to the battlefield. It's an
enchantment." apply its type line inside the entry funnel — `applyEntryTypeLine`
in `stageReanimatedOnBattlefield` (`convex/gre/state.ts`), after
`resetBattlefieldTransientState` and before the permanent reaches the
battlefield. That is early enough for the CR 611.2 grant passes, the CR 614.1c
Kismet tap check and `emitPermanentEntered`. It is **not** early enough for the
CR 614 entry-REPLACEMENT check: `enterBattlefieldDestinationFor` runs further up
the same function and still reads the card's printed type line. A Containment
Priest ("if a nontoken **creature** would enter the battlefield and it wasn't
cast, exile it instead") would therefore exile a returning Enduring Innocence,
even though what enters is an enchantment.

**Evidence.** `convex/gre/state.ts`, `stageReanimatedOnBattlefield`: the
`enterBattlefieldDestinationFor` call and its `"exile"` / as-enters branches all
precede the `resetBattlefieldTransientState` + `applyEntryTypeLine` pair. The
same ordering makes the Worms of the Earth land check (`canLandEnterBattlefield`,
CR 614) read the printed line — harmless today, since no shipped `entersAs`
names Land.

**Why it may not deserve its own issue.** No shipped card pair reaches it: the
only `entersAs` caller is the DSK Enduring cycle, and Containment Priest is not
in the pool. Moving the stamp above the destination check is not a one-liner
either — the redirect branches return before the entry, so a card that never
enters would have been mutated, and the CR 614.12a as-enters park would consume
the stamp on a pass where nothing entered. It is a line on the ADR 0082 / PRD
#2064 layer-registry migration, where "characteristics an object would have as
it enters" gets one authority, rather than a ticket of its own — unless a card
that reaches it ships first.
