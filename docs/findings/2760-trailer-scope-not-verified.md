---
title: verify-receipt only guards banner..rows..coverage — console-errors/screenshots/wall-time trailer is unverified
discoveredBy: 2760
status: draft
confidence: low
---

**What is wrong.** `verifyReceiptText` (`scripts/ui-gate/verify-receipt.ts`)
deliberately checks only the region between the `RECEIPT`/`DIAGNOSTIC` banner
and the `coverage: …` line. Everything `check:ui` prints AFTER the coverage
line — `console errors: …` and the up-to-10 error lines, the known-debt
trailer, `screenshots: …`, `wall time: …`, the final `✓`/`✗ check:ui
FAILED`/`passed` summary — is not compared against anything. Issue #2760's
acceptance criteria name exactly four protected things (verdict row, ceiling,
coverage line, banner), and the known-debt trailer's elision is explicitly
legitimate, so the region boundary is spec-correct for those four. But it
also means a PR body could report `console errors: none` while the real run
actually printed `console errors: 7` and the reviewer would have no
mechanical signal — only a human re-reading the paste.

**Evidence.** `scripts/ui-gate/index.ts:670-690` prints the banner, rows,
coverage line, `console errors: …`, then (conditionally) the known-debt
trailer, then screenshots/wall-time/summary — in that order.
`extractReceiptRegion` (`scripts/ui-gate/verify-receipt.ts`) stops reading at
the first `coverage: …` match and never looks past it.

**Why it may not deserve its own issue.** The console-error count is not part
of `Evaluation`/`ResultRow` at all — it is a separate CLI concern computed in
`index.ts`'s `main()`, not the evaluator #2760 scoped this verifier around.
Extending coverage to it would mean parsing a second, differently-shaped
block (a count line plus up to 10 free-text lines) with no `Evaluation`
field to recompute it against, which is a real design question (what's the
"real renderer" for a console-error list?) rather than a one-line fix. Flagging
it here rather than fixing it inline, per issue #2760's own out-of-scope note
("What the lane measures … is out of scope").
