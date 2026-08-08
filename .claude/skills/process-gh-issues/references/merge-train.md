# Gating the landing tree (SKILL.md §4 step 4) and merge failure modes

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

    **Lane B — no required checks (or they don't cover the suites).** The local full gate is the only gate: run the project's whole `check:all` + full `test` (CLAUDE.md § Quality gates) on the rebased tree, then push and merge.
    - Run it from a **dedicated gate worktree** (detached HEAD at the rebased commit, e.g. `tolaria-gate-<batch>`), never from the issue worktree — the issue-worktree guard (the pre-PR gate step below) blocks the full suite on a `feat/issue-N` / `fix/issue-N` branch by design, and never from a gate worktree another session already occupies (check `git worktree list` first). If gating in place is unavoidable, prefix with the escape hatch (`TOLARIA_ALLOW_FULL_SUITE=1 bun run test`). The train is the only caller entitled to that flag. The gate holds a machine-wide mutex, so a train gate and a concurrent session's gate serialize instead of halving each other — `[gate] waiting …` is expected output, not a hang.
    - **A fresh worktree is not runnable as-is** — same gap as `references/subagent-brief.md` step 1, and the gate worktree is a fresh worktree. Bootstrap it first: **`bun run worktree:init`** in Tolaria, or install deps + copy the codegen dir and `.env.local` by hand elsewhere. Skipping this produces `N files failed, 0 tests failed`, which reads as a catastrophic red rather than a setup error.
    - **Never pipe the gate through `tail`/`head`** — the exit code becomes the pager's, and a red suite reports success. Redirect to a file and grep the summary, or read the exit code directly.
    - Dedup, not relaxation: skip the run **only** if `git rev-parse HEAD^{tree}` equals a tree a full gate already passed (track the tree hashes of passing gates — e.g. an unchanged retry after a verdict wait).
