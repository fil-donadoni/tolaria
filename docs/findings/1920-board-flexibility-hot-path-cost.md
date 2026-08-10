---
title: The board-side flexibility term costs ~8% of ISMCTS evaluate throughput, and the obvious de-duplication does not recover it
discoveredBy: 1920
status: draft
confidence: medium
---

**What is wrong.** `hasFlexibleActivation` (`convex/gre/evaluate.ts`) walks each
candidate permanent's post-layer activated-ability set on every `evaluate` call,
which is the ISMCTS hot path. The PR-#2454 reviewer measured the branch against
`main` at 10 permanents per side over 50k `evaluate` calls, two runs each:
6499.8 / 6165.2 ms against 5542.8 / 5868.0 ms — roughly **+8%**.

The obvious cause looks like a double allocation: `getEffectiveActivatedAbilities`
is called once inside `hasNonManaActivatedAbility` (the gate) and again by the
loop. **It is not the cause.** Folding the two into a single walk was implemented
and then reverted after measuring it interleaved, three pairs, same harness:

| pair | one gate + one loop (before) | single walk (after) |
| ---- | ---------------------------- | ------------------- |
| 1    | 6397.2 ms                    | 6390.6 ms           |
| 2    | 5567.6 ms                    | 5753.0 ms           |
| 3    | 6542.8 ms                    | 5964.9 ms           |

~2% mean difference inside a ~1000 ms run-to-run spread on a machine several
sessions share (CLAUDE.md § CPU admission control). The cost is the board-side
loop **existing** on the hot path, not how many times it walks — so the
redundancy was left in place, because removing it complicated the function (two
call sites for the shared predicate instead of one gate) for nothing measurable.

**Evidence.** `convex/gre/evaluate.ts` `hasFlexibleActivation` and the comment
above its first line, which records the same table. The reviewer's branch-vs-main
numbers are in `.claude/receipts/01WppNkeXBDfoQA32HMvSRXJ/1920-review.json`,
finding 5.

**Why it may not deserve its own issue.** 8% of leaf-evaluation throughput is a
real but modest cost for a term that fixed a decision-quality bug, and search
budget is expressed in ITERATIONS rather than wall-clock everywhere it matters
(blade entries, `SearchBudget`), so nothing currently regresses in correctness
terms — only how much thinking fits in a fixed `timeMs` difficulty preset. The
argument for a ticket is that this is the second term added to the per-permanent
leaf loop and nobody is tracking the aggregate; a real fix is structural (cache
the post-layer ability set per permanent per state, which several other hot-path
readers would also use) and is worth doing once for all of them rather than
piecemeal.
