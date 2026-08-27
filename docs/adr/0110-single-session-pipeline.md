# Single-session pipeline: one context closes one issue

## Status

accepted (reshapes the fan-out pipeline of ADR 0097/0099; builds on ADR 0109)

## Context

The 2026-08-25→27 cost incident (91% of the weekly allowance in 48h) forced a
measured decomposition of the fan-out pipeline. Per-role weighted cost over
72h, from subagent side-files (~45 issues landed, ≈$270 API-equivalent each):

| Component                                       | Share |
| ----------------------------------------------- | ----- |
| Review chain (opus, 3.5 spawns/PR, multi-round) | 24.9% |
| Orchestrator (48 loop-pass main sessions)       | 21.8% |
| Implement subagents (opus 21.9% + sonnet 13.7%) | 35.6% |
| Fixup subagents (each a fresh cold context)     | 16.0% |

Three structural findings:

1. **The orchestrator's entire value was parallelism.** File-disjoint
   batching, claims, receipts, cross-checking, the merge-train — all exist so
   four cold-context subagents can work at once. The coordination cost ~$59
   per pass and duplicated every issue's context (orchestrator + subagent
   both near 200k tokens).
2. **A fixup round costs a full re-discovery.** Each fixup spawn was handed
   ~45k tokens and re-read the tree; in one context the review feedback would
   land where the knowledge already is.
3. **A measurable share of review findings were pipeline artifacts** —
   vacuous tests, malformed receipts, client/server mismatches from
   implementers that never saw the other half of the system. The pipeline
   generated defects and then paid opus to find them. Implementer-model data
   (n=24 joined chains): sonnet $67/issue total vs opus $124/issue — opus
   reduces rounds (1.30 vs 1.64 review, 0.50 vs 0.93 fixup) but its premium
   exceeds the rounds it avoids.

The user's target: **a median issue closes in 10-15 minutes for <0.5% of the
weekly budget** — the rate every other project on this machine gets from
plain single-session work.

## Decision

1. **One session, one issue, no orchestrator.** The `/next-issue` skill runs
   the whole chain in the invoking session: pick (board priority via
   `queue:plan --cap 1`) → claim (`in-progress` label) → ephemeral worktree →
   implement → targeted tests → one review round → fix in-context → PR →
   `land`. No implement subagents, no receipts, no train.
2. **Review is one round, routed by risk.** Opus reviewer only where the diff
   touches `convex/gre/**` or `**/ai/**` (or the issue carries `model:opus`);
   sonnet elsewhere; none for docs-only diffs. Fixes land in the same
   session; no automatic re-review — the lane gate catches regressions.
3. **`land` runs the LANE gate synchronously; the full gate moves post-merge.**
   `land` = rebase → `check:lane` → push → merge (still one atomic unit under
   the machine mutex), then detaches `bun run health:main`: the full offline
   gate (`check:all` + all three suites) on the merged tip, in a throwaway
   worktree, deduplicated by sha. Red → a durable `RED` marker that `land`
   and `health:status` surface; the fix is fix-forward. This trades
   "green-main absolute" for "green within one health cycle" — the absolute
   was already fiction under concurrency: on 2026-08-27 three individually
   full-gated PRs bypassed each other's ratchet adjustments and `main` was
   red DESPITE per-PR full gates.
4. **A `skin` receipt is owed only by a diff that can reach the DOM.** A
   `src/**` diff consisting solely of test files is exempt from the
   `check:ui` receipt (`.claude/rules/chrome-debug.md` already said nothing
   is owed; the classifier now agrees).
5. **Worktrees are ephemeral and self-cleaning.** Bootstrap is measured at
   1.9s warm (`bun install` beats even an APFS clone at 12s — no symlinks,
   no standing "slot" worktrees), so a worktree exists exactly as long as
   its PR. `land`'s default teardown already removes it; `health:main`
   reports stale worktrees so corpses surface instead of accumulating.
6. **Parallelism moves to the human.** N parallel sessions in N worktrees
   coordinate through exactly two points: the `in-progress` label at claim,
   and the `land` mutex at merge. The budgeted serial AFK driver (ADR 0109)
   remains the unattended path.

## Consequences

- Projected cost per median issue: ~$45-65 API-equivalent (sonnet implement
  ~$24-34, one routed review ~$5-19, no orchestration) — inside the 0.5%
  target; wall-clock bounded by implement + lane gate, not by train position.
- `/process-gh-issues` and its fan-out machinery are legacy: kept working for
  the transition, scheduled for removal once `/next-issue` has drained real
  issues for a while. Receipts, claims-cross-checking and the merge-train
  retire with it.
- The defect classes reviews caught most get structural answers instead of
  opus time: shared-state pollution → the frozen catalogue
  (vitest.setup.node.ts, #2871); vacuous tests → a mechanized
  mutation-smoke gate (planned follow-up); cross-boundary breaks → the
  full-path integration test requirement stays.
