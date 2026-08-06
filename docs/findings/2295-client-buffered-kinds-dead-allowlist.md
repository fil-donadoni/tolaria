---
title: CLIENT_BUFFERED_KINDS is a dead migration allow-list that still reads as authoritative
discoveredBy: 2295
status: draft
confidence: medium
---

**What is wrong.** `CLIENT_BUFFERED_KINDS` / `isClientBufferedKind`
(`src/hooks/usePendingChoiceBuffer.ts:15-42`) enumerate which `PendingChoiceKind`s
route through the client-side choice buffer. Nothing in `src/` or `convex/`
consults either symbol — the only references in the repo are its own test
(`src/hooks/__tests__/usePendingChoiceBuffer.test.ts:8-113`). Actual routing is
`pendingChoiceRoutesToBattlefield` (`src/lib/pending-choice-labels.ts:143-147`),
which is unconditionally `choice.zone === "battlefield"`, consulted by
`useBattlefieldInteraction.tsx:292-296`, `useBattlefieldVisualState.ts:136-139`
and `usePendingChoicePrimaryAction.ts`.

The set is therefore stale in a way that is invisible: `sacrifice-permanents` is
NOT in it, yet is client-buffered today (Portal to Phyrexia, and the annihilator
trigger this issue shipped, both work). Its own doc comment says slice #85 "removes
the legacy path entirely and this set can collapse" — that removal happened, the
set did not.

**Evidence.**

- `src/hooks/usePendingChoiceBuffer.ts:15` — `export const CLIENT_BUFFERED_KINDS`,
  a 12-entry set omitting `sacrifice-permanents`, `keep-permanents`, `partition`,
  `divide-piles`, `look-top`, `search-library`.
- `grep -rn "CLIENT_BUFFERED_KINDS\|isClientBufferedKind" src convex` → 10 hits,
  all in `src/hooks/__tests__/usePendingChoiceBuffer.test.ts`.
- `src/lib/pending-choice-labels.ts:143-147` — the predicate that is actually
  consulted, and it never reads the set.

**Why it may not deserve its own issue.** It is dead code, not a bug: no user-facing
behaviour depends on it, and its test passes. The risk is purely that a future author
adding a choice kind reads it as the registration point and "registers" there instead
of at the real seam — a 10-minute deletion (plus the test's `isClientBufferedKind`
block) rather than a ticket. Fold it into whatever cleanup pass touches
`usePendingChoiceBuffer.ts` next.
