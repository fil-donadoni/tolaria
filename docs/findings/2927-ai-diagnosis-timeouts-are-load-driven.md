---
title: ai-diagnosis episodes time out on machine load, so health:main reds for reasons unrelated to the diff under test
discoveredBy: 2927
status: draft
confidence: high
---

**What is wrong.** `convex/gre/__tests__/ai-diagnosis.bot.test.ts` runs each
episode at escalating budgets (50 → 400 → 1200 → 5000 iterations) under a fixed
60s `DIAGNOSIS_TIMEOUT_MS`. Episode #12 sits close enough to that ceiling that
which side of it lands is decided by how many other sessions are burning CPU,
not by the code. A red there reads exactly like a decision regression — the
failure text is a timeout, but the surrounding lines print the CORRECT choice at
every budget — so a session that hits it spends its time bisecting a diff that
did nothing.

**Evidence.** Measured while landing issue #2927, alternating only
`convex/gre/evaluate.ts` between `main` and the branch:

| Run                             | Tree            | Load | Episode #12                               |
| ------------------------------- | --------------- | ---- | ----------------------------------------- |
| whole file, 4 files in parallel | branch          | ~8   | 76s FAIL (choice correct at every budget) |
| whole file, alone               | `main` evaluate | ~8   | 16 passed                                 |
| whole file, alone               | branch          | ~8   | 76s FAIL                                  |
| `-t "episode #12"`              | branch          | ~14  | 51s PASS                                  |
| `-t "episode #12"`              | `main` evaluate | ~14  | 92s FAIL                                  |

The last two rows invert the verdict against the same code, which is the whole
finding. The `health:main` RED on `76e4c701` shows the same shape one level up:
three self-play smoke tests recorded durations of ~64,975,635ms (≈18h), i.e. a
suspended process, and they pass on a quiet machine.

**Why it may not deserve its own issue.** The fix may be as small as raising
`DIAGNOSIS_TIMEOUT_MS` or pinning these episodes to a lower budget, and the
broader question — a wall-clock ceiling in a suite whose own doctrine says
"iterations, never wall-clock" — may belong to whatever tracks gate flakiness
rather than to a ticket of its own. What is NOT optional is that `health:main`
currently leaves durable RED markers that mean "the machine was busy".
