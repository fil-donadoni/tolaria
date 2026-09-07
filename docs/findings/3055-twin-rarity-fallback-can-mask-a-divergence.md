---
title: The catalogue merge's rarity fallback can hide a twin's rarity divergence
discoveredBy: 3055
status: draft
confidence: low
---

**What is wrong.** `scripts/catalogue-artifact.ts` joins a compiled `ready` row's
`rarity` as `entry.rarity ?? rarityByOracleId.get(row.oracleId)` — the fallback
reading the rarity off the HAND-WRITTEN definition. For a compiled-ONLY row that
fallback is structurally dead (its key set is the hand-written oracle ids, which
`mergeCatalogue` excludes compiled-only rows by). So it can only ever fire for a
TWIN, and a twin is precisely the row whose two copies get compared: where the
card-index entry carries no `rarity`, the compiled side is handed the
hand-written side's value and the two agree on that field by construction.
`twinDivergence` would then never report a genuine rarity disagreement for that
card.

**Evidence.** `scripts/catalogue-artifact.ts:167` (`const rarity = entry.rarity ??
rarityByOracleId.get(row.oracleId)`), against `scripts/lib/catalogue-merge.ts`'s
`mergeCatalogue`, which drops a compiled row whose `oracleId` is in
`handWrittenOracleIds`. Measured on today's tree while reviewing issue #3055:
the fallback fires **zero** times, so nothing is masked right now.

**Why it may not deserve its own issue.** It pre-dates issue #3055 (it arrived
with the merge in issue #3052) and is unreachable on the current dataset — a
card-index row missing `rarity` for a card that also has a hand-written
definition. If `bun run oracle:index` keeps backfilling `rarity` for every twin,
this stays dead code and belongs as a line on the compiler tracker rather than a
ticket. It becomes real only if a twin ever lands without an indexed rarity, and
the cheap defence is asserting that the fallback count is zero rather than
removing it.
