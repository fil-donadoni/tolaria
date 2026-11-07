# Land and release

**The whole delivery path, in order: a worktree off the [base branch](#g-base-branch),
a PR handed to its merger (the Mergify queue, or the owner's
`bun run merge:manual` for a PR the queue would refuse, issue #5952), which
pays the [lane gate](#g-lane-gate),
once — and, when a human decides, `release`.** Six commands. Everything else in the repository's workflow tooling serves one of
them or is history.

```bash
cd "$(bun run --silent wt:new <N>)"   # 1. worktree off origin/<base>   (--fix for a bug)
…                                      # 2. implement; bunx vitest run <path> while iterating
git add -A && git commit               # 3. commit
git push -u origin feat/issue-<N>      # 4. no pre-PR gate (ADR 0136 §1)
gh pr create                           # 5. base = the base branch (GitHub default), no --base
bun run land:ready <PR#>               # 6. hand off: the merge queue rebases, gates, merges
```

A session ends at step 6: `land:ready` labels the PR `ready-to-land` and the
**Mergify queue** rebases it in a draft, runs the lane there and merges, tree
landed = tree gated ([GitHub pipeline](github-pipeline.md)). `land` itself is
gone (issue #7990), a RED repair included. A red lane relabels the PR
`land-failed`; `queue:plan` makes it a repair pick.

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

### 4. No pre-PR gate — the [lane gate](#g-lane-gate) is the queue's

There is no `check:lane` before the PR (ADR 0136 §1). At 2.5 PR/h the base tip
moved while that gate ran, so it certified a tree that never landed and the
landing paid the lane again on the rebased one: two lane runs plus 1.35
landings per issue, ≈ 17 min of gate. The session's signal before the PR is its
targeted vitest runs and the review round. The lane is paid once, by the
queue, on its draft.

A hand-run `bun run gate:run check:lane` stays available and ungated — no
preflight refuses a stale tree any more (issue #3286's was retired with the
pre-PR gate). It classifies the diff against
`origin/<base>` and runs exactly what that lane owes:

| Lane     | Diff                                                           | Runs                                                                                                                         | Measured |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| `skin`   | `src/**`, `public/**`, `index.html` only                       | format, lint, `check:ts` (app + scripts), bundle, `dom` + `node`/src, plus each bot project the diff can reach (issue #3435) | ~222 s   |
| `engine` | no `src/**`, or a `src/**` + `convex/**` mix (+ reached `dom`) | format, lint, whole `check:ts`, index/stubs, bot fast lane, `node`                                                           | ~175 s   |
| `docs`   | markdown only                                                  | `check:docs` — seconds                                                                                                       |          |
| `full`   | dependencies, lockfile, build/test/type config, unknown path   | `check:pr` verbatim                                                                                                          | ~305 s   |

**Never hand-pick a subset of `check:pr`.** On formatting drift run
`bun run format` and re-run; the gate verifies, it does not repair.

A diff that can change what a user sees also owes **`bun run check:ui`** — five
viewports, the occlusion probe, axe — and its output pasted byte-exact in the
PR ([Browser verification](browser-verification.md)). `land:ready` and
`pr-check`'s `ui-receipt` job re-derive that receipt and refuse a PR whose
receipt does not match.

### 5. The PR

`gh pr create` targets the [base branch](#g-base-branch) because it is the
repository's default branch — no `--base`. The body carries: the `check:ui` receipt
when owed, a `## Preset scenario` fence for
any `convex/{cards/sets,gre}` change (or "none owed"), the Bot reachability
outcome, proof-of-failure receipts for new guarding tests.

### 6. `land:ready <PR#>` — the hand-off

Rebases a branch the base outran, restores the derived state the base owns
(ADR 0157), runs the lane's seconds-cost steps and the PR's refusals
(`lib/pr-refusals.ts`, `pr-checks.ts`) on the worktree, labels the PR
`ready-to-land` and moves the claim to `pr-open`. Red → nothing queued; fix it
in the session.

The queue admits the PR, rebases it in a draft, runs `check:lane` there and
merges. **Every merge to the base fires `post-merge.yml`:** the seed, the
fast-forward, the worktree teardown and telemetry, whoever merged. A PR the
queue refuses (one touching `.github/` or `.mergify.yml`) is merged by the owner
with `bun run merge:manual <PR#>`. `deny-guard.sh` § 1 denies a hand-typed
`gh pr merge` everywhere; `TOLARIA_ALLOW_MANUAL_MERGE=1` is the per-command
hatch for a real recovery.

### The `housekeeping` cron — the GitHub-bound post-merge steps

`bun run housekeeping` (`scripts/housekeeping.ts`, ADR 0154 §5, issue #5457)
walks the PRs merged into the base branch since its watermark and runs the
GitHub-bound steps a merge owes:

1. `git fetch` + fast-forward of the primary checkout — refused (nothing
   processed) when it is not on the base branch, since `gaps:sync` pushes its
   allowlist write from there. A local `gaps:sync` commit whose push lost a
   race is dropped (`reset --keep`); the next sync re-derives it;
2. `gaps:sync` once for the batch, never `--band` (a gap files under its
   computed Target band, issue #5871); if it fails — an allowlist write-back
   that did not reach the base branch included — the steps below still run
   and every PR of the batch is retried;
3. per PR, oldest merge first, for a branch naming issue N:
   `grammar:residue N --pr <PR#>` (holes it cannot file are logged for a
   human, never retried), the `in-progress` claim release on N,
   `umbrella:detach N`;
4. `umbrella:detach --sweep` once.

Merged PRs are listed by last update, newest first, until one older than the
watermark — a merge updates a PR, so none is missed however long it was open.
Every step is idempotent, so a second run with nothing new merged is a no-op.

`gaps:sync` now pushes to the base branch outside `land`, often from
the other machine. `land`'s merged-tip check (step 7 above) does not count
that one commit — the `gaps:sync` subject on a diff of `data/grammar-gaps.json`
alone — and still refuses any other foreign push.
Its state — the watermark, plus the PRs whose steps failed (retried each
run, given up loudly after 24 attempts) — is shared between the machines
(issue #5873): the `housekeeping` key of the git ref `refs/tolaria/state` on
origin, written with a compare-and-swap. The log, `housekeeping.log` under
the primary checkout's `.claude/telemetry/housekeeping/`, is this machine's.
The work happens in a throwaway worktree of `origin/<base>`, never in the
primary checkout. No shared state yet looks back 24 h (or reads the
machine's old `state.json` once); `--since <ISO>` moves the watermark back
for a backfill, `--dry-run` prints the plan and writes nothing. Exit 0 =
nothing to do or all done, 1 = something left to retry — and the owner is
notified, once per distinct failure.

It runs as the `housekeeping` job of `post-merge.yml` on any `lane` runner,
on every push to the base and hourly
([github-pipeline.md § post-merge](github-pipeline.md#post-merge)).

Until a PR's steps have run, its issue may still carry `in-progress`: that is
harmless, since the session cap counts OPEN claimed issues only.

### The batch health gate — a schedule, not a cadence

The full offline gate is not a landing's business, but it is not a release's
either: between releases the base tip could stand red for the 1–2 days
observed. It runs per BATCH (ADR 0136 §6) — and since issue #5655 the batch is
a clock: `.github/workflows/health.yml` runs `bun run health --scheduled
--retry-infra` (ADR 0156 §4). A landing records nothing and detaches no
decision; the 20-landing / 8 h counter, its ledger and the health runner that
read it were deleted.

- **Dedup.** By sha: a tip already GREEN is not gated again, and a tip health
  has already been started for is not started twice (that stamp expires after
  90 min, so a run killed before it wrote a verdict costs one window).
- **Verdict.** The commit status `context=health` on the gated sha is the only
  store; a RED stands there until a GREEN, or a proved repair's AMBER, answers
  it. `queue:plan` refuses the next PICK, the queue holds every PR but a
  declared repair (`pr-gate`'s `base-health`), and the repair starts with
  `bun run health:fix`.
- **Repair.** `bun run health:fix repair-issue --issue=<N>` records the repair
  issue on the pivot; the queue admits the PR that closes it. On its merge,
  `health-early`'s `amber` job runs `bun run health:fix amber --sha=<tip>`: every
  failing test the RED names green on the merged tip turns the lineage AMBER and
  reopens the queue (issue #7990).

## Releasing the base branch to production

`bun run release`, from the primary checkout, when a human decides. Vercel
deploys the [release branch](#g-release-branch) and only it, so this is the
production deploy.

1. Fetches both branches. Same tip → "nothing to release", exit 0.
2. `--dry-run` stops here, printing the tip and the commit count.
3. Runs the [health gate](#g-health-gate) on the `origin/<base>` tip on the
   [heavy tier](#g-heavy-tier): a throwaway worktree at that sha,
   `check:all` then `bun run test` (app, bot, blade), ~13 minutes with the
   4-worker cap. Deduplicated by sha: a tip already GREEN is not re-gated.
   The terminal is never silent (issue #3487): each step prints
   `health-main: [2/3] check:all — start` and `… — exit 0 after 4m12s`,
   and a long step prints `… — still running, 5m00s elapsed`
   every minute. The full child output still goes only to the per-sha log.
4. Reads `.claude/telemetry/health/last.json` and releases **only** if the
   record is about exactly the tip being promoted and is GREEN, or INFRA at the
   browser step, with a warning (issue #8760). A record about another sha, a RED,
   any other INFRA, or a run still marked `running` refuses with the reason.
5. On RED — and only on RED — hands the tip to the [fix loop](#g-fix-loop)
   below, then gates again. Everything else refuses.
6. `git push origin <sha>:refs/heads/<release>` — a plain refspec, so git
   itself refuses a non-fast-forward. Never `--force` (`deny-guard.sh` § 2
   denies it for both configured branches).
7. Fast-forwards the primary checkout's local release branch when it is the
   one checked out.

`bun run health:status` shows the last verdict at any time. `bun run health`
runs the same gate by hand (`--branch=<name>` picks the tip).

### Card Prints tables: where `prints:sync` runs (issue #5414, issue #7690)

Token art resolves from the `cardPrints` and `definitionTokenPrints` tables
(ADR 0140 §4); a card with no rows there renders its tokens as the
placeholder, with no error. Every automatic run uses `--if-stale`: it skips
only when both tables have rows AND the `printsSyncState` row holds the digest
of the CURRENT definition set (`data/card-index.json` Card IDs + rarity
overrides). A landed card changes the digest, so the next run syncs. (Before
issue #7690 the flag was `--if-empty`, which skipped once the tables held any
row: 64 definitions had lost their Token Prints.) Four places run it, all
through `bun scripts/prints-sync.ts`:

- **Local deployment, at start**: `bun run dev` runs `bun run prints:ensure`
  (`--if-stale --warn-only`) after `catalogue:ensure`. A stale or empty
  deployment downloads the Scryfall bulk and syncs; a fresh one costs one
  query. A failure prints `prints-sync: FAILED` and `dev` continues.
- **Local deployment, after a landing**: `post-merge`'s seed leg runs
  `prints-sync --if-stale --warn-only` after fast-forwarding the primary,
  before seeding preset scenarios, so a new card's scenario opens with its
  token art.
- **Production**: the push of the release branch triggers the hosting build,
  whose `buildCommand` in `vercel.json` ends with `bun run prints:sync:deploy`
  (`--deploy --if-stale --warn-only`) right after `convex deploy`, so the
  functions it calls exist. `--deploy` writes to the deployment
  `CONVEX_DEPLOY_KEY` selects; with no key it is an error, never a local
  write. Failure is loud in the build log but does not red the deploy.
- **By hand**: `bun run prints:sync` (local) or
  `bun scripts/prints-sync.ts --prod` (production through your Convex CLI
  login; refuses when a deploy key is in the shell). Both sync
  unconditionally and record the digest.
- `--dry-run` builds the rows and writes nothing.

### The RED path: the fix loop

A RED verdict starts a repair rather than ending the run (ADR 0118). One round
is one health gate plus at most one fix:

1. `release` hands the red tip to `bun run health:fix`, which spawns an
   **interactive** Claude session on the `/health-fix` skill. That session
   reproduces the failing step in a detached worktree at the tip, fixes it
   forward with a test closing the CLASS of the failure, opens an issue and a
   PR, and hands it off with `bun run land:ready` like any other change. It
   never reverts, and it never calls `release` itself.
2. The session's last act is a **verdict file**,
   `.claude/telemetry/health/fix-verdict.json` — an interactive `claude` exits
   0 whatever happened inside it, so the exit status carries no answer.
   `handed-off` (naming the PR, labelled `ready-to-land`) or `stuck`, and nothing
   else.
3. Parsing is **fail-closed**: no file, unparsable JSON, an unknown outcome or
   a verdict about another sha all read as `stuck`, which ends the loop and
   leaves the RED standing.
4. On `handed-off`, `release` waits for the queue, up to **2 h**
   (`repairQueueStep`). Merged: the base tip is re-read from the remote and the
   next round gates the fixed tree. Closed, `land-failed` or past the bound:
   the handover.

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
The `release` job passes `--no-fix` for the same reason: it **fails** on RED
rather than spawning a fixer nobody authorised, and [the RED ladder](github-pipeline.md#g-red-ladder) takes it.

`bun run health:fix` on its own is the manual entry point — same skill, same
verdict, no release. It is how a standing RED blocking the AFK loop
gets cleared. It refuses, each with its reason: no standing `RED` (exit 0), a
RED with no health record behind it, a record about another sha, a record
that is `running` or `green`, and no TTY.

### When release refuses

- **RED, and the [fix loop](#g-fix-loop) gave up.** The handover names what every round
  attempted, then the refusal verbatim; the RED stands and holds the queue until
  it is gone. A `stuck` verdict means the fixer would not
  defend its own repair — read its issue, fix forward on the base branch like
  any PR (never stack unrelated work on a blocking RED, never silence a test), then
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
`check:gaps`, all three test suites, and last — at `release` only
(`--release`) — the browser step `check:game-download`, never RED on the environment, issue #4962; a batch run owes none
and records it `skipped` (issue #5378); no run walks `check:ui --all`, a
command run by hand (ADR 0131, issue #6143) — `HEALTH_SCRIPTS` in
`scripts/lib/health-step.ts`) on one
branch tip, leaving a durable verdict under
`.claude/telemetry/health/`. Runs at release, per batch of landings, or by hand
— never per landing (ADR 0116; the per-landing version cost ~213 minutes of
the machine a day and produced 1.4 contention false-REDs a day).

### <a id="g-batch-health"></a>Batch health gate

The scheduled run of the [health gate](#g-health-gate):
`.github/workflows/health.yml`, `bun run health --scheduled --retry-infra`
(ADR 0156 §4, issue #5655). It replaced a landing-count cadence, deduplicated
by sha, that `land` once detached.

### <a id="g-fix-loop"></a>Fix loop

`release`'s bounded repair of a RED base tip (ADR 0118): up to three rounds of
[health gate](#g-health-gate) → `bun run health:fix` → an interactive
`/health-fix` session → a fail-closed verdict file. Never spawns without a
TTY; `--no-fix` disables it, as the `release` job does.

### <a id="g-heavy-tier"></a>Heavy tier

What `scripts/gate.ts` wraps the full suites and `land`'s one command in: the
`min(ncpu - 1, 4)` worker cap and the issue-worktree guard. The light tier
(`check:lane` by itself, targeted vitest) keeps 2 workers. It holds no lock: the
machine-wide mutex it once took was retired by PR #7519; one
[`lane` runner](github-pipeline.md#g-lane) now serialises the gates.
