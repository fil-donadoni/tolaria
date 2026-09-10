---
title: mill's bindAll misses a milled card a CR 614 replacement redirected, so "those cards" undercounts
discoveredBy: 3243
status: draft
confidence: medium
---

**What is wrong.** CR 701.17c: "An effect that refers to a milled card can find
that card in the zone it moved to from the library, as long as that zone is a
public zone." `mill`'s `bindAll` binds only the cards that reached the
GRAVEYARD (its own doc: "every card that genuinely reached the graveyard, in
mill order"), so a card a CR 614 graveyard-bound replacement sent to exile
instead is not in the binding at all — and every reader of that binding
silently treats it as if it had never been milled.

Palantír of Orthanc is the first consumer where this changes a number rather
than a candidate list: "that player loses life equal to the total mana value of
those cards" drains 0 while a graveyard-bound redirect is active, instead of
draining for the cards that were milled and exiled.

**Evidence.** `convex/cards/types.ts` — `mill`'s `bindAll` doc ("every card
that genuinely reached the graveyard"). The redirect is live, not theoretical:
`graveyardDestinationFor` (`convex/gre/replacements.ts:798`) lists mill among
its chokepoints, and its own header names mill first. The `sum` value member
added by issue #3243 then looks the bound ids up with
`ctx.getGraveyardCards`, so even a widened binding would need a widened lookup.

**Why it may not deserve its own issue.** Two shipped readers of `bindAll`
exist and only one of them is quantitative, so today the whole blast radius is
one card under one opposing permanent class. The fix is also not local: the
binding has to carry the zone each card ACTUALLY reached (or the id alone, with
a public-zone lookup at read time), which is a change to issue #2600's contract
and to every consumer that assumes graveyard residency — bigger than the gap it
closes. If a second quantitative reader ships, or a graveyard-hate card enters
a preset deck, it stops being an edge case.
