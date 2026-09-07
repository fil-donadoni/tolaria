---
title: retrying pr-merge after a failed land silently skips land's whole post-merge half
discoveredBy: 3107
status: draft
confidence: high
---

**What is wrong.** CLAUDE.md § Quality gates tells you, when only the MERGE leg
of `land` failed, to "retry `bun scripts/pr-merge.ts <PR#>` — never a second
`land`, which re-pays the whole gate." That advice is right about the gate and
silent about everything else: `pr-merge.ts` merges and stops. Every step
`land.ts` runs AFTER the merge is then simply never run, with no warning, and
the session is left believing it landed cleanly.

**Evidence.** `scripts/land.ts` owns five post-merge steps that
`scripts/pr-merge.ts` has no counterpart for:

| step                                              | `land.ts`  |
| ------------------------------------------------- | ---------- |
| write the green-sha marker                        | `:6`       |
| fast-forward the primary checkout's local `main`  | `:488-503` |
| detach `health:main` on the merged tip (ADR 0110) | `:543-560` |
| seed the PR's preset scenario (ADR 0044)          | `:562-568` |
| remove the worktree and both branch refs          | `:589-592` |

Observed on PR #3121: `land` rebased, passed `check:pr` in 471.1s, force-pushed,
and then died on `gh pr merge` against a GitHub **secondary** rate limit (the
primary GraphQL quota read 5000/5000 `used:0` throughout — it is the
anti-abuse limiter on mutations, tripped by a burst of issue/comment/PR
creations, and it cleared after ~9 minutes of backoff). The retry merged. Nothing
else happened: local `main` stayed behind, the worktree and branch survived, and
no health gate was armed on the merged tip.

**Why this is worse than it sounds.** The skipped fast-forward is the one
CLAUDE.md explicitly says never to do by hand — "the API merge moves only
`origin/main`, and the next worktree must not branch from a stale one" — so the
recovery is a step the rules forbid, performed by whoever notices. The skipped
`health:main` is load-bearing for the green-main invariant (ADR 0110): main was
merged with no health gate armed on the tip, and nothing would have flagged it.
The skipped scenario seed is the ADR 0044 step that was already silently dropped
once (33 specs recovered by `bun run seed:backlog`).

**The shape of a fix.** A rule that CAN be enforced mechanically belongs in a
script: either `pr-merge.ts` performs the post-merge half itself when it is the
one that merged, or `land.ts` learns to resume — detect that the PR is already
merged at the tree it gated, skip straight past rebase and gate, and run the
tail. The second is better: it keeps one owner for the sequence, and it makes
the documented "retry" a retry of `land` rather than of a leg that cannot
finish the job. It would also want a guard, since this is a failure mode nobody
sees while it is happening.
