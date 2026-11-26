---
title: search-library candidates tie lands on worth, so card name decides which finds the Bot is offered
discoveredBy: 10859
status: draft
confidence: medium
---

**What is wrong.** `searchLibraryCandidates` ranks the pool by
`libraryTargetWorth`, breaks ties on card identity, keeps at most
`CHOICE_TOP_K` leads, and fills each multi-card pick greedily from the same
ranking. Lands tie with each other (and, on a mana-value-0 tutor, with a
mana-value-0 spell), so alphabetical order decides which finds the Bot can
choose at all. Two shapes were seen while writing the Amulet Titan Line:

- Tolaria West's transmute (CR 702.53a, any mana-value-0 card) with Boseiju,
  Crumbling Vestige, Dryad Arbor, Echoing Deeps, a Forest, Gruul Turf and
  Hanweir Battlements in the library offered those seven lands and **no
  Summoner's Pact**. The card the line is played for was never a candidate.
- Primeval Titan's "up to two land cards" with Forests in the library offered
  `[Forest, Forest]`, `[Gruul Turf, Forest]` and `[Hanweir Battlements, Forest]`,
  but **not `[Gruul Turf, Hanweir Battlements]`**, the pair the Amulet line
  needs. Each lead is filled with the top-ranked other card, which is the
  Forest.

**Evidence.** `convex/gre/ai/choiceCandidates.ts:1188` (worth, then identity),
`:1201` (`CHOICE_TOP_K` cap), `:1205` (the greedy "best set led by this card").
The two blade Lines in `convex/gre/ai/blade/lines.ts` work around it on purpose:
the Amulet library holds no basic land and few mana-value-0 cards. A real
Amulet Titan library holds about twenty lands, so in an actual game the
transmute for the Pact is unreachable.

**Why it may not deserve its own issue.** Any top-K cut has to drop something,
and the cut is search-side only (the engine still accepts the pair, and a human
is still offered it). The fix may belong in `libraryTargetWorth` (a find's worth
reading what the searcher's hand and board need) rather than in the generator.
If so, this is one line on whatever tracks valuation of tutored cards, not a
ticket of its own.
