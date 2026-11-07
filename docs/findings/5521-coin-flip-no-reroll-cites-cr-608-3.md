---
title: The coin-flip "no re-roll" comments cite the permanent-spell rule
discoveredBy: 5521
status: draft
confidence: high
---

**What is wrong.** Four lines justify "a persisted flip is not re-rolled on a
re-walk" with the rule for permanent spells resolving, which says nothing about
flips or re-walks: `convex/cards/types.ts` (the `coinFlip` member's doc comment),
`convex/gre/effects/interpreter.ts` (twice, the `requestCoinFlip` idiom and the
`coinFlip` executor) and the `coinFlip` resume test title in
`convex/gre/effects/__tests__/interpreter.test.ts`.

**Evidence.** The rule printed by `bun run cr` for that id opens "If the object
that's resolving is a permanent spell". Issue #5521 reworded the `coinFlip`
registry note to the wording `coinFlipSeries` already uses (the engine runs each
instruction once, and the instruction-order rule of resolution orders them), and
left these four untouched because its diff did not need them.

**Why it may not deserve its own issue.** It changes comments and a test title
only. The fix is the same one-line rewording on each, plus one ledger confirm per
line, and it could ride along with the next change to those files.
