---
title: 23 hand-written cards carry no `oracleText` at all, and some of them have real rules text
discoveredBy: 2694
status: draft
confidence: high
---

**What is wrong.** `CardDefinition.oracleText` is optional, and 23 registered
cards omit it. For a genuinely vanilla card (Grizzly Bears, Craw Wurm) that is
harmless. For a card with rules text it is a data gap that reads as "vanilla" to
anything that consumes the field: Berserk, Channel, Conservator, Dwarven
Warriors, Fear and Samite Healer all have behaviour and no Oracle text on file.

Two consequences today. The Card Zoom overlay and any future engine view have
nothing to show beside the definition. And — the reason this surfaced — the
Oracle compiler's gold harness would have scored each of them as a _successful_
vanilla compile: compiling `""` produces a definition with no abilities, which
matches nothing the card actually does, but the comparison is against an input
that was never supplied.

**Evidence.** `convex/oracle/gold.ts` (`runGoldHarness` now skips
`definition.oracleText === undefined` and reports the names in
`withoutOracleText`); the count is asserted as a ceiling in
`convex/oracle/__tests__/gold.test.ts`. `scripts/populate-oracle-text.mjs` is the
one-off backfill that populated the rest via Scryfall `/cards/collection`, so the
mechanism to close the gap already exists — these 23 predate it or were missed.

**Why it may not deserve its own issue.** It is a one-command backfill
(`scripts/populate-oracle-text.mjs` over the missing ids) rather than a design
question, and nothing in gameplay reads `oracleText` — so it may be better as a
line on #2701 (Guard C, which will need every hand-written card to have Oracle
text to round-trip against) than as a ticket of its own. Against that: Guard C
cannot be written at all until this is closed, so it may be worth doing first.
