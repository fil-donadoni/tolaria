# Gating the landing tree (SKILL.md §4 step 3) and merge failure modes

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered once per run (to pick the lane) and again whenever `gh pr merge` misbehaves. The lane choice
is the difference between gating the tree that LANDS and gating a tree `main` has already moved past.

---

4. **Gate the rebased state.** Every landing tree is gated exactly once. **WHERE that gate runs depends on whether the repo has required CI status checks — determine this once per run, before the first merge:**

    ```bash
    gh api repos/<owner>/<repo>/branches/<default>/protection \
      --jq '.required_status_checks | {strict, contexts}'   # 404 → no protection
    ```

    **In Tolaria the answer is settled: Lane B, always.** The probe returns 403 (branch protection needs GitHub Pro) and since 2026-08-08 the repo has no workflows at all — the Actions minutes ran out and, ungated, the jobs were reports nobody blocked on. Skip the probe here; run it in a repo whose CI posture you do not already know.

    **Lane A — required CI checks exist and cover the test suites (PREFERRED).** CI is the gate; do **not** re-run the full suite locally.
    - Push the rebased branch (`git push --force-with-lease`) and wait for the required checks to go green, then `gh pr merge --squash --delete-branch`.
    - Run locally **only what the required set does not cover.** Required contexts are frequently just the test suites, leaving type-check / lint / format in a non-required job — run those yourself (`bun run check:all`), they are minutes, not the suite.
    - **Why this is stricter, not looser.** With `strict: true` the branch must be up to date with the base, so CI runs on the exact tree that lands. A local gate cannot promise that: `main` moves while the suite runs, and the tree you verified is not the tree you push. That is not hypothetical — it happened twice in one session against a repo with concurrent agents. CI also runs uncontended, off the machine-wide gate mutex.
    - **`gh pr merge` failure modes to expect.** `BLOCKED` = required checks still pending, or `strict: true` and the branch fell behind (rebase again, force-push, wait for the re-run). `UNSTABLE` = mergeable, but a **non-required** check failed — inspect it before merging: if the failure is inside this PR's diff, treat it as red and hand back to fixup; if it is pre-existing on the base, merge and open a separate fix. `gh pr merge` may also print a local `fatal: 'main' is already used by worktree at …` **after** the API merge succeeded — always re-check `gh pr view N --json state` before treating it as a failure.

    **Lane B — no required checks (or they don't cover the suites).** In Tolaria this is the only lane, and the per-PR step is **`bun run land <PR#>`**, run from that PR's own worktree.
    - **Why a single command, not fetch → rebase → gate → push → merge as four separate steps.** The four-step version leaves nothing holding `main` still between "gate green" and "merge lands" — with several sessions draining the queue concurrently, `main` routinely moves in that gap, forcing a re-rebase and a re-paid full gate (issue #2517: three heavy gates, ~20min queueing each, for one two-file branch nobody else touched). `land` holds `scripts/gate.ts`'s machine-wide heavy mutex across the **entire** sequence — fetch → rebase → `check:all` → `test` → `push --force-with-lease` → `gh pr merge --squash` → write `.claude/telemetry/green-sha` → tear down the worktree — as ONE `gate.ts heavy` invocation. A second session's `bun run test` queues behind the whole thing, not just the suite.
    - **Re-entrancy is not new locking.** `check:all`/`test`, run as ordinary steps inside `land`'s locked command, each invoke `gate.ts heavy` themselves. That is safe because `gate.ts` already stamps `TOLARIA_GATE_HELD=1` on the child it spawns and every process downstream inherits it, so the nested calls pass straight through instead of trying to re-acquire (`scripts/gate.ts` — do not re-litigate). `land` also sets `TOLARIA_ALLOW_FULL_SUITE=1` for its own `gate.ts heavy` call, because the issue-worktree guard would otherwise refuse the heavy tier on the `feat/issue-N`/`fix/issue-N` branch `land` runs from — `land` IS the merge-train, the case that guard exempts.
    - **Refuses, with a named reason, before ever taking the lock**: a dirty tree, the branch being `main`, the PR not being open, or the PR's head branch not matching the current branch. A rebase conflict inside the locked run `--abort`s automatically and exits non-zero naming the conflicting paths — no worktree is ever left mid-rebase.
    - `bun run land <PR#> --no-merge` gates and pushes without merging (leaves the PR open); `bun run land <PR#> --keep` merges but skips the worktree teardown.
    - `land` does not bootstrap the worktree it runs in — same gap as `references/subagent-brief.md` step 1. The worktree is already bootstrapped by the implement-subagent that created it (`bun run worktree:init`); nothing further to do here.
    - `land`'s exit code is `gate.ts`'s exit code is the locked shell command's exit code — inherited via `stdio: "inherit"`, never piped through `tail`/`head`, so the "a red suite reports success because the pager ate the exit code" failure mode is structurally unavailable.
    - **`.claude/hooks/deny-guard.sh` §1 still blocks a hand-typed `gh pr merge` from an issue worktree** — it inspects Bash TOOL calls, not the child processes `land` spawns, so the merge embedded in its locked command is invisible to the hook by design, not a hole. Do not weaken the hook.
    - Dedup still applies at the orchestrator level: before invoking `land` on a PR you are resuming, check `gh pr view <pr> --json state` (SKILL.md §4, "Resuming an interrupted train") — `MERGED` means there is nothing left for `land` to do.
