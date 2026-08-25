---
title: card-index.json already maps CardDefinition.id -> oracleId — a follow-up could join #2695's legality map by id instead of name
discoveredBy: 2695
status: draft
confidence: medium
---

**What is wrong (or rather, what could be better).** #2695 joins the
Premodern legality map to a deck's resolved card by NAME
(`checkOracleLegality` in `convex/formats.ts`, keyed on
`cardMeta.name.toLowerCase()`), because `CardDefinition` carries no oracle id
and the issue framed that as the hard constraint. Name-joining works (ADR
0057 already accepts the same pattern for banlists) and the collision risk is
small and characterised (38 same-name pairs in the 2026-08-25 corpus of
34,890 rows, none of them a real conflict for Tolaria's built pool — see
`scripts/oracle-legality.ts`'s header comment) — but it is not the _most_
precise join available.

**Evidence.** `data/card-index.json` (ADR 0041's home-set backfill, committed,
2026 rows — one per built `CardDefinition`) already carries
`{ scryfallId, oracleId }` per row, and `scryfallId` IS the `CardDefinition.id`
(confirmed: `scripts/backfill-card-index.ts:8-9`, "every `CardDefinition.id`
is a Scryfall print id"; spot-checked against `BOLT_DEF`/`COUNTERSPELL_DEF` in
`convex/__tests__/formats.test.ts` — both match exactly). So a
`cardId -> oracleId` map already exists as a free byproduct of unrelated
tooling; a follow-up could re-key `data/oracle-legality.json` by oracle id and
join through `card-index.json` instead of `CardDefinition.name`, eliminating
the name-collision surface entirely (however small).

**Why it may not deserve its own issue (yet).** Doing so today would mean
importing a second ~600 KB generated JSON (`card-index.json`) into
`convex/formats.ts`'s import graph, which is also reachable by the frontend
(`deck-builder.tsx` imports `FORMAT_RULES` directly) — a real (if modest)
bundle-size cost for a precision gain against a collision risk that is
currently zero in practice. It's worth revisiting if (a) the collision count
grows uncomfortably as more sets are added to the corpus, or (b) a future
format (Pauper, Legacy, …) adds its own generated legality map and the
cost of importing `card-index.json` once starts paying for itself across
several formats rather than just Premodern.
