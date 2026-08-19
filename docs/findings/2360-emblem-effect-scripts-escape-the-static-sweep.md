---
title: Emblem Effect Scripts are not covered by the catalogue-wide validateEffectScript sweep
discoveredBy: 2360
status: draft
confidence: medium
---

**What is wrong.** ADR 0045's per-Op test regime rests on two catalogue-wide
automatic proofs: the `validateEffectScript` static sweep (schema, ref
resolution, Op vocabulary, JSON purity, mutual exclusivity) and the generated
canned-scenario smoke test. Both enumerate CARD definitions. An emblem's
`triggeredAbilities[].effects[]` (`EmblemDefinition`, `convex/cards/emblems.ts`)
is an Effect Script living outside `getAllCards()`, so a malformed emblem script
— a bad `$event.<field>` ref, an unregistered Op, a non-JSON value — reaches no
static check at all. The only thing standing behind an emblem today is
`emblemArt.test.ts`, which asserts `imagePrintId` and `oracleText` and never
looks at `effects`.

**Evidence.** `convex/cards/__tests__/effectScripts.test.ts` contains no
reference to `getAllEmblemDefinitions` (`grep -n emblem` returns nothing), while
`convex/cards/emblems.ts` exports exactly that enumerator at `:52` for
`emblemArt.test.ts`'s use. Six emblems ship today; four of them carry
`effects[]`, including the `{ ref: "$event.targetPermanent" }` object ref added
for Dack Fayden in #2360 — whose validity had to be proven by hand-written
end-to-end tests because no sweep would have caught a typo in it.

**Why it may not deserve its own issue.** The fix is plausibly three lines
(feed `getAllEmblemDefinitions()` into the same `it.each` the card sweep uses),
which makes it a candidate for folding into the next emblem PR rather than a
ticket of its own. Emblems are also a small, slow-growing set, so the exposure
today is bounded — the argument for ticketing it is that the exposure is
invisible, not that it is large.
