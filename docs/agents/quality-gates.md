# Quality gates — why each tier is shaped the way it is

Companion to `CLAUDE.md` § Quality gates, which carries the **norms**: what to
run, when, and what may never be skipped. This file carries the **reasoning and
the measurements** — the material that explains a rule but does not need to be
re-read on every request of every agent.

The split follows the residency finding in `context-residency-audit.md`:
CLAUDE.md is resident in every session and every subagent, so a token there is
paid a few thousand times; a token here is paid when someone asks why.

## Why `check:pr` may never be hand-picked

`check:pr` = format + lint + type-check + `check:index` + `check:stubs` +
`check:guards`. Omitting `check:index` once broke **every card-shipping PR at
the merge-train** — the failure is not local to the branch that skipped it.

## What `check:guards` actually runs, and why its scope is pinned

Three lanes:

1. **The bot suite's fast lane** (#1912) — `TOLARIA_BOT_FAST=1`, deny-list in
   `vitest.config.ts`, ~60s. Home of the catalogue-wide bot guards:
   `aiEffectsGuard`, `pickRatings`, `opValuerCoverage`, the censuses.
2. **The whole node project** — `convex/**` + `scripts/**` + every DOM-free
   `src` test. 692 files, ~30s at the light tier's 2 workers: no dom env init
   and `isolate: false`, so the card registry is imported once per worker.
3. **`bun run cr:lint`** (#2429), ~1s — offline, reads only the vendored CR, so
   the gate's no-network contract holds.

**Lane 2 used to be filtered to `scripts/__tests__`.** That left every backend
catalogue guard outside the light gate — `effects/validate`'s
Op-registry/executor/schema coverage, `mechanicsRegistry`, `divergenceMarkers`,
`serialize`'s drift check. A branch reached review with `validate.test.ts` red
and a `check:pr` that exited 0. Fixed in #2431; scope now pinned by
`scripts/__tests__/check-guards-scope.test.ts`, and bot deny-list drift by
`bot-fast-lane.test.ts`. Widening or narrowing a lane means changing that
guard, which is the point.

## The dom project is need-classified, not directory-classified

`scripts/test-env-split.ts`, computed at config load: a `src/**/*.test.ts` with
no DOM global, no testing-library import, no jest-dom matcher and no
`vi.mock`/spy/fake-timer runs in the **node** project instead — 110 files
today, and a file that grows a DOM dependency moves back by itself (#2433).
`bun run test:app` went 190s → 108s at the heavy tier.

The partition is pinned by `scripts/__tests__/src-test-env-split.test.ts`. The
failure it exists to prevent is subtle: a file selected by **no** project runs
nowhere and the gate stays green.

### What genuinely needs a DOM stays outside the light gate

252 files. Issue #2435 swapped the environment to `happy-dom`, measured
back-to-back on the same tree with
`TOLARIA_VITEST_WORKERS=2 bunx vitest run --project dom` (2207 passed both
ways):

| environment | wall    | `environment` phase |
| ----------- | ------- | ------------------- |
| happy-dom   | 119.35s | 44.33s              |
| jsdom       | 180.05s | 113.03s             |

~34% off wall, ~61% off the `environment` phase. Per-file environment init
still dominates, so no deny-list helps and `--pool=threads` measured identical.
Cover `src/` changes with targeted runs.

**Its one known cross-boundary breakage class** is caught statically instead of
by running it: a `vi.mock("@convex/cards")` factory going stale when a name
becomes barrel-internal (#2339 — 102 tests across 12 files, seen first at the
merge-train). `scripts/__tests__/convex-cards-barrel-mock.test.ts` runs in the
node lane and catches it at light-gate speed.

## Why `check:all` verifies formatting instead of repairing it

`format:check`, not `format`. #1807: a gate that repairs what it checks can
never fail. On drift, run `bun run format` and re-run.

## Why the suites are three separate invocations

`bun run test` = `test:app` (everything not `*.bot.test.ts`, ~580 files) →
`test:bot` (ISMCTS/eval/driver/self-play) → `test:blade` (must tier, own
config, ~42s). `test:bot` is a separate invocation so heavy episodes get an
uncontended run. Blade's stretch tier stays report-only and manual
(`bun run test:blade:stretch`).

## Why there is no CI

The three GitHub Actions workflows (`lint`, `test`, `blade`) were deleted
2026-08-08 (#2407). The plan's Actions minutes ran out, and with no branch
protection on this repo (`/branches/main/protection` → 403, needs Pro) they
gated nothing — every job duplicated a command the local gate already runs.

Consequences that are still live: nothing may be left to CI, and the
merge-train always takes Lane B (local full gate on the rebased tree).
**Re-adding a workflow only makes sense together with branch protection** —
otherwise it is a report nobody blocks on.

## Hooks, and why they are tracked in git

`.husky/pre-commit` — lint-staged/prettier on staged files. A convenience;
skipped by merge/rebase/cherry-pick, so never rely on it.

`.husky/pre-push` — diff-scoped `prettier --check` on pushed commits. A push
updating the **default branch** also runs the full gate (#2203), skipped only
when the SHA is already in `.claude/telemetry/green-sha`, or explicitly via
`TOLARIA_SKIP_PUSH_GATE=1` (which prints a red banner).

Both are tracked in git and guarded by
`scripts/__tests__/worktree-bootstrap.test.ts`, because a missing husky hook is
silent — it vanished for six weeks once before anyone noticed.

## CPU admission control

`scripts/gate.ts`, because several sessions share this machine. A queued heavy
gate is not a hang; stale locks are auto-pruned.

The full gate is blocked inside an issue worktree (`feat/issue-N` /
`fix/issue-N` → exit 1): the merge-train runs it once per landing tree.
`TOLARIA_ALLOW_FULL_SUITE=1` is the orchestrator-only escape hatch.

## Worktree isolation, and the documentation lane

Measured over the 30 days to 2026-08-17: **~40 documentation-only commits
landed straight on `main`** — ADRs, PRDs, CONTEXT.md entries, findings notes,
several with messages like `update context` or `findings allineati`. Two of
those days also carry a `Merge branch 'main' of …`: local `main` had diverged
from origin and was reconciled with a merge commit. Meanwhile 31 worktrees had
accumulated, several dirty, several on already-merged branches.

The cost is not tidiness. **Markdown is gated**: `format:check` covers
`**/*.md`, `cr:lint` reads CR citations out of prose, and `adr-index`,
`resident-context-budget`, `findings`, `project-skills` and `action-space` all
read documentation files. So an unfinished ADR sitting in the shared checkout
reds `check:all` for every OTHER session on this machine, on a file unrelated
to their work — which under the green-main invariant they must stop and deal
with. The user-visible symptom is "I launch three sessions and they fight".

The rule "never work in the shared main checkout" already existed, but it lived
inside `.claude/skills/process-gh-issues/SKILL.md` — so `/process-gh-issues`
isolated every time and an ordinary discussion never did. It is now in
`CLAUDE.md`, and enforced:

- `deny-guard.sh` § 0 denies `Edit`/`Write`/`MultiEdit`/`NotebookEdit` on a
  **versioned** path in the main checkout. Gitignored paths (`.claude/telemetry`,
  `.claude/receipts`, `*.local`) stay writable — the loop writes `green-sha` and
  its receipts there by design. Linked worktrees are untouched. Per-session
  hatch: `TOLARIA_ALLOW_MAIN_EDIT=1 claude`.
- `deny-guard.sh` § 4 additionally denies `git add -A` / `git add .` there —
  `git commit -a` in two steps, and the same sweep of another session's work.
- Known hole, accepted: a `cat > file` heredoc in Bash still gets through.
  Matching redirections inside a command string is the false-denial shape § 4's
  header is about, and the authoring tools are what a model actually uses.
- `deny-guard.sh` § 1 denies `gh pr merge` **anywhere** (#2537), not just from
  an issue worktree: the gate mutex serialises gating, `land` extends it over
  the merge, and a merge typed by hand takes no lock at all — three did on
  2026-08-18, two of them from the main checkout as recovery after `land`
  failed. `land`'s own merge is a child process, invisible to the hook by
  design. Per-command hatch, naming the one merge it authorises:
  `TOLARIA_ALLOW_MANUAL_MERGE=1 gh pr merge <PR#> --squash`.
- **Still open, and unclosable from a hook: the GitHub web UI.** No hook sees a
  merge clicked in a browser, so nothing stops `main` moving that way. The only
  defence is not doing it; `land` exists so there is no reason to.
- Heredoc BODIES are stripped before any rule reads the command
  (`.claude/hooks/lib/strip-heredoc-bodies.awk`): a commit message, a PR body
  or a `python3 - <<'PY'` patch is data the shell never executes, and a
  substring scanner cannot tell it from a command. Widening § 1 made this
  load-bearing — a patch script that merely MENTIONED the merge was denied.

**The documentation lane** is the door beside that wall. A prose change cannot
break the engine, so it does not owe the heavy suite:

```
bun run wt:docs <slug>     # worktree + docs/<slug> branch off origin/main
… write the document …
bun run docs:ship          # check:docs → commit → rebase → push → PR → merge → teardown
bun run docs:ship --no-merge   # …but leave the PR open
```

`check:docs` = `format:check` + `cr:lint` + the five guards that read prose
(`DOC_GATE_TESTS` in `scripts/docs-lane.ts`). Seconds, `light` tier, no
machine-wide lock — which is what makes a PR per discussion affordable instead
of a tax people route around.

**Its MERGE, however, takes the lock** (#2537). Gating and merging are separate
acts: a docs merge moves `main` exactly as much as any other, and `main` moving
under a session mid-gate is what makes that session's verified tree stop being
the tree that lands. So `docs:ship` re-runs the rebase, `check:docs` and the
force-push _inside_ one `gate.ts heavy` invocation and merges there — paying
the queue for the seconds it merges in, and for nothing else. The cheap gate is
untouched; `bun run check:docs` on its own still takes no lock.

`docs:ship` refuses a changeset containing anything that is not `*.md` or under
`docs/`: a mixed change goes through the ordinary branch and the full gate.

**The list is the lane's weak point, so it is guarded.** `docs-lane.test.ts`
runs a census: any test under `scripts/__tests__` whose source reads a
documentation path must be either in `DOC_GATE_TESTS` or in
`DOC_GATE_TESTS_EXCLUDED` with a recorded reason, and `check:docs:inner` in
`package.json` must run exactly the covered set. A new doc guard that nobody
adds to the lane fails the census rather than silently narrowing the gate.
