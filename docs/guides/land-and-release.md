# Land and release

**The whole delivery path, in order: a worktree off the [base branch](#g-base-branch),
a PR handed to the land-runner, whose `land` pays the [lane gate](#g-lane-gate),
once — and, when a human decides, `release`.** Six commands. Everything else in the repository's workflow tooling serves one of
them or is history.

```bash
cd "$(bun run --silent wt:new <N>)"   # 1. worktree off origin/<base>   (--fix for a bug)
…                                      # 2. implement; bunx vitest run <path> while iterating
git add -A && git commit               # 3. commit
git push -u origin feat/issue-<N>      # 4. no pre-PR gate (ADR 0136 §1)
gh pr create                           # 5. base = the base branch (GitHub default), no --base
bun run land:ready <PR#>               # 6. hand off: the land-runner rebases, gates, merges
```

Since issue #5469 a session never runs step 6's `land` itself (`deny-guard.sh`
§ 8): `land:ready` labels the PR `ready-to-land` and the **land-runner** — one
`bun run land:runner` on the MacBook, started by `bun run loop:afk --start` or
its launchd agent (`scripts/runner-units/com.tolaria.land-runner.plist`) —
runs `land` in the PR's worktree, oldest PR first. A red `land` relabels the
PR `land-failed` with the lane excerpt as a comment; `queue:plan` makes it a
repair pick. **Where a failure shows up** (issue #5599): the owner
notification (`notifyOwner`: `TOLARIA_NOTIFY_CMD`, else the desktop notifier),
one per burst of ticks with PRs of the same cause coalesced and a repeated cause
called out as "likely infra, not the PRs"; the `land-failed` label with the
runner's comment on the PR; and the logs,
`.claude/telemetry/land-runner/runner.log` plus `land-<PR>.log` for the detail.
The sections below are what `land` does when the runner — or an
owner, with `TOLARIA_LAND_RUNNER=1` — runs it.

```bash
cd /Users/filippo/code/mtg/tolaria     # the primary checkout, on the release branch
bun run release --dry-run              # what would move, nothing moves
bun run release                        # full gate on the base tip, then main fast-forwards
bun run release --no-fix               # ... but refuse on RED instead of starting a fix
bun run health:fix                     # repair a standing RED without a release
```

Branch names are not in this guide because they are not in the scripts either:
`tolaria.config.json` names the [base branch](#g-base-branch) (`staging` today)
and the [release branch](#g-release-branch) (`main`). Only
`scripts/lib/branches.ts`, `deny-guard.sh` and `gate-run.sh` read that file
(ADR 0116).

## Landing a change on the base branch

### 1. `bun run wt:new <N>`

Fetches `origin/<base>`, creates `../tolaria-issue-N` on `feat/issue-N`
(`--fix` → `fix/issue-N`), runs `bun run worktree:init` (node_modules,
`convex/_generated`, `.env.local`, the merge driver), prints the path on its
last line so `cd "$(…)"` works.

Why not `git worktree add` by hand: the primary checkout keeps the
[release branch](#g-release-branch) checked out, so a branch off its HEAD
starts every issue a release behind the [base branch](#g-base-branch) — and a
rebase conflict gets manufactured out of nothing.

Never write a versioned file in the primary checkout (`deny-guard.sh` § 0):
markdown included.

### 2. Implement

Targeted runs only: `bunx vitest run <path>`. The full suites are blocked
inside an issue worktree by design. Every guarding test is proven to fail
once (break the subject, watch red, revert, say what you broke).

### 3. Commit

`land` refuses a dirty tree, and the lane it runs is keyed on the rebased
tip's sha — a tree that is not committed is not a tree anything gated.

### 4. No pre-PR gate — the [lane gate](#g-lane-gate) is `land`'s

There is no `check:lane` before the PR (ADR 0136 §1). At 2.5 PR/h the base tip
moved while that gate ran, so it certified a tree that never landed and `land`
paid the lane again on the rebased one: two lane runs plus 1.35 `land`s per
issue, ≈ 17 min of gate. The session's signal before the PR is its targeted
vitest runs and the review round. The lane is paid once, in `land`, step 4
below.

A hand-run `bun run gate:run check:lane` stays available and ungated — no
preflight refuses a stale tree any more (issue #3286's was retired with the
pre-PR gate). Run it on a tree already rebased onto `origin/<base>` and a green
verdict is one `land` can reuse. It classifies the diff against
`origin/<base>` and runs exactly what that lane owes:

| Lane     | Diff                                                         | Runs                                                                                                                         | Measured |
| -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| `skin`   | `src/**`, `public/**`, `index.html` only                     | format, lint, `check:ts` (app + scripts), bundle, `dom` + `node`/src, plus each bot project the diff can reach (issue #3435) | ~222 s   |
| `engine` | no `src/**`                                                  | format, lint, whole `check:ts`, index/stubs, bot fast lane, `node`                                                           | ~175 s   |
| `docs`   | markdown only                                                | `check:docs` — seconds                                                                                                       |          |
| `full`   | anything else (mixed, `package.json`, `.claude/**`, scripts) | `check:pr` verbatim                                                                                                          | ~305 s   |

**Never hand-pick a subset of `check:pr`.** On formatting drift run
`bun run format` and re-run; the gate verifies, it does not repair.

A diff that can change what a user sees also owes **`bun run check:ui`** — five
viewports, the occlusion probe, axe — and its output pasted byte-exact in the
PR ([Browser verification](browser-verification.md)). `land` re-derives that
receipt and refuses a `skin` PR whose receipt does not match.

### 5. The PR

`gh pr create` targets the [base branch](#g-base-branch) because it is the
repository's default branch — no `--base`. The body carries: the `check:ui` receipt
when owed, a `## Preset scenario` fence for
any `convex/{cards/sets,gre}` change (or "none owed"), the Bot reachability
outcome, proof-of-failure receipts for new guarding tests.

### 6. `land <PR#>` — what the land-runner runs, from the PR's worktree

Refuses, named, before taking any lock:

- on the base or release branch, a dirty tree, PR not open, PR head ≠ current
  branch;
- **PR base ≠ the base branch** — the API merge lands wherever the PR points,
  and a PR against the release branch would ship to production unreleased.
  Fix: `gh pr edit <PR#> --base <base>`;
- a `skin` diff whose pasted `check:ui` receipt fails verification;
- a card/engine diff with no preset scenario; a lockfile row retired without
  its PR naming the card.

No preflight runs before the queue (retired by ADR 0154 §5, issue #5457:
every run printed `preflight skipped`, and the lane under the mutex is the one
gate). Then, under the machine-wide [heavy mutex](#g-heavy-mutex), as ONE
shell command so the tree that lands is the tree that was gated:

1. `unset GITHUB_TOKEN` — the bug-report PAT `.env.local` carries cannot merge.
2. `git fetch origin <base> && git rebase origin/<base>` — on conflict: prints
   the paths, `--abort`, exits; the tree stays usable.
3. Regenerates the generated artifacts the rebase marked.
4. The lane gate on the rebased tree — `bun run check:lane`, printed as
   `lane: ran` — **unless** that exact rebased tip was already gated green
   against that exact `origin/<base>` sha, printed as
   `lane: skipped (gated <sha> against <base>)`. The green records are
   `gate-run.sh`'s run dirs (`~/.cache/tolaria/gate-runs/*/{head,base,command,green}`,
   exactly `check:lane`) and the one `land` writes after its own green lane,
   so a `land` retried after a merge refusal does not pay the lane twice. Any
   mismatch, or a dirty tree, runs the lane.
5. `git push --force-with-lease` of the feature branch.
6. Merge through the API (`scripts/pr-merge.ts`, squash, retried on the
   transient refusal a fresh force-push causes).
7. Verifies `origin/<base>` advanced by exactly one commit — ours. Anything
   else means someone pushed to the base branch from outside the lock, and the
   housekeeping below is skipped rather than run on a tip nobody gated.
8. Housekeeping, none of it gating: fast-forwards the primary checkout's local
   base branch if it is the one checked out; seeds the PR's preset scenario
   into the local Convex deployment; ingests telemetry; deletes the remote and
   local branch and removes the worktree (`--keep` keeps all three;
   `--no-merge` stops after step 5).

**Nothing GitHub-bound after the merge.** `gaps:sync`, the grammar residue,
the `in-progress` claim release and the umbrella detach are the hourly
[`housekeeping` cron](#the-housekeeping-cron--the-github-bound-post-merge-steps)'s,
so a GitHub 502 costs the cron a retry, never the session.

**No health gate per landing**, and none held by the landing's own lock. A
landing costs the mutex 3–5 minutes; a landing whose lane is skipped costs only
the rebase and the merge. The full gate runs once per BATCH — see below.

If only the MERGE failed (step 6), retry `bun scripts/pr-merge.ts <PR#>`. A
second `land` of the same tree re-pays only the rebase — step 4 skips the lane
it already passed — but it is still the long way round. `deny-guard.sh` § 1 denies a
hand-typed `gh pr merge` everywhere; `TOLARIA_ALLOW_MANUAL_MERGE=1` is the
per-command hatch for a real recovery.

#### Recovery: the housekeeping alone, on a PR that already merged

`land` on a **MERGED** PR runs step 8 and nothing else — no rebase, no lane
gate, no merge. It says so on its first line, `land: mode=housekeeping — …`.
That is the mode a `pr-merge.ts` retry leaves owing, and a hand-typed merge
too: the seed, the fast-forward, telemetry all still
have to happen. (The GitHub-bound steps need nothing: the cron below finds
every merged PR, however it merged.)

**Run it from anywhere, the primary checkout included** (issue #4378):

```bash
TOLARIA_LAND_RUNNER=1 bun run gate:run land <PR#>   # from ~/code/mtg/tolaria, on the base branch
```

Housekeeping mode drops the two branch-identity refusals the full path keeps —
"land runs from the PR's own branch" and the head-branch mismatch. It has to:
the recovery exists for a PR whose worktree is **gone** (a previous run tore it
down and then crashed, or someone removed it by hand), and that worktree is the
only checkout the full path would have accepted. Everything the housekeeping
needs a branch for it takes from the PR's own `headRefName`, and the worktree
it tears down is the path `wt:new` would have created for the issue that branch
names (`scripts/lib/issue-worktree.ts`, the one definition both use) — never
the directory you happen to be standing in. `land` prints that path before it
starts, marked `(absent — skipped)` when there is nothing there to remove.

The refusals that **stay** in housekeeping mode are the structural ones: a
dirty tree (the teardown would discard it) and a PR merged into some base other
than this one (its housekeeping is not the base branch's to run).

### The `housekeeping` cron — the GitHub-bound post-merge steps

`bun run housekeeping` (`scripts/housekeeping.ts`, ADR 0154 §5, issue #5457)
walks the PRs merged into the base branch since its watermark and runs what
`land` used to run after the merge:

1. `git fetch` + fast-forward of the primary checkout — refused (nothing
   processed) when it is not on the base branch, since `gaps:sync` pushes its
   allowlist write from there. A local `gaps:sync` commit whose push lost a
   race is dropped (`reset --keep`); the next sync re-derives it;
2. `gaps:sync` once for the batch, `--band P0` when any PR of the batch closed
   P0 work; if it fails, the steps below still run and every PR of the batch
   is retried;
3. per PR, oldest merge first, for a branch naming issue N:
   `grammar:residue N --pr <PR#>` (holes it cannot file are logged for a
   human, never retried), the `in-progress` claim release on N,
   `umbrella:detach N`;
4. `umbrella:detach --sweep` once.

Merged PRs are listed by last update, newest first, until one older than the
watermark — a merge updates a PR, so none is missed however long it was open.
Every step is idempotent, so a second run with nothing new merged is a no-op.

`gaps:sync` now pushes to the base branch outside `land`'s mutex, often from
the other machine. `land`'s merged-tip check (step 7 above) does not count
that one commit — the `gaps:sync` subject on a diff of `data/grammar-gaps.json`
alone — and still refuses any other foreign push.
State and logs live in the primary checkout's
`.claude/telemetry/housekeeping/`: `state.json` (the watermark, plus the PRs
whose steps failed — retried each run, given up loudly after 24 attempts) and
`housekeeping.log` (every child's output). A missing state file looks back
24 h; `--since <ISO>` moves the watermark back for a backfill, `--dry-run`
prints the plan and writes nothing. Exit 0 = nothing to do or all done, 1 =
something left to retry.

It runs on the crons machine (Huawei, topology B'), from its primary
checkout, hourly:

```cron
0 * * * * cd ~/code/mtg/tolaria && bun run housekeeping >/dev/null 2>&1
```

Until a PR's steps have run, its issue may still carry `in-progress`: that is
harmless, since the session cap counts OPEN claimed issues only.

### The batch health gate — a schedule, not a cadence

The full offline gate is not a landing's business, but it is not a release's
either: between releases the base tip could stand red for the 1–2 days
observed. It runs per BATCH (ADR 0136 §6) — and since issue #5655 the batch is
a clock: `.github/workflows/health.yml` runs `bun run health --scheduled
--retry-infra` (ADR 0156 §4). `land` records no landing and detaches no
decision; the 20-landing / 8 h counter, its ledger and the health runner that
read it were deleted.

- **Dedup.** By sha: a tip already GREEN is not gated again, and a tip health
  has already been started for is not started twice (that stamp expires after
  90 min, so a run killed before it wrote a verdict costs one window).
- **Verdict.** The commit status `context=health` on the gated sha is the only
  store; a RED stands there until a GREEN, or a proved repair's AMBER, answers
  it. `queue:plan` refuses the next PICK — never the next LAND, because the
  fix-forward arrives through a `land` and a session already mid-issue must be
  able to finish — and the repair starts with `bun run health:fix`.
- **Repair.** `bun run health:fix repair-issue --issue=<N>` records the repair
  issue on the pivot; after a proved repair `land` runs `bun
scripts/health-fix.ts amber --sha=… --repair-of=…`.

## Releasing the base branch to production

`bun run release`, from the primary checkout, when a human decides. Vercel
deploys the [release branch](#g-release-branch) and only it, so this is the
production deploy.

1. Fetches both branches. Same tip → "nothing to release", exit 0.
2. `--dry-run` stops here, printing the tip and the commit count.
3. Runs the [health gate](#g-health-gate) on the `origin/<base>` tip under the
   [heavy mutex](#g-heavy-mutex): a throwaway worktree at that sha,
   `check:all` then `bun run test` (app, bot, blade), ~13 minutes with the
   4-worker cap. Deduplicated by sha: a tip already GREEN is not re-gated.
   The terminal is never silent (issue #3487): each step prints
   `health-main: [2/3] check:all — start` and `… — exit 0 after 4m12s`, the
   gate's `[gate] waiting … for the heavy mutex` lines arrive live (a queue,
   not a hang), and a long step prints `… — still running, 5m00s elapsed`
   every minute. The full child output still goes only to the per-sha log.
4. Reads `.claude/telemetry/health/last.json` and releases **only** if the
   record is GREEN and about exactly the tip being promoted. A record about
   another sha, a RED, or a run still marked `running` refuses with the reason.
5. On RED — and only on RED — hands the tip to the [fix loop](#g-fix-loop)
   below, then gates again. Everything else refuses.
6. `git push origin <sha>:refs/heads/<release>` — a plain refspec, so git
   itself refuses a non-fast-forward. Never `--force` (`deny-guard.sh` § 2
   denies it for both configured branches).
7. Fast-forwards the primary checkout's local release branch when it is the
   one checked out.

`bun run health:status` shows the last verdict at any time. `bun run health`
runs the same gate by hand (`--branch=<name>` picks the tip).

### Card Prints tables: where `prints:sync` runs (issue #5414)

Token art resolves from the `cardPrints` and `definitionTokenPrints` tables;
while they are empty every token renders the placeholder, with no error. Three
places fill them, all through `bun scripts/prints-sync.ts`:

- **Local deployment**: `bun run dev` runs `bun run prints:ensure`
  (`--if-empty --warn-only`) after `catalogue:ensure`. A first start downloads
  the Scryfall bulk and fills the tables; later starts only ask the deployment
  and skip. A failure prints `prints-sync: FAILED` and `dev` continues. By
  hand: `bun run prints:sync`.
- **Production**: the push of the release branch triggers the hosting build,
  whose `buildCommand` in `vercel.json` ends with `bun run prints:sync:deploy`
  (`--deploy --if-empty --warn-only`) right after `convex deploy`, so the
  functions it calls exist. `--deploy` writes to the deployment
  `CONVEX_DEPLOY_KEY` selects, `--prod` included; with no key it is an error,
  never a local write. Once filled, every later deploy skips. Failure is loud
  in the build log but does not red the deploy: rerun
  `CONVEX_DEPLOY_KEY=… bun run prints:sync:deploy` by hand.
- `--dry-run` builds the rows and writes nothing.

### The RED path: the fix loop

A RED verdict starts a repair rather than ending the run (ADR 0118). One round
is one health gate plus at most one fix:

1. `release` hands the red tip to `bun run health:fix`, which spawns an
   **interactive** Claude session on the `/health-fix` skill. That session
   reproduces the failing step in a detached worktree at the tip, fixes it
   forward with a test closing the CLASS of the failure, opens an issue and a
   PR, and lands it through `bun run land` like any other change. It never
   reverts, and it never calls `release` itself.
2. The session's last act is a **verdict file**,
   `.claude/telemetry/health/fix-verdict.json` — an interactive `claude` exits
   0 whatever happened inside it, so the exit status carries no answer.
   `landed` (with the PR verified `MERGED`) or `stuck`, and nothing else.
3. Parsing is **fail-closed**: no file, unparsable JSON, an unknown outcome or
   a verdict about another sha all read as `stuck`, which ends the loop and
   leaves the RED standing.
4. On `landed`, the base tip is re-read from the remote — the base branch
   moved — and the next round gates the fixed tree.

Bounds and switches:

| Flag                   | Effect                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| (none)                 | up to **three** rounds, then the handover                              |
| `--max-fix-attempts=N` | moves the bound; refuses `N < 2` (a bound of 1 never re-gates the fix) |
| `--no-fix`             | the pre-ADR-0118 behaviour: refuse on RED, spawn nothing               |
| `--dry-run`            | unchanged — prints the tips, gates nothing, spawns nothing             |

Three rather than one because the health gate stops at its FIRST failing step
and `bun run test` runs its three suites in series: a tip red at `test:app`
and then at `test:bot` is two legitimate reds, not an oscillating fixer.

**No terminal, no spawn.** `health:fix` refuses when stdin is not a TTY and
prints the command to type by hand — the fixer grills on ambiguity, and a
question asked into a pipe hangs the run. So `release` inside another Claude
session, or under `nohup`, behaves exactly as it did before ADR 0118.
`loop-drain.sh` is unchanged for the same reason: it still **stops** on RED
rather than spawning a fixer nobody authorised overnight.

`bun run health:fix` on its own is the manual entry point — same skill, same
verdict, no release. It is how a standing RED blocking the AFK loop
gets cleared. It refuses, each with its reason: no standing `RED` (exit 0), a
RED with no health record behind it, a record about another sha, a record
that is `running` or `green`, and no TTY.

### When release refuses

- **RED, and the [fix loop](#g-fix-loop) gave up.** The handover names what every round
  attempted, then the refusal verbatim; the RED stands and `land` warns on
  every landing until it is gone. A `stuck` verdict means the fixer would not
  defend its own repair — read its issue, fix forward on the base branch like
  any PR (never stack unrelated work on a red tip, never silence a test), then
  `release` again. Attribution over a batch of N landings costs at most
  ⌈log₂ N⌉ health runs.
- **Non-fast-forward.** The release branch has a commit the base branch lacks
  (someone pushed to it directly). In a detached worktree at `origin/<base>`:
  `git merge origin/<release>`, `git push origin HEAD:refs/heads/<base>`, then
  `release`. Do not rebase or force anything.
- **"health record is about X, not the base tip".** Another health run wrote
  the record for a different sha between your fetch and the read — the base
  branch moved. Run `release` again.

## Glossary

### <a id="g-base-branch"></a>Base branch

The integration branch every PR targets and `land` merges into —
`branches.base` in `tolaria.config.json`, `staging` today. May be red between
releases; never deployed.

### <a id="g-release-branch"></a>Release branch

The production branch — `branches.release`, `main` today. Moves only by a
fast-forward from a health-proven base tip, only through `release`. The
primary checkout keeps it checked out.

### <a id="g-lane-gate"></a>Lane gate

`bun run check:lane`: the checks a diff owes, chosen by which paths it
touches, degrading to the whole `check:pr` on anything it cannot place. The
gate every landing pays ONCE, under the lock on the rebased tree, and skips
when that (tip, base) was already gated green (ADR 0136 §1–2).

### <a id="g-health-gate"></a>Health gate

`scripts/health-main.ts`: the full gate (`check:all`, the derived Op census
`check:gaps`, all three test suites, and last — at `release` only (`--ui-all`)
— the full `check:ui` browser walk, issue #4913, run off the heavy mutex and
never RED on the environment, issue #4962; a batch run owes no walk and records
it `skipped` (ADR 0131, issue #5378) — `HEALTH_SCRIPTS` in
`scripts/lib/health-step.ts`) on one
branch tip, leaving a durable verdict under
`.claude/telemetry/health/`. Runs at release, per batch of landings, or by hand
— never per landing (ADR 0116; the per-landing version cost ~213 minutes of
mutex a day and produced 1.4 contention false-REDs a day).

### <a id="g-batch-health"></a>Batch health gate

The scheduled run of the [health gate](#g-health-gate):
`.github/workflows/health.yml`, `bun run health --scheduled --retry-infra`
(ADR 0156 §4, issue #5655). It replaced a landing-count cadence, deduplicated
by sha, that `land` detached under `gate.ts yield`.

### <a id="g-fix-loop"></a>Fix loop

`release`'s bounded repair of a RED base tip (ADR 0118): up to three rounds of
[health gate](#g-health-gate) → `bun run health:fix` → an interactive
`/health-fix` session → a fail-closed verdict file. Never spawns without a
TTY; `--no-fix` disables it; `loop-drain.sh` does not use it and still stops
on RED.

### <a id="g-heavy-mutex"></a>Heavy mutex

`scripts/gate.ts`'s machine-wide lock (`~/.cache/tolaria/gate.lock`) around
anything that runs the full suites or `land`'s locked command. `bun run
gate:who` names the holder AND the queue behind it; a holder that stops burning
CPU is reclaimed. The light tier (`check:lane` by itself, targeted vitest)
takes no lock. The queue has an order — `land` > `job` > hand-run heavy >
`health`, each waiter rising one class per 30 min queued — and only its head
may take the mutex; the `yield` tier is the heavy tier queued in the `health`
class, which is how the batch health gate once let landings
through.
