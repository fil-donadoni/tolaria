---
title: queue:train's implicit --batch mode still resolves receipts from cwd, not the primary checkout
discoveredBy: 2656
status: draft
confidence: low
---

**What is wrong.** `scripts/train-order.ts:61` sets `const root = process.cwd();`
for the implicit `--batch <id>` mode, then calls `readReceipts(root, batch!)`
(train-order.ts:82), which joins `root + RECEIPTS_ROOT + batch`. If `queue:train
--batch <id>` is ever invoked from inside an issue worktree rather than the
primary checkout, it silently reads (or fails to find) the wrong
`.claude/receipts/<batch>` directory — the same shape of bug #2656 fixed for
the receipt WRITE path in `write-review-receipt.ts`.

**Evidence.** `scripts/train-order.ts:61,82`. The `--dir <path>` branch just
above it (train-order.ts:65-76) is correctly out of scope per #2656's own
"reader's explicit-directory mode" exclusion — it takes a path directly and
must never join. This finding is about the OTHER branch, `--batch`, which
still joins onto `process.cwd()`.

**Why it may not deserve its own issue.** The issue's own "Current behavior"
text states "The reader resolves the primary checkout properly and looks only
there" — and in the documented real workflow, `queue:train` is run by the
orchestrator from the primary checkout, never from a subagent's worktree
(confirmed by an existing user memory note: "queue:train reads receipts from
cwd — run it from the repo root; a worktree gives a partial batch reported as
clean"). That is, this is already a KNOWN, documented constraint on how the
command must be invoked, not a silent trap discovered fresh here. Fixing it
(swap `process.cwd()` for `primaryCheckout()`) is a one-line, low-risk change,
but it is a different call site than #2656's target files list and widening
the diff risked scope creep on a fix issue that was otherwise a clean four-file
change. Left untouched; flagging here in case a future pass wants to close the
gap for defense-in-depth even though the documented usage already avoids it.
