---
title: ResolvedPlacement.columnOverride and mvColumnFromPins have no production consumer left
discoveredBy: 1632
status: draft
confidence: medium
---

**What is wrong.** `mvColumnFromPins` and the `ResolvedPlacement.columnOverride`
field it feeds exist to read a Card Pin back in the pre-namespace
`number | "lands"` vocabulary "the Limited Pool surface still speaks". As of
issue #1632 no surface speaks it: the draft-time Pool was the last consumer, and
it now renders through the shared `DeckZoneSurface`, which reads
`ColumnLayout.pins` (namespaced `ColumnId`s) via `pinsByPoolIndex`. The field is
now computed on every placement resolve and read by nothing outside tests.

**Evidence.**

- `convex/limited/poolArrangement.ts:115` `mvColumnFromPins`, called only at
  `:232` to populate `ResolvedPlacement.columnOverride` (`:207`).
- Grepping `columnOverride|mvColumnFromPins` across `src/` and `convex/` after
  #1632 returns only `convex/limited/__tests__/poolArrangement.test.ts`,
  `convex/__tests__/limitedEvents.test.ts:1603-1628`, and one comment in
  `src/components/deckbuilder/__tests__/pool-deck-builder-form.column.test.tsx:266`.
  No production call site.
- The _forward_ direction is still load-bearing and must NOT be removed with it:
  `normalizeLegacyColumn` (`:101`, via `readEntryPins`) is what lets an
  Arrangement row persisted before #1621 — which stores `column`, not `pins` —
  still resolve. Only the read-back is dead.

**Why it may not deserve its own issue.** It is ~20 lines of pure, tested,
side-effect-free code that costs one `parseColumnId` per Pool card per resolve —
no correctness risk, no user-visible effect. Removing it touches
`convex/__tests__/limitedEvents.test.ts`, a large shared test file that every
Limited PR contends for, so the cleanup is worth strictly less than the
merge-train conflict it would have caused inside #1632's batch. It is probably a
line on whatever tidy-up follows PRD #1617's last slice rather than a ticket of
its own — but it should not simply be forgotten, because a dead legacy reader
left in place is exactly what makes the next reader believe the legacy
vocabulary is still live.
