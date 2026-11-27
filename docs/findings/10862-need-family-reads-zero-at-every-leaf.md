---
title: The Evaluation has no Deck Knowledge, so the generated vector's need family is zero at every leaf
discoveredBy: 10862
status: draft
confidence: high
---

**What is wrong.** The generated vector's `need.*.self` columns (issue #10856)
are read against the seat's own decklist, handed to `generatedVector` as Deck
Knowledge. The Evaluation's seam (issue #10862) reads the vector from inside
`evaluate`, and `evaluate` is handed a state, a seat, the weights and a mana
census memo — no Deck Knowledge. The search holds it (`runSearchWithTrace`'s
`deckKnowledge`) but does not pass it to any of its evaluation calls. So under
the `generated-vector` variant every `need` column is zero at every leaf and
every one-ply probe, whatever weight the table gives it: a fitted table could
price the Deck Needs distances and the Bot would never see them. The Tron and
Amulet Lines are the positions those columns exist for.

**Evidence.** `convex/gre/ai/generatedVector/correction.ts` calls
`pricedGeneratedVector(state, seatId, pricing, memo)` with no fourth argument;
`deckNeedMeasures` (`deckNeeds.ts`) returns an empty map when the list is
missing. The Census gate read the vector the same way
(`candidate.ts` → `generatedVector(settled, botId)`), so its 13 of 29 was
measured with the need family at zero too. The cost bench of issue #10862
(`docs/research/generated-vector-leaf-cost.md`) therefore does not include what
`deckNeedMeasures` costs per leaf: it walks the seat's whole list on every
call.

**What a fix has to decide.** Two ways for the list to reach the leaf: thread
Deck Knowledge through the search's evaluation calls (more than a dozen call
sites in `search.ts`), or stamp the seat's own list on the search's root state the
way `deckColorKnowledge` is stamped (a transient `GameState` field, kept out
of serialization). Either way the need family's per-leaf cost has to be
measured before it is switched on: its requirements depend only on the list
and could be derived once per search.

**Why it may not deserve its own issue.** It matters only if PRD issue #10849
continues past the four-gate report (issue #10864). If the direction stops,
this is closed with it. If it continues, it is a blocker of the Prototype
gate's reading, not a follow-up: a prototype fitted on need columns it cannot
read at the leaf measures nothing about them.
