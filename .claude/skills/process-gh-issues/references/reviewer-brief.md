# Reviewer brief

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

The reviewer subagent reads this file itself. The orchestrator passes the PATH, never the contents —
which is the point: the mandate costs the orchestrator nothing per pass.

---

Reviewer prompt mandate (strict): read the PR diff (`gh pr diff`) plus surrounding context; report **only** (a) real bugs, (b) CR-correctness violations, (c) project-rule violations — primitive reuse, type sourcing, one-component-per-file, test quality (tautological/weak tests), missing mandatory coverage per `.claude/rules/`. No style commentary, no praise, no scope creep.

**The verdict is a receipt, written to the same batch directory** as `<issue>-review.json` (`role: "review"`, `outcome: "approve" | "blocking"`, `pr`, `findings[]`) before the reviewer returns its one-line summary. A `blocking` verdict with an empty `findings` list is rejected by the contract — it is the shape that stalls a train with nothing to hand the fixup subagent. Persisting the verdict is what makes "was this PR reviewed?" answerable after an interrupt, instead of a question only the dead context could answer.

**Re-reviewing a fix? `writeReceipt` refuses to overwrite the round-1 verdict.** If you are reviewing a fixup that answers YOUR OWN earlier blocking verdict (or anyone else's) for this same issue, write with an explicit `round` one higher than what is already on disk (`ls .claude/receipts/<BATCH_ID>/ | grep '^<issue>-review'` tells you the highest round present; round 1 has no suffix) — e.g. `{ role: "review", round: 2, outcome: "approve", ... }`, landing at `<issue>-review-2.json`. The train selects the effective verdict by round, not by which file it happens to read first, so this is what lets your approve supersede the earlier block rather than being hand-edited over it or silently losing to it on disk. The common case — one review, ever — needs no `round` at all.

**Prove it, don't read it — empirical verification is mandatory (not optional).** A review conducted entirely by reading is a guess with a confident tone. For every load-bearing claim — the implementer's and your own — **run something**: execute the relevant tests, and where a claim is that some test _covers_ a behaviour, **deliberately break the subject and confirm the test goes red**, then revert. Comment out the new branch, invert the condition, re-introduce the original bug. A guard that does not fire is not a guard.

This is what actually catches the recurring class, and nothing else does. Three shapes, all shipped despite green suites and careful reading:

1. **The test encodes the bug** — asserts the current wrong behaviour, so it locks the defect in.
2. **The test asserts nothing** — expected and actual are the same object by construction (a captured reference into state that the code mutates **in place**), so it passes with the feature disabled.
3. **The test never reaches the code** — a hand-built view instead of the real reducer, or a catalogue guard that silently skips the card.

The asymmetry is why reading cannot substitute: a test that fails when it should pass is loud (CI red, fixed in minutes); a test that passes when it should fail is **silent forever**, and writing it, reading it, reviewing the diff and running the suite all look identical either way. Only breaking the subject distinguishes them.

**A verdict with no mutation performed and reported is not a valid verdict.** State in the receipt what you broke and what failed. If a test still passes after you break what it guards, that is a finding — report it as blocking.

**Pull the context you need — never review myopically (mandatory).** The diff is the starting point, NOT the boundary. Whenever a correctness or rule judgment depends on something the diff doesn't show, actively read it from the codebase before deciding — grep for the primitive the change should have reused, open the caller/callee of a touched function, read the CR-referenced rule, follow the type to its source, walk the view reducer a UI change depends on, read the test the coverage rule requires. **Never approve or block on an assumption when the answer is one search away**, and never let a narrow diff-only read pass a bug that a caller or a reducer would have revealed (the Phelia/one-site-honored class). A review is under-contexted until every finding — and every non-finding — rests on code actually read, not guessed. Cost is not a reason to stay shallow: the reviewer is the correctness backstop for cheap implementers, and a myopic backstop is worse than none.
