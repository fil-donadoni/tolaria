# GitHub pipeline — runners, labels, pause/resume, repository settings

ADR 0156 (and its Amendment I) moves everything after the PR — verification
scheduling, the merge queue, post-merge jobs, health, release — onto GitHub
Actions and Mergify. Every job runs on a [self-hosted runner](#g-runner) on
one of the owner's two machines. This guide is the operating manual of that
stack; **every slice of PRD #5620 updates it in the same PR, in its own
section** — a slice appends the section it adds and leaves the shared
paragraphs (this one included) to the single rewrite in issue #5657, because
every slice editing one paragraph is what made this file the most conflicted
in the repo (issue #5942). Version 1
(issue #5634) covered the [runners](#g-runner): install,
[labels](#g-label), [pause](#g-pause) / resume, and the repository settings
checklist. Version 2 (issue #5636) adds the [jobs](#jobs): the
[job setup](#g-job-setup) every workflow copies, the
[structure guard](#g-structure-guard) over the workflow files, and the first
two workflows — the advisory [`pr-check`](#pr-check) and
[`lane-timing`](#lane-timing). Version 3 (issue #5639) ports the refusals
`land` applies into the [required checks](#required-checks). Version 4 (issue #5638) adds
[`pr-refresh`](#pr-refresh), which keeps the queued PRs rebased. Version 5
(issue #5637) adds [`pr-gate`](#pr-gate), the two commit statuses the queue
will require. Version 6 (issue #5641) describes [a pass inside a job](#a-pass-inside-a-job) and the
`deny-guard` rule that keeps a session off the base branch. Version 7
(issue #5640) adds the queue's lane with [one flaky re-run](#queue-lane) and
the [`pr-fixup`](#pr-fixup) job for stale generated artefacts. Version 8
(issue #5642) adds [the merge queue](#the-merge-queue) — `.mergify.yml` in
[shadow](#g-shadow), acting only on PRs the owner labels `queue:shadow`.
Version 12 (issue #5643) is the [cut-over](#the-cut-over): Mergify merges
every `ready-to-land` PR, the land-runner is retired, a ruleset guards the
base branch. Version 9 (issue #5644) adds [`post-merge`](#post-merge): what a merge obliges on each
machine, and the schedules that replaced the Huawei's two timers. Version 10
(issue #5645) adds [`health`](#health): batch health every two hours on a
[`lane`](#g-lane) runner, an [early run](#g-early-run) on a hosted runner
after each merge batch, and the [RED ladder](#g-red-ladder)'s first rungs —
the [flake check](#g-flake-check) and the [bisect](#g-bisect). Version 11
(the review of 2026-10-18) adds [where the flow fails](#where-the-flow-fails):
each failure class, the step that owns it, the gap, and what closes it.

While the migration runs, the old stack (`land`, the land-runner, `loop:afk`,
batch health) stays the authority on what runs today, and it is **frozen**: no
new feature outside PRD #5620 (`docs/agents/quality-gates.md`).

## The runners on a machine

A machine declares how many [runners](#g-runner) of each
[role label](#g-label) it offers. Defaults:

| [Label](#g-label) | MacBook | Huawei | What it runs                                                                  |
| ----------------- | ------- | ------ | ----------------------------------------------------------------------------- |
| [`pass`](#g-pass) | 2       | 2      | one Claude Code session (`/next-ticket`) per job                              |
| [`lane`](#g-lane) | 1       | 1      | queue checks, health, release                                                 |
| [`seed`](#g-seed) | 1       | 0      | jobs that need the owner's Convex deployment (scenario seeds) — the MacBook's |
| `host:<name>`     | all     | all    | pins a job to one machine when it must                                        |

GitHub adds `self-hosted`, the OS and the architecture to every runner by
itself. Each [runner](#g-runner) is named `<host>-<role>-<n>` (e.g.
`macbook-pass-2`) and lives in its own directory,
`~/.local/share/tolaria/actions-runner/<name>/`. The number of
[`pass`](#g-pass) runners IS the cap on concurrent Claude sessions on that
machine (ADR 0156 §1): size it by the Max subscription's usage limits, which
both machines share.

Every [runner](#g-runner) runs **as the owner's user** (Amendment I: no
dedicated system user), so a job sees the same Convex deployment, `gh` and
Claude logins, merge drivers and telemetry as an interactive session.
Its unit also exports `TOLARIA_PRIMARY_CHECKOUT`, the
[primary checkout](#g-primary-checkout) the install ran from: the source of
every [job worktree](#g-job-worktree). A runner installed before issue #5636
lacks it and fails every self-hosted job at its first step — re-run
`bun run runner install` on that machine (it restarts the idle runners).

## Install

From the [primary checkout](#g-primary-checkout) of each machine (the script
resolves it from any worktree too):

```bash
bun run runner install --dry-run --host macbook   # prints every step, runs nothing
bun run runner install --host macbook             # do it
bun run runner status                             # local services + GitHub's view
```

On the Huawei, `--host huawei`. Flags: `--pass N`, `--lane N`, `--seed N`,
`--no-convex` (MacBook: skip the [Convex agent](#g-convex-agent)). The first
run remembers host and counts in the [machine declaration](#g-declaration);
a later bare `bun run runner install` declares the same runners.

What `install` does, per [runner](#g-runner), only where the machine differs:

1. downloads the latest `actions/runner` release for this OS/arch once
   (cached under `~/.cache/tolaria/actions-runner/`) and unpacks it into the
   runner's directory;
2. registers it with `config.sh --unattended --replace` and its
   [labels](#g-label) — the registration token comes from
   `gh api -X POST repos/<owner>/<repo>/actions/runners/registration-token`,
   so the `gh` login must be the repository's admin;
3. installs its [user service](#g-user-service) and starts it — unless the
   runner is [paused](#g-pause), in which case it stays stopped.

**Idempotent**: a second run on an unchanged machine changes nothing and
prints `nothing to do — this machine already matches` (after any standing
notes: [linger](#g-linger) off, a runner not declared). A changed unit
template is rewritten and its service restarted — **which kills a job in
flight on it**; check `bun run runner status` first. A [runner](#g-runner) installed but no
longer declared (you lowered `--pass`) is reported, never removed silently:
`bun run runner remove <name>` stops it, unregisters it from GitHub and
deletes its directory. Changing a registered runner's
[labels](#g-label) = `remove` it, then `install` again.

**Dead units** (issue #6019): an installed Tolaria unit
(`~/.config/systemd/user/tolaria-*.{service,timer}`,
`~/Library/LaunchAgents/com.tolaria.*.plist`) whose script is gone from the
checkout — the `tolaria-health` / `tolaria-reaper` units PR #5856 left behind
— is stopped, disabled and deleted (drop-ins with it) by `install`, or alone
by `bun run runner prune [--dry-run]`. `bun run machine` lists any it finds.

### MacBook — launchd

- One [launchd agent](#g-user-service) per [runner](#g-runner):
  `~/Library/LaunchAgents/com.tolaria.gh-runner.<name>.plist`, rendered from
  `scripts/runner-units/com.tolaria.gh-runner.plist`. It starts at login,
  `KeepAlive` restarts it when it dies, and it runs `run.sh` **under
  [`caffeinate -i -s`](#g-caffeinate)**: a sleeping MacBook fails every job in
  flight. Log: `~/.cache/tolaria/gh-runner/<name>.log`.
- **`convex dev` becomes a launchd agent** too, the
  [Convex agent](#g-convex-agent) `com.tolaria.convex`
  (`scripts/runner-units/com.tolaria.convex.plist`): `convex dev --local` in
  the [primary checkout](#g-primary-checkout), restarted when it dies. A job
  cannot own it — a job's processes die with the job. On the first install a
  `convex dev` that `convex:ensure` started still holds the port: stop it
  (`pkill -f 'convex dev'`) and the agent takes over within 10 s. Log:
  `~/.cache/tolaria/convex/agent.log`.
- Every plist carries `node` on its `PATH` (the render refuses one without,
  issue #5598).

Check one: `launchctl print "gui/$(id -u)/com.tolaria.gh-runner.<name>" | grep -E 'state|last exit'`.

### Huawei — systemd

- One template [user service](#g-user-service),
  `~/.config/systemd/user/tolaria-gh-runner@.service`
  (`scripts/runner-units/tolaria-gh-runner@.service`); each
  [runner](#g-runner) is an instance, `tolaria-gh-runner@<name>.service`.
  `Restart=always`, and `KillMode=control-group` ends a job's whole tree with
  the unit. `PATH` is fixed — `~/.local/bin`, `~/.bun/bin`, the directory
  of `command -v node`, `/usr/local/bin`, `/usr/bin`, `/bin` — never the
  installing shell's, so a re-run from another directory does not rewrite
  the unit; `install` refuses when `node` is not on it.
- **[Linger](#g-linger)** keeps the services up with nobody logged in;
  `install` notes when it is off: `sudo loginctl enable-linger "$USER"`.
- The Huawei keeps its existing Convex unit, `tolaria-convex.service`
  (`docs/guides/huawei-runner.md` § Convex on the Huawei); `install` adds none.

Check one: `systemctl --user status tolaria-gh-runner@<name>.service`,
`journalctl --user -u tolaria-gh-runner@<name>.service -n 50`.

## Pause and resume

[Pause](#g-pause) a machine's [runners](#g-runner) while you work on it; the
other machine carries the queue:

```bash
bun run runner pause    # stop every runner here; they stay registered (GitHub shows them offline)
bun run runner resume   # start them again
```

`pause` writes a `.paused` mark in each runner's directory and disables its
[user service](#g-user-service) (`launchctl disable` + `bootout`;
`systemctl --user disable --now`), so neither a login nor a reboot brings it
back, and a later `install` leaves it stopped. `resume` reverses both. Both
accept `--dry-run`. **A job running at pause time is killed**, with no
busy check — GitHub marks it failed. Look at `bun run runner status` (the
`busy` column) before pausing in the middle of a Claude
[pass](#g-pass). `pause` never touches the
[Convex agent](#g-convex-agent).

## Jobs

### The shape of a job

Every job declares `timeout-minutes`, and every job with a `run:` step goes
through the [job setup](#g-job-setup) before its first one. What comes
before the job setup depends on the runner:

- **GitHub-hosted** (`runs-on: ubuntu-24.04`): `actions/checkout` pinned by
  SHA, `persist-credentials: false`. There is no primary checkout on a
  hosted VM, so `worktree:init` regenerates `convex/_generated` offline
  (`convex codegen --system-udfs`, no deployment).
- **Self-hosted** (`runs-on` with a [role label](#g-label)): never a clone.
  The first step cuts a [job worktree](#g-job-worktree) of the machine's
  [primary checkout](#g-primary-checkout) AT the job's
  `$GITHUB_WORKSPACE`, and the last step removes it `if: always()`:

```yaml
steps:
    - name: Job worktree
      shell: bash
      working-directory: ${{ runner.temp }}
      run: |
          git -C "$TOLARIA_PRIMARY_CHECKOUT" fetch --no-tags --no-write-fetch-head --quiet origin "$GITHUB_SHA"
          git -C "$TOLARIA_PRIMARY_CHECKOUT" show "$GITHUB_SHA:scripts/ci/job-worktree.sh" | bash -s -- create
    - uses: ./.github/actions/job-setup
    - run: bun run <the work>
    - name: Remove the job worktree
      if: always()
      shell: bash
      working-directory: ${{ runner.temp }}
      run: git -C "$TOLARIA_PRIMARY_CHECKOUT" show "$GITHUB_SHA:scripts/ci/job-worktree.sh" | bash -s -- remove
```

The script is read out of the primary's object store at the job's own
commit, since the job has no tree yet to run it from. Because the worktree
IS the workspace, `uses: ./.github/actions/job-setup` and every later step
run in it with no `working-directory`. A job killed before its last step
leaves its worktree registered (locked, if it died inside `worktree add`);
the next job on the same runner drops it before cutting its own. The job's
commit is held by `refs/ci/<runner name>` while the job runs. `shell: bash`
is what gives both steps `pipefail` — without it a failed `git show` pipes
nothing into `bash -s`, which exits 0. `remove` leaves an empty workspace
directory: the runner runs post steps there after the last step, which is
why the job setup nests no action (a nested action's post step could no
longer find it).

### The job setup

`.github/actions/job-setup` (a composite action), in order:

1. **masks the `gh` token** — a self-hosted job runs with the owner's `gh`
   login, and every signed-in GitHub user can read a public repository's
   logs;
2. **node** from `.nvmrc` (`scripts/ci/setup-node.sh`: the nodejs.org
   build) and **bun** from `.bun-version` (`scripts/ci/setup-bun.sh`: npm),
   both unpacked into the runner's own tool cache — never `~/.bun` or the
   owner's nvm, and no action for the allow-list to name or for a post step
   to outlive the worktree. The job's toolchain no longer depends on the
   service's `PATH` — the issue #5598 class;
3. `bun run worktree:init`.

### Public logs

A job never writes Claude's raw output to its log: a `claude` call runs
through `scripts/ci/run-quiet.sh <name> -- claude …`, which keeps the output
in `~/.cache/tolaria/jobs/<run id>-<attempt>/<name>.log` on the machine and
prints only the exit code and that path. The job summary and artifacts carry
numbers only. Masking hides the token in the LOG only: a self-hosted job runs
as the owner and can read the owner's `gh` and git credentials — which is
why no outsider-triggerable job may reach a self-hosted runner at all.

### Serialising heavy work

By [runner labels](#g-label), never by a `concurrency` group: a group keeps
ONE pending job and cancels the older pending one, which would silently drop
a queue check or a health run. One [`lane`](#g-lane) runner per machine
already runs one heavy job at a time. A hosted-only workflow may use a group
with `cancel-in-progress` to drop a superseded run (`pr-check` does). The
self-hosted exceptions are the jobs that MUST run one at a time across
machines and lose nothing when a pending run is dropped: the
[dispatcher](#g-dispatcher) ([§ afk-dispatch](#afk-dispatch)) and the shared
post-merge duties `housekeeping` and `nightly` ([§ post-merge](#post-merge)),
listed in `SERIALISED_DISPATCHERS` / `SERIALISED_JOBS` of the
[structure guard](#g-structure-guard). One self-hosted job cancels instead:
[`queue-lane`](#queue-lane), whose older run is worthless once its PR has a
newer draft (`SUPERSEDED_JOBS`, issue #6020).

## Workflows

| Workflow                                  | Trigger                                                             | Runner                                         | What it proves                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`pr-check`](#pr-check)                   | `pull_request` (open, push)                                         | GitHub-hosted `ubuntu-24.04`                   | the PR's full `check:lane`, on the merge ref — advisory                                   |
| [`pr-check`](#required-checks) `refusals` | same                                                                | same                                           | one job per `land` refusal (five), `scripts/pr-checks.ts`                                 |
| [`release`](#release)                     | dispatch (`dry_run`)                                                | `[self-hosted, lane]`                          | the full gate + walk on the base tip, then the release fast-forward, under an Environment |
| [`lane-timing`](#lane-timing)             | dispatch (`host`), push of a `lane-timing/**` branch                | `[self-hosted, lane, host:<machine>]`          | the same lane on an owner's machine, to compare timings (phase 0)                         |
| [`pr-refresh`](#pr-refresh)               | push to the base branch                                             | `[self-hosted, lane]`                          | rebases the queued PRs the push conflicts with or touches                                 |
| [`post-merge`](#post-merge)               | push to the base branch, two schedules, dispatch                    | `lane` per machine, `seed`                     | fast-forward, worktree cleanup, seed, housekeeping, nightly                               |
| [`afk-dispatch`](#afk-dispatch)           | `ready-for-agent` label, every 30 min, dispatch                     | `[self-hosted, pass]`, one at a time           | picks, claims and dispatches AFK passes, or holds                                         |
| [`afk-pass`](#afk-pass)                   | dispatch (`issue`, `model`, `resume`, `host`) — from the dispatcher | `[self-hosted, pass]` (+ `host:` for a resume) | one `/next-ticket` pass, its WIP push and its record                                      |
| [`pr-gate`](#pr-gate)                     | `pull_request_target`, a `health` status, every 15 min, dispatch    | GitHub-hosted `ubuntu-24.04`                   | the [`trusted-author`](#g-trusted-author) and [`base-health`](#g-base-health) statuses    |
| [`queue-lane`](#queue-lane)               | push of a `mergify/merge-queue/**` branch                           | `[self-hosted, lane]`                          | the lane on the queue's rebased draft, one flaky re-run                                   |
| [`pr-fixup`](#pr-fixup)                   | dispatch (`pr`, `fixes`) — from `pr-check` or by hand               | `[self-hosted, lane]`                          | regenerates a stale generated artefact and pushes it                                      |
| [`health`](#health)                       | every 2 h, dispatch (`gate`, or `ladder` with a `sha`)              | `[self-hosted, lane]`                          | the base tip's `health` verdict; a RED's flake check and bisect                           |
| [`health-early`](#health)                 | push to the base branch, one run at a time                          | GitHub-hosted `ubuntu-24.04`                   | the offline gate after a merge batch — its RED only                                       |
| [`health-fix`](#health-fix)               | dispatch (`sha`, `host`) — from `health` or itself                  | `[self-hosted, pass, host:<machine>]`          | one rung of the RED ladder: a fixer attempt, the revert of the culprit, or the stop       |

### pr-check

`.github/workflows/pr-check.yml`: on every PR open and push, the full
`check:lane` on a free GitHub-hosted runner, on the merge ref (the PR merged
into the current base — what would land). **Advisory**: no ruleset requires
it, and [`queue-lane`](#queue-lane) still runs the lane that gates the merge;
a red `pr-check` is a defect found before the queue, and since the cut-over
(issue #5643) a red `check:lane (advisory)` keeps the PR out of it
(`-check-failure` in `queue_conditions`). The lane job skips the queue's
drafts (`mergify/merge-queue/**`): Mergify re-reads entry conditions there,
and a red on a draft would dequeue the PR with no `land-failed` (issue
#5978's stranding; the structure guard's `queue-entry` row pins the skip). A fork's PR runs it only after
the owner approves (see the checklist below); it gets no secret and a
read-only token either way. A newer push cancels the older run.

**The one recorded exclusion (issue #5675, the owner's option 4).** The bot
tests that read the LOCKED verdict corpus (`weightFit.bot.test.ts` "the
committed weights ARE the fit…", `verdicts.bot.test.ts` "the incumbent is
defended on the ORDERING…") need the Verdict Store reader key, which lives
only on the owner's machines: the bucket is private and a PR job gets no
secret. Before the exclusion they were red on every hosted run (`No Verdict
Store read key at …`), and since `check:guards` runs the bot suite first and
chains the app suites with `&&`, the app suites never ran there (a
deliberately broken tooling test on PR #5676 never executed). `pr-check`
now sets `TOLARIA_HOSTED_NO_VERDICT_CORPUS=1` on its lane step and those two
`describe` blocks skip (they show as skipped, never as passed). It is held
off every gate four ways:

- it takes effect only on a GitHub-hosted runner (`GITHUB_ACTIONS=true` and
  `RUNNER_ENVIRONMENT=github-hosted`, set by the runner): on the owner's
  machines — a self-hosted job, a shell profile — it does nothing;

- `land`, `health` (a gating run; `--status` only reads) and `release`
  refuse to start with the variable set to anything
  (`scripts/lib/corpus-exclusion.ts`);
- the [structure guard](#g-structure-guard) refuses it in any workflow
  holding a self-hosted job and in a shared action (`corpus-exclusion-gating`);
- `land`'s lane, on the owner's machine, holds the key and runs them.

Measured on the same commit (PR #5674, full lane): **hosted `ubuntu-24.04`
491 s** (red only on the two corpus tests above) vs **MacBook `lane` runner
794 s** (on a machine also carrying Claude sessions).

### Required checks

The same `pr-check` workflow also holds `refusals`, a matrix of five jobs —
one per refusal `land` applies before a merge, each `bun run pr:checks <name>`
(`scripts/pr-checks.ts`). A check calls the SAME pure function `land` calls,
on the same facts (the PR body from `PR_BODY`, passed through `env:`; the diff
`origin/<base>...HEAD`, which on the merge ref is what would land), and prints
the same refusal. Those functions keep their tests; the wiring is pinned by
`scripts/__tests__/pr-checks.test.ts`. Run one by hand with
`bun run pr:checks <name|all> [--pr <N>]`.

| Check                 | Refuses when                                                                                                    | Function reused                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ui-receipt`          | the diff can reach the DOM and the body has no `check:ui` receipt matching the diff's scope (or a no-walk line) | `safeSkinReceiptInvalid` (`ui-gate/verify-receipt.ts`) |
| `scenario`            | a `convex/{cards/sets,gre}/**` diff has no `## Preset scenario` block (ADR 0044)                                | `safeScenarioRefusal` (`lib/scenario-block.ts`)        |
| `retired-rows`        | retired rows of `data/oracle-compiled.json` change and no `## Retired rows` line names them (ADR 0114 §1)       | `safeRetirementRefusal` (`lib/retirement-ack.ts`)      |
| `robustness-baseline` | the body closes the owner issue of a `ROBUSTNESS_BASELINE` row the tree still lists                             | `robustnessBaselineRefusal`                            |
| `repair-proof`        | the PR repairs the standing RED and the verdict's failing test files still fail on it                           | `repairProofOf`, as `land`'s `repairProofStep`         |

`repair-proof` reads the health lineage through the verdict store (the commit status
needs only the job's `GH_TOKEN`). It passes with a printed `NOTE`
when the store cannot be read, or when every failing test the verdict names
was moved or deleted by the repair — it cannot decide, and `land` stays the
authority until the migration retires it. It reads commit statuses, so the workflow token carries `statuses: read`. A `land --repair` PR with no ledger issue gets no proof here (the flag is `land`'s), and the check never reproduces the RED refusal of a non-repair PR: both stay `land`'s. A PR that is not a declared repair
(closing none of the ledger's `/health-fix` issues) owes nothing to it.

The five are not queue conditions: Mergify judges those on the queue's
draft, whose body is Mergify's, so the four that read the PR body would be
red there and dequeue every PR ([the merge queue](#the-merge-queue), issue
#5978). They hold at two points instead. `land:ready` runs them before the
hand-off (issue #5956). After it, a refusal red on a `ready-to-land` PR (its
body edited, a push) labels it `land-failed` through `.mergify.yml`'s own
`pull_request_rules` entry, the same repair pick as a dequeue, and
`-label=land-failed` takes it out of the queue (issue #5960). Their contexts
are the bare job names `ui-receipt`, `scenario`, `retired-rows`,
`robustness-baseline` and `repair-proof`; four read the PR body, so
`pr-check` also runs on `edited`. The refusals judge the PR's merge ref at its last
push or edit, never the queue's rebased draft: against a base that moved
since, `repair-proof` and `robustness-baseline` can be stale, which the
migration accepts.

### pr-refresh

`.github/workflows/pr-refresh.yml`: GitHub and Mergify do not run our merge
drivers, and 37 % of PRs touch a driven file, so a queued PR conflicts on a
generated artefact the moment the base moves. On every push to the base, a
[`lane`](#g-lane) runner runs `bun run pr-refresh -- --before <old tip> --after <new tip>`
(`scripts/pr-refresh.ts`). It lists the open `ready-to-land` PRs of this
repository (never a fork) and refreshes each one that GitHub reports
`CONFLICTING`, or whose files the push touched (`git diff --name-only
<before> <after>`). A `queue:shadow` PR only when `CONFLICTING` (issue
#5983): a push to it dequeues it ("manually updated"), and the queue's draft
already tests it on the moved base, where a generated artefact a clean merge
left stale reds `queue-lane`'s drift guards and [`pr-fixup`](#pr-fixup)
regenerates it. Per PR:

1. rebase its head onto the base in a throwaway worktree of the
   [primary checkout](#g-primary-checkout), with **the same step `land` runs**
   (`scripts/lib/rebase-resolve.ts`: `rebaseStep` — the `regenerated` and
   `cr-ledger` merge drivers fire here — then `resolve-generated-artifacts.ts`,
   which re-derives every `REGENERATED_ARTIFACTS` path a driver took a side
   of). A PR conflicting only on generated files is regenerated and pushed,
   with no pass;
2. push with `--force-with-lease` pinned to the head sha the PR was read at: a
   push the land-runner or a session made meanwhile wins, and this one is
   dropped (the PR stays queued, the log says why);
3. a conflict in a file no driver owns aborts the rebase and labels the PR
   `land-failed` with the conflicting paths as a comment — a repair pick for
   `queue:plan` (`/next-ticket <issue> --resume`), re-queued by
   `bun run land:ready <PR#>` after the fix.

**A new script-written committed file is classified in the same PR** (issue
#6116): every generated artefact a conflict could reach is either a row of
`REGENERATED_ARTIFACTS` in `scripts/lib/generated-artifacts.ts` — re-derivable
offline, its `.gitattributes` `merge=regenerated` row, its path in
`.prettierignore` so the generator's bytes ARE the committed bytes — a row of
`OTHER_MERGE_DRIVERS`, or a row of `UNREGENERATED_DATA` saying why it is
neither (sticky, human input, not offline, one-shot, blob). Step 1 then absorbs
its conflicts and no regeneration ever needs a format step.
`generated-artifact-merge.test.ts` reds on a tracked `data/` file with no row,
on a row matching nothing, and on a regenerated path Prettier would reformat. An unclassified one turns every collision into a
repair pass (PR #6064, PR #6068: the blade index).

Nothing else labels or comments: a failed fetch, a moved head, a refused push
or a resolver refusal (no Card Corpus cache on this machine) leaves the PR
queued. `--dry-run` does everything but push and label; `--pr N` restricts it
to one PR.

**It pushes with the owner's identity.** The runner runs as the owner, so
`git push` uses the owner's credentials and `GITHUB_TOKEN` is stripped from
the script's children (as in `land`): a push made with the workflow token does
not trigger other workflows, so the PR's checks would never re-run on the
refreshed head. The workflow's `permissions` stay `contents: read`.

`branches: [staging]` in the workflow names the base by literal — a workflow
cannot read `tolaria.config.json`. Renaming the base (ADR 0116) means editing
that line too.

### queue-lane

`.github/workflows/queue-lane.yml`: the check Mergify's queue runs — `check:lane`
on the queue's draft branch (the PR rebased onto the tip), on a
[`lane`](#g-lane) runner. Its trigger is a push to `mergify/merge-queue/**`, a
branch only an account with write access can create, so no outsider reaches the
runner. The job is named `queue-lane`: that is the status context the queue
rule requires ([the merge queue](#the-merge-queue)).

It runs `bun run check:lane --json --retry-flaky`. **One flaky re-run**
(`--retry-flaky`, `planLaneRetry` in `scripts/lib/health-retry.ts`, the same
refusals as health's retry of issue #5461): a failed `bunx vitest run` step is
re-run once, narrowed to the failed projects and the failing test **files**.

- **Green on the re-run** → the step passes, the check is green, and the flake
  is recorded: in the lane JSON (`outcomes[].flake` = `projects`, `files`,
  `cause` — `timeout` when every failed test timed out, `assertion` otherwise;
  a timeout that passes is a near-miss on the test's budget, not noise) and in
  the job summary (`bun run pr:fixup flakes`). Names and counts only: a public
  repository's logs and summaries are public.
- **Red on the re-run**, or a failure the re-run cannot cover → red at once: a
  FAIL line with no project tag, an unhandled error or rejection, a process
  killed by a signal, and every step that is not vitest (`tsc`, eslint, the
  guards are deterministic — a green second run would hide a real red).

The hosted [`pr-check`](#pr-check) lane runs the same flags, so its summary
records flakes too. Locally: `bun run check:lane --retry-flaky`.

**A PR's newer draft cancels its older draft's run** (issue #6020). Mergify
re-creates a PR's draft on a new branch and deletes the old one; the old run,
running or pending, would keep a [`lane`](#g-lane) runner the live draft waits
for. The job-level group `queue-lane-${{ github.event.head_commit.message ||
github.sha }}` with `cancel-in-progress: true` is keyed by the PR — the draft's
head commit is `Merge of #N`, batch size 1 — never by the branch, which is new
on every draft; the sha is the fallback, so a missing message never groups two
PRs. Drafts of different PRs run side by side. The structure guard pins the
group exactly (rule `queue-superseded`).

**A red draft costs no pass when nothing in the PR is wrong** (issue #5955).
On failure the job runs `bun run pr:fixup classify --lane lane.json --draft
<branch>`: the draft's PR title (`merge queue: checking #N on <base>`) names
the queued PR, and when the lane's only failed steps are
[`pr-fixup`](#pr-fixup) rows, `pr-fixup` is dispatched for that PR. Mergify
dequeues the PR as `land-failed` meanwhile; the fixup's push hands it back
(`ready-to-land`), and the queue re-checks it. Any other red stays a repair
pick.

A lane that REFUSES (a dirty or moved tree) exits before its JSON. The step
tees its stderr to `lane.log`, and `classify --log lane.log` prints the
refusal and dispatches nothing (issue #6003).

### pr-fixup

`.github/workflows/pr-fixup.yml` + `scripts/pr-fixup.ts` (`bun run pr:fixup`):
a red lane whose **only** failing step is a stale generated artefact is fixed
by regenerating it — no session, no tokens.

| Fix key       | The red it cures                                                                                                                            | Regenerated by                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `oracle`      | lane step `check:oracle` — a stale `data/oracle-compiled.json` lockfile                                                                     | the resolver's own row (`REGENERATED_ARTIFACTS`): `oracle:compile --carry-bot` |
| `blade-index` | lane step `blade-index`, or `check:pr` (a `full` lane) whose only failed test file is the drift test — a stale `data/blade-card-index.json` | `bun run blade:card-index`                                                     |
| `format`      | lane step `format(diff)` — formatting drift                                                                                                 | `bun run format`                                                               |

**Detection.** After a red lane, `pr-check` runs
`bun run pr:fixup classify --lane lane.json --pr N`: it prints the fix keys and
dispatches `pr-fixup` only when EVERY failed step has a row. Any other failing
step — a type error, a real test, a vitest red naming another file — makes it
print `not regenerable` and exit 1: the PR is **untouched**. The lane is
fail-fast, so its first red is its only red; a second stale artefact shows up
on the re-run the push triggers. Same-repository PRs only (a fork's token
cannot dispatch).

**The job** (`pr:fixup run --pr N --fixes k,k`, on a [`lane`](#g-lane)
runner): checks out the PR's head in the [job worktree](#g-job-worktree), runs
the named generators, and — only if the tree changed — commits
`Regenerate stale generated artefacts` and pushes to the PR's branch. The push
re-fires `pr-check`; the queue lane then checks the result. `fixes` only
**selects rows** of the table above; it never carries a command. It refuses
(prints `untouched — <reason>`, exits 0) when the PR is not open, is a fork's,
has an author outside `TRUSTED_AUTHORS` (the Actions variable; unset = refuse),
touches `.github/` or `.mergify.yml` (ADR 0156 §8.4), or already ends in two
fixup commits (the loop guard: the regeneration did not cure it).

It regenerates on the PR **rebased onto the base tip** (issue #5955): the
staleness the queue finds appears only there — a whole-tree artefact
regenerated on the old head reproduces the committed file and nothing is
pushed. The push is `--force-with-lease` on the exact head sha the run started
from (the job: the head it fetched; the land-runner: the sha it reset the
worktree to, passed as `--lease`), never on a shared tracking ref: a session's
push that crossed the run is refused, not clobbered. A rebase that stops leaves
the PR untouched. With `--requeue` — set only by the `queue-lane` dispatch — a
PR the queue had rejected on this red is handed back after the push:
`land-failed` → `ready-to-land`, the labels re-read then. A `pr-check` dispatch
never moves a label (a `land-failed` there may be a real red a pass is on).

**Its limits.** A hand-written conflict on the rebase is `pr-refresh`'s (issue
#5638, issue #5942). `oracle:compile` needs the gitignored Card Corpus cache,
which the owner's machines hold; the job's worktree is cut from the primary
checkout, so it finds it where `land`'s resolver does.

**One decision for every red** (`classifyRed`, issue #5955), called by
`queue-lane` (and, until the cut-over, by the land-runner on a red `land`):

| Class         | When                                                                                                                                                                                                                                                   | Then                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `regenerable` | the lane went red and every failed step has a row above (`classifyLane`, never re-derived), and the head does not already end in two fixup commits                                                                                                     | fixed up: the job, or the land-runner's `pr:fixup run --in-place` in the worktree `land` rebased; stays queued                              |
| `infra`       | the lane did NOT go red (green, skipped, never reached), the rebase did not stop (`CONFLICT_LINE` wins: git echoes commit subjects) and a line of `land`'s own output — never the lane's, a test's stderr quotes outages — names the network or GitHub | the land-runner keeps the PR queued and retries it after `INFRA_BACKOFF_S` (5 min); the `INFRA_MAX_STRIKES`-th (3) in a row is `needs-pass` |
| `needs-pass`  | everything else: a real test, a type error, a conflict, a regenerable red past the fixup bound                                                                                                                                                         | `land-failed`, the comment naming the class — a repair pick                                                                                 |

The land-runner reads the lane's JSON from a sidecar
(`TOLARIA_LANE_JSON_OUT`, written by `check:lane` beside its human receipt, each
failed step carrying the test files its captured output named), so the
decision sees the same `outcomes` the queue's lane does.

### post-merge

`.github/workflows/post-merge.yml`: what a merge to the base obliges, now that
`land` is losing it (issue #5644; `land` is frozen and still runs its own copy of the fast-forward, seed, telemetry and teardown, all idempotent, until PRD #5620 retires it). Five jobs:

| Job            | When                    | Runner                                    | Does                                                                                                                                                  |
| -------------- | ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`         | every push to the base  | `[self-hosted, lane, host:<m>]`, a matrix | `bun run post-merge sync`: fast-forward the [primary checkout](#g-primary-checkout), remove the merged PR's worktree, telemetry ingest                |
| `sweep`        | hourly at `:17`         | `[self-hosted, lane, host:<m>]`, a matrix | `bun run post-merge sweep`: remove the issue worktrees no merge cleans up ([§ Worktree removal](#worktree-removal))                                   |
| `seed`         | after `sync`, on a push | `[self-hosted, seed]`                     | `bun run post-merge seed`: fast-forward, then each merged PR's `## Preset scenario`; `seed:preset --all` when the push changed `convex/cards/sets/**` |
| `housekeeping` | a push; hourly at `:17` | `[self-hosted, lane]`, one run at a time  | `bun run housekeeping`: `gaps:sync` with its direct push, grammar residue, claim release, umbrella detach — in a worktree of its own                  |
| `nightly`      | 03:40 UTC               | `[self-hosted, lane]`, one run at a time  | `bun run health:nightly`: Bot Findings refresh when the Bot moved, the weekly audits when due                                                         |

The `host` matrix of `sync` lists the machines by their `host:<name>` label
(`macbook`, `huawei`); a third machine is a third entry. On the MacBook the
fast-forward is what makes `convex dev` serve the merged tree, since it
serves the deployment from the primary checkout. The merged PRs are read off
the pushed commits' subjects (a squash merge ends in ` (#N)`), the worktree
from each PR's head branch by the rule `wt:new` created it with.

**No job requires one host (issue #5873).** `housekeeping` and `nightly` run
on whichever `lane` runner is free: their state — the housekeeping watermark
and retry list, the nightly's last measured tip and audit time — is
[shared state](#g-shared-state), one git ref per key on origin
(`refs/tolaria/state/<key>`, `scripts/lib/shared-state.ts`) read at the start
of a run and written back with a compare-and-swap, so a run on one machine
resumes exactly where a run on the other stopped. `housekeeping` does its work in a throwaway worktree of
`origin/<base>` beside the primary checkout (`<primary>-housekeeping-<pid>`,
removed when the run ends): `gaps:sync` reads the merged tree there and
pushes its allowlist commit from there, never from a long-lived checkout; a
push that loses a race is a failed sync (`gaps:sync` exits 1 on it, issue
#5871) — the batch is retried, the owner told. `nightly` files its Bot Gaps the same way,
from a worktree at the measured tip, and follows the verdict store, not a
machine's `last.json`. A job-level concurrency group keeps
each to one run across machines without cancelling a run in progress; the
structure guard's `host-pinned` rule refuses a literal `host:<name>` on any
job, and `dispatcher-serialised` requires the group on these two. A machine
that is offline or broken therefore costs exactly its own `sync` leg.

**A red leg is heard.** `sync` heals a primary whose only divergence is
stranded `gaps:sync` allowlist commits (dropped with `reset --keep`; the next
sync re-derives them). Any other red `sync` leg, and a red `housekeeping`
(a PR left to retry, one given up on, a state it could not read or write),
notifies the owner through the channel a RED uses (`lib/notify-owner.ts`:
`TOLARIA_NOTIFY_CMD`, else the desktop notifier) — once per distinct notice,
so a failure that repeats every push or every hour is one message, and a
green run makes the same failure news again. A diverged primary that is the
owner's own work is left standing and named in the notice: pull it by hand.
For the command to reach a job, `bun run runner install` writes the
installing shell's `TOLARIA_NOTIFY_CMD` into each runner's `.env`
(actions/runner loads it into every job); on a headless Linux runner the
desktop fallback reaches nobody, so set it there. A runner that is fully
offline notifies nobody by itself: its `sync` leg waits in the queue and
GitHub's failed-run mail, after 24 h, is the signal.

#### Worktree removal

Worktrees are machine-local, so both removers run on every machine (issue
#6083). Neither ever deletes a branch, local or remote: a closed or
abandoned PR's work stays recoverable.

- **`sync`, per merge.** The merged PR's head branch, trimmed (`gh` prints
  it with a trailing newline, which once made every merge skip its
  worktree), names the `wt:new` worktree. Every outcome is one line —
  `post-merge: PR #N: worktree … removed`, `… not on this machine`,
  `… is in use`, or `head branch "…" maps to no issue worktree`; a failed
  lookup or removal reds the leg and reaches the owner's notice.
- **`sweep`, hourly.** `wt:gc --issues-only` by another name: the same
  classifier (`scripts/worktree-gc.ts` § `classify`) over this machine's
  `feat|fix/issue-N` worktrees only, every one listed with its verdict. It
  removes one only when nothing is inside it (`lsof`), it is not locked, its
  tree is clean (a `git status` that fails counts as dirty), its issue
  carries no `in-progress` / `pr-open` claim, and either its PR merged — or,
  with every commit on `origin/<branch>` or in the base, its PR was closed
  unmerged, or it has no PR and has not changed
  for `ORPHAN_IDLE_MINUTES` (24 h). A claim is read off the labels: a dead
  pass's label is released by the dispatcher, after which the sweep sees the
  worktree as unclaimed. Any reading it cannot make keeps the worktree; a PR
  list or claim list it cannot read removes nothing and reds the leg. Like
  `housekeeping`, it fires from the default branch's copy of the workflow.

Orders that hold:

- **fast-forward before seed.** The seed resolves card names server-side
  against the bundle pushed from the primary checkout's disk (issue #3253). The
  `seed` job fast-forwards again itself and seeds nothing if that fails — so a
  red `sync` on the Huawei does not hold the MacBook's seed, and a stale tree is
  never seeded. A primary checkout on another branch than the base is left as
  it was (the job goes red; pull it by hand).
- **Every step runs, the job goes red if one failed.** `land` hid these
  failures behind `; true` because a merge cannot be undone; a job can be
  re-run (`Re-run failed jobs`), and every step is idempotent.
- **Schedules fire from the default branch.** The hourly and nightly jobs
  start only once a release carries `post-merge.yml` to it. The hourly run is
  `housekeeping`'s retry for a PR whose steps failed (its state keeps them).
- **A worktree in use is left alone.** `land` still runs inside the PR's
  worktree when the push fires; `sync` skips a worktree any process has as its
  cwd (`lsof`) and `land`'s own teardown removes it.
- **Schedules and dispatch run the release branch's scripts.** A schedule's
  `GITHUB_SHA` is the default branch tip, so a fix to `housekeeping` landed on
  the base is live only after the next release. `workflow_dispatch` takes a
  `job` input (`housekeeping` or `nightly`).
- **Serialised by the runner, and by a group where the duty is shared.** One
  `lane` runner per machine is an invariant here: a second lane runner would
  let a machine's `sync` legs race on its primary checkout. `housekeeping` and
  `nightly` carry a job-level `concurrency: { group, cancel-in-progress: false }`
  because they run on any machine; a pending run the group drops loses
  nothing (the next re-reads every fact from shared state). `seed` has no
  `needs: sync`, which would wait for the slower machine's leg.
- **The first shared run inherits the machine's file.** A `state.json` /
  `nightly.json` left under `.claude/telemetry/` by a run from before issue
  #5873 is read as the first shared state when the ref holds none; after that
  the files are dead. The machine that holds the live retry list (the
  Huawei, before issue #5873) should run `bun run housekeeping` once by hand
  before the first job runs elsewhere, so its list seeds the ref.

`branches: [staging]` names the base by literal, as in
[`pr-refresh`](#pr-refresh).

### health

Batch health runs as two workflows (issue #5645; the Huawei's health runner
was deleted by issue #5655). Both run `health-main` — kept whole: one re-run of a failed vitest
project (issue #5461), the [INFRA](#g-infra) classification, the evidence on
the pivot — and write the verdict where it always went: the `health` commit
status on the gated sha (the only verdict store), which
[`base-health`](#g-base-health) reads.

| Job                        | When                                           | Runner                       | Runs                                                                                                  |
| -------------------------- | ---------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `health.yml` `gate`        | every 2 h at `:50`, dispatch (`job: gate`)     | `[self-hosted, lane]`        | `bun run health --scheduled --retry-infra`, then the [RED ladder](#g-red-ladder) when it is not GREEN |
| `health.yml` `ladder`      | dispatch (`job: ladder`, `sha`) — from `early` | `[self-hosted, lane]`        | `bun run health:bisect ladder --sha <sha>`                                                            |
| `health-early.yml` `early` | a push to the base, one run at a time          | GitHub-hosted `ubuntu-24.04` | `bun run health --early`: the [early run](#g-early-run); a RED dispatches `ladder`                    |

**The scheduled run** gates `origin/staging`'s tip from the job's
[worktree](#g-job-worktree) — the one linked worktree `health-main` accepts;
its records still go to the [primary checkout](#g-primary-checkout)'s
`.claude/telemetry/health/`. Unattended, it re-gates an INFRA tip
(`--retry-infra`) but never one the store holds a RED for: that tip is the
ladder's, and a repair moves it. No browser walk (a batch owes none, issue
#5378; `release` walks). A tip already GREEN on the store is skipped in
seconds.

**The early run** fills the two hours between: after a merge batch a free
hosted runner runs the same offline gate on the new tip, so fewer PRs
separate the last GREEN from a RED. A hosted runner holds no corpus reader
key (issue #5675), so the run sets `TOLARIA_HOSTED_NO_VERDICT_CORPUS` and
skips the committed-corpus tests — and a run that skipped tests proves no
GREEN. **Only its RED reaches the store**; its GREEN and INFRA stay in the
VM's record. The batch is a concurrency group without `cancel-in-progress`:
one run at a time, and the pushes that land meanwhile collapse into one
pending run of the newest tip (allowed because the workflow is hosted-only —
[§ Serialising heavy work](#serialising-heavy-work)).

**The [RED ladder](#g-red-ladder)** (`scripts/health-bisect.ts`, decisions
in `scripts/lib/health-bisect.ts`) runs on a `lane` runner:

1. **[Flake check](#g-flake-check).** The RED's failing test files — read
   from its evidence, which always has room for them — re-run once, fresh,
   at the RED sha in a throwaway worktree (`worktree:init`, then
   `bunx vitest run <files>`; the blade's specs under
   `vitest.blade.config.ts`). A RED naming no file re-runs its failed step
   (`bun run check:all`, …). Health stops at its first failed step (and
   `test`'s chain at its first red tier), so when that part passes the
   ladder runs **every gate the RED's run never reached** in the same
   worktree (`remainingGates`: after a `test:app` file, `test:bot` and
   `test:blade`; after `check:all`, the guards and `test`). **Not
   reproduced** — all of it green: the RED closes as GREEN on the same sha
   (`flake: <step> passed on a fresh run` — last writer wins) and each flaky
   file is filed as `Flaky test: <file>` (`bug`, `area:workflow`,
   `needs-triage`; an open issue of that title gets a comment instead — the
   search index can lag, so two ladders at once may file it twice). A gate
   the RED's run never reached failing instead keeps the RED standing, not
   bisected.
2. **[Bisect](#g-bisect)** when it reproduced: the base's first-parent
   commits after the last GREEN (the newest ancestor the store holds a GREEN
   for, at most 60 back), binary-searched on the failing files — a commit
   without a file yet counts green, so a test the culprit added names the
   culprit. The first red commit's PR (` (#N)` in a squash subject) is added
   to the RED's published evidence as a `- **culprit:**` line, which
   `bun run health:status --evidence` prints. A probe that could not run ends
   the search with no culprit rather than a guess.

Every RED the ladder confirms gets that `- **culprit:**` line, named or not
— the mark that it was climbed: a later ladder on the same RED stops at once
and exits 0, so a standing RED emails once. With no `--sha` the ladder takes
the RED standing on the store's lineage, whoever found it — so the gate
job, which runs the ladder every time, climbs an early RED whose `ladder`
dispatch was lost — else this machine's last run, when the store never took
its RED. Probe worktrees (`tolaria-bisect-<pid>-<n>`) a killed job left are
removed at the next ladder's start.

Its next rungs — the fixer, the revert of the culprit, the stop — are
[`health-fix`](#health-fix)'s. Each `health` job ends by asking
`bun run health:fix ladder --dry-run` whether one is owed (`rung=fix`,
`revert` or `stop`) and, when it is, dispatches `health-fix.yml` to its own
machine (`host` = its runner's `host:` label, `bun run health:fix host`):
the machine that reproduced the RED. Asked on every run, so a lost dispatch
is re-sent by the next one; a rung already in flight reads `wait`.

**What the owner sees.** A RED is a red `health` status on the tip and holds
the queue: each job re-dispatches [`pr-gate`](#pr-gate) when it ends (the
hosted run's status is written with the job's token, which fires no
`status` event), and `base-health` goes red on every queued PR that closes
no declared repair. A RED the ladder leaves standing fails the job, so
GitHub's failed-run email reaches the owner; a flake the ladder closed
leaves a green job and a filed issue. An early RED's own job stays green —
its ladder job is the one that fails.

By hand, on a machine with the owner's `gh` login:

```bash
bun run health:bisect ladder --sha <sha> --dry-run   # the fresh run, no write
bun run health:bisect bisect --sha <sha> [--good <sha>] [--files a,b] --dry-run
```

Each run's log: `.claude/telemetry/health/<sha12>.ladder.log` in the
primary checkout.

Orders that hold:

- **Schedules and dispatch need the default branch.** The two-hourly run,
  and the `ladder` dispatch `health-early` sends, start once a release
  carries `health.yml` to it; until then the early run's RED holds the queue
  with no ladder behind it. The
  early job dispatches `pr-gate` first, so a failed `ladder` dispatch never
  costs the hold.
- **`--ref staging`** names the base by literal, as `post-merge`'s
  `branches:` does.

### health-fix

`.github/workflows/health-fix.yml` is the RED ladder's last three rungs
(ADR 0156 Amendment I, issue #5646). Each run takes ONE rung, decided by
`ladderRung` (`scripts/lib/health-ladder.ts`, a pure function with its
tests in `scripts/__tests__/health-ladder.test.ts`) from facts read off the
pivot: the standing RED (`lineageBlocks`), its evidence, the
`health-fix-attempt` records of every RED since the last GREEN (the
**episode**), the revert PR's state, and an open escalation issue. The job
runs `bun run health:fix ladder` on a [`pass`](#g-pass) runner of the
machine `health` named (`host` input; empty = any `pass` runner).

| Rung     | When                                                                                                 | Does                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `none`   | no RED stands                                                                                        | nothing                                                                                                            |
| `wait`   | a fact is unreadable; the tip has no verdict yet; no flake check/bisect yet; an attempt is in flight | nothing — a later dispatch decides                                                                                 |
| `fix`    | fewer than **2** fixer attempts used in the episode                                                  | `/health-fix <sha> --headless`, killed after **3 h**; its PR is the RED's declared repair                          |
| `revert` | both attempts stuck, or a second RED after a repair landed (or after an AMBER), and a culprit named  | `scripts/health-revert.ts`: a revert PR of the culprit's commit, queued as the repair; the culprit's issue reopens |
| `stop`   | the revert does not apply or cannot land, the RED outlives the merged revert, or no culprit is named | one `ready-for-human` issue `RED ladder stopped @ <sha8>`, the run fails                                           |
| `hold`   | that issue is open, or the stop's marker stands                                                      | nothing, quietly                                                                                                   |

**Bounds.** Two fixer attempts per RED episode, three hours each (the
job's `timeout-minutes` is 210); an `attempting` record older than 3 h 30
was killed with its job, and a `landed` one that has not moved the tip in
8 h, count as used attempts. One revert per episode: a RED that survives
it, or a revert the queue dequeues (`land-failed`), someone closes, or that
waits in the queue past 12 h, stops the ladder — never a second revert. A
revert try that failed for any reason but the revert itself (an API error,
a refused push) is retried up to three times, reusing its issue and PR. A
rung that ended without settling the RED (a stuck attempt, a failed try)
dispatches the next run itself (`Next rung`, `hop` + 1, at most 8 runs per
chain); a rung that could not even record itself dispatches nothing — the
next `health` run asks again. A repair in the queue or merged waits for
health's next verdict, and health's dispatch. Runs are serialised across
both machines (`concurrency: health-fix`, the structure guard's
`dispatcher-serialised`), so two never read "no attempt yet" at once. Exit 1
is the stop alone: a run that fails before its rung (a fetch, an unreadable
store) logs it and exits 0 — an outage never emails.

**The fixer** is `health:fix --headless`'s session (issue #5589), with the
ladder's rung and attempt on its pivot record (`fix 2`). An attempt that
ends stuck closes every open PR closing one of the RED's declared repair
issues, so the next rung never lands beside a half-done repair. Its transcript goes
to `~/.cache/tolaria/jobs/<run id>-<attempt>/health-fix-<n>.log` on the
machine — never the public log ([§ Public logs](#public-logs)). Its flags
are the repository variable `HEALTH_FIX_CLAUDE_ARGS` (default
`--dangerously-skip-permissions`, as `loop:afk`'s). Its repair issue is
recorded on the pivot (`health:fix repair-issue --issue=<N>`), so its PR is the one
PR [`base-health`](#g-base-health) admits, and `repair-proof` proves it.

**The revert** (owner's decision 2026-10-14, the amendment of CLAUDE.md's
"fix-forward FIRST": fix-forward stays first) reads the culprit off the
RED's `- **culprit:**` evidence line. In order: the `revert` rung is
recorded `attempting`; `git revert` of the culprit on `revert/<sha12>` off
the base tip, in a throwaway worktree — a conflict (a later PR depends on
the culprit) records it `stuck` and exits 3, and the next run stops; a
repair issue is filed and recorded on the pivot; the branch is pushed, the
PR opened (`Closes #<repair issue>`, `## Preset scenario` none owed, a
`check:ui` no-walk line) and labelled `ready-to-land`; the culprit PR's
closing issues reopen with the evidence and `ready-for-agent` (the claim's
`in-progress`/`pr-open` removed), natively **blocked by** the repair issue
the revert PR closes — a revert that never lands never sends the culprit's
issue to a pass. A failed `blocked_by`, reopen or label edit is named in the
log. A revert of a DOM-reaching PR may still be refused by
`ui-receipt`: that is a revert that cannot land, so the ladder stops.

**The stop** is the one email: the run that stops writes a `stop` marker
on the RED's `health-fix-attempt` record, files the escalation issue, and
fails; every later run finds the marker (or the open issue) and holds — a
filing that failed still emails once. The RED itself keeps the
queue held ([`base-health`](#g-base-health)) and the
[dispatcher](#afk-dispatch) idle (`red`). The issue carries the reason and
the evidence; close it once health reads GREEN.

By hand, on a machine with the owner's `gh` login:

```bash
bun run health:fix ladder --dry-run   # the rung the next run would take, nothing acted on
bun run health:revert --sha <red> --culprit <sha> --dry-run   # does the revert apply?
```

Orders that hold: the dispatch needs `health-fix.yml` on the default
branch, like `health`'s schedule; until a release carries it, `health`'s
dispatch fails (`continue-on-error`) and the ladder ends at the bisect.

### release

`.github/workflows/release.yml` (issue #5647): the release branch moves by a
dispatch, no longer by `bun run release` typed on the MacBook (the script is
the same, ADR 0116's green-at-release unchanged).

| Job       | When                             | Runner                | Runs                                                                     |
| --------- | -------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| `release` | dispatch (`dry_run`, default on) | `[self-hosted, lane]` | `bun run release --no-fix` (`--gate-only` on a dry run), under `release` |

**What it does.** From the job's [worktree](#g-job-worktree) of the primary
checkout (which holds the Convex deployment the walk needs), `release` gates
`origin/staging`'s tip with `health-main --ui-all`: the full offline gate AND
the full `check:ui` walk. Only a GREEN verdict about that exact sha lets it
push `<sha>:refs/heads/<release>` — a plain refspec, so git itself refuses a
non-fast-forward; nothing passes `--force`. `pushRefusal` re-asks of the
record the push acts on, right before it. The verdict goes to the store like
any health run's.

**Dry run.** `dry_run: true` (the default) runs everything except the push
(`--gate-only`): the gate, the verdict, the decision. It prints
`--gate-only — <sha> is GREEN; <release> left where it is`, or the refusal.

**No fixer.** The job has no terminal: a RED is a failed job (GitHub's
failed-run email), `--no-fix` says so. The repair is
[`health.yml`](#health)'s ladder and, by hand, `bun run health:fix`.

**The Environment.** The job declares `environment: release`. Create it once
(Settings → Environments): add the owner as a required reviewer, so a
dispatch waits for an approval, and nobody else's dispatch reaches the
runner. The push uses the owner's git identity (the runner runs as the owner),
which is the release branch's bypass.

```bash
gh workflow run release.yml -f dry_run=true --ref staging    # the dry run
gh workflow run release.yml -f dry_run=false --ref staging   # the release
```

Orders that hold:

- **Dispatch needs the default branch.** `release.yml` starts only once a
  release carries it there; until then `bun run release` is the way.
- **The tip is the script's, not the job's.** `GITHUB_SHA` only names the
  job's scripts; the script fetches the base and gates what it finds.
- **A release the Huawei is gating.** Health dedups by sha on the store: a
  tip already GREEN with a full walk is skipped in seconds.

### lane-timing

`.github/workflows/lane-timing.yml`: the same `check:lane` on one machine's
[`lane`](#g-lane) runner. Time a PR's lane there by pushing its head to a
`lane-timing/` branch, or dispatch it from the Actions tab (input `host`):

```bash
git push origin <pr-head-sha>:refs/heads/lane-timing/pr-<N>
git push origin --delete lane-timing/pr-<N>          # afterwards
```

It exists for ADR 0156 §10's measurement (hosted vs local lane); it is also
the reference shape of a self-hosted job.

### afk-dispatch

`.github/workflows/afk-dispatch.yml` runs `bun run afk:dispatch`
(`scripts/afk-dispatch.ts`; every decision is a pure function in
`scripts/lib/afk-dispatch.ts`). It is the one place an AFK
[pass](#g-pass) starts from (ADR 0156 Amendment I): it picks as many issues
as there are free `pass` slots, claims each (`in-progress`, re-read just
before), and dispatches `afk-pass.yml` with inputs `issue`, `model` (the
picker's tier), `resume` and `host`.

**Triggers.** An issue labelled `ready-for-agent` (any other label skips the
job), a 30-minute `schedule` sweep, and `workflow_dispatch` — which every
`afk-pass` run sends at its end. That dispatch is created while the pass
still holds its runner: it refills the slot when it lands on that same
runner (counted as its own), otherwise the next trigger or sweep does.

**One run at a time, across both machines.** The job declares
`concurrency: { group: afk-dispatch, cancel-in-progress: false }`: a running
dispatcher is never cancelled mid-claim, and a newer trigger displaces an
older pending one — harmless, since every run re-reads every fact. It is the
structure guard's one allowed group on a self-hosted job, and the guard
requires it (`dispatcher-serialised`); at job level, so a skipped run (an
`in-progress` label the dispatcher itself adds) never displaces a pending
one. Behind it, a fresh claim is taken only if the issue, read again, is
still queued and unclaimed.

**Free slots.** Every online, idle `pass` runner, plus the dispatcher's own
(it frees within seconds), minus the `afk-pass` runs still waiting for a
runner. A pass dispatched moments ago and not yet listed is not subtracted:
the worst case is one extra pass queued for a runner, never a double claim.
The log and summary print counts and issue numbers only — no host names on a
public log.

**What it picks** — through the picker (`scripts/lib/picker.ts`, the
`queue:plan` order and admission, [trusted authors](#g-trusted-authors) only,
HITL excluded):

1. **Resume** a dead pass: a claim whose last `afk-pass` run ended, with its
   branch pushed (or a PR the queue labelled `land-failed`). Pinned to the
   host that ran it (`host` input) while that host has a `pass` runner
   online — it waits there for a free slot; unpinned once the host is
   offline, since the branch is pushed.
2. **Release** an orphan: a claim whose last `afk-pass` run ended with
   nothing pushed.
3. **Fresh picks**, in the picker's order, one per remaining slot.

A claim is never touched while an `afk-pass` run for it is queued or
running, while its PR waits in the queue (open, not `land-failed`), or when
no `afk-pass` run for it was created after the claim was taken (its newest
`in-progress` label event, less two minutes of clock slack). Such a claim is
a session outside the pipeline — an owner's `/next-ticket`, the old loop —
or the dispatcher's own claim whose run is not listed yet; an older run of
the same issue proves nothing about it, and an unreadable claim time holds
too. A pass run names its issue in its run name: `afk-pass #<N>`.

The claim itself is check-then-act (labels re-read, then `in-progress`
added): one run at a time makes it race-free between dispatchers, but only
best-effort against a human claiming the same issue in the same second.

**Holds** — the run dispatches nothing, prints why in its log and job
summary, and exits 0 ("nothing to do"); the next trigger re-checks. In order:

| Hold               | Holds while                                                                                                                            | Lifts when                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `disabled`         | `afk-dispatch.yml` itself is disabled (a run queued before the kill switch)                                                            | the workflow is enabled again                                                   |
| `no-pass-workflow` | `afk-pass.yml` is absent or disabled on the default branch (before issue #5650 landed, the dispatcher was inert)                       | `afk-pass.yml` is on the default branch and enabled                             |
| `failure-streak`   | the last three completed `afk-pass` runs failed (`failure`, `timed_out`, `startup_failure`; a `cancelled` run is passed over)          | the owner acknowledges: `gh workflow run afk-dispatch.yml -f ack_failures=true` |
| `unknown-health`   | the health verdict store cannot be read — unattended, an unknown base holds                                                            | the store answers again                                                         |
| `red`              | the base's health verdict is RED (the `health` commit status, ADR 0116)                                                                | health reads GREEN or AMBER                                                     |
| `records-unknown`  | a pass that finished (success or failure) in the window has no readable `afk-pass-record` — its tokens and reset time would be missing | the artifact reads, or the run leaves the window                                |
| `usage-limit`      | a pass's record names a usage-limit reset time still in the future                                                                     | that time passes                                                                |
| `no-budget`        | the repository variable `AFK_TOKEN_BUDGET` is unset or 0 — the dispatcher never runs unbudgeted (ADR 0109)                             | the owner sets it                                                               |
| `budget`           | the [budget reading](#g-budget-reading) is at or past `AFK_BUDGET_MAX_PCT` of `AFK_TOKEN_BUDGET`                                       | the window slides past the spend                                                |
| (no free runner)   | every `pass` runner is busy or offline                                                                                                 | a pass ends (it dispatches the dispatcher)                                      |

The **failure streak** is the one hold that fails a run: the first
dispatcher run that sees it exits 1, so GitHub sends ONE failure email; later
runs see that failed run and hold quietly. Read the failed passes, then
acknowledge — the `ack_failures` dispatch carries `failures acknowledged` in
its run name, and only pass runs completed after it count. The **RED** hold
never blocks the fixer: the fixer is `health-fix.yml`'s (issue #5646), not a
dispatched pass.

**Repository variables** (Actions → Variables; admin-only):

| Variable             | Meaning                                                         | Default |
| -------------------- | --------------------------------------------------------------- | ------- |
| `AFK_TOKEN_BUDGET`   | weighted tokens (`usage:window`'s unit) per window — required   | none    |
| `AFK_BUDGET_MAX_PCT` | percentage of the budget past which nothing new is dispatched   | 80      |
| `AFK_BUDGET_HOURS`   | the trailing window, hours                                      | 5       |
| `TRUSTED_AUTHORS`    | [trusted authors](#g-trusted-authors), commas or spaces between | owner   |

**The pass record.** Each `afk-pass` run uploads an artifact
`afk-pass-record` holding `record.json` (`PassRecord`, version 1, in
`scripts/lib/afk-dispatch.ts`): issue, PR, outcome, host, start and end,
duration, tokens per model, cost, and — when the pass hit the usage limit —
`usageLimitResetAt`. Numbers only: no Claude output.

**Kill switch.** Disable the workflow — Actions tab → afk-dispatch → "Disable
workflow", from any browser, or:

```bash
gh workflow disable afk-dispatch.yml   # no new pass starts; running passes finish
gh workflow enable afk-dispatch.yml    # resume; the next trigger dispatches
```

A pass already running is not touched; when it ends, the dispatch it sends
is refused by GitHub (a disabled workflow cannot be dispatched) — so
`afk-pass`'s final dispatch step must be `continue-on-error` (issue #5650),
or every pass during a kill would count toward a failure streak. A
dispatcher run already queued at the kill reads its own workflow's state and
holds (`disabled`). Its claim stays, and the
next enabled run resumes or releases it.

A dry run prints the plan without claiming, releasing or dispatching, on a
machine with the owner's `gh` login: `bun run afk:dispatch --dry-run`.

### afk-pass

`.github/workflows/afk-pass.yml` runs ONE [pass](#g-pass): `bun run afk:pass`
(`scripts/afk-pass.ts`; every decision is a pure function in
`scripts/lib/afk-pass.ts`). Only the [dispatcher](#g-dispatcher) starts it,
with the issue it already claimed and the inputs `model`, `resume` and `host`
([§ afk-dispatch](#afk-dispatch)). The run is named `afk-pass #<N>`
(`afk-pass #<N> (resume)`): the name is how the dispatcher tells which claim
a run holds. Its runner is `[self-hosted, pass]`, plus `host:<host>` when a
resume is pinned — an input, never a literal (`host-pinned`).

**What the job does**, after the [job worktree](#g-job-worktree) and the
[job setup](#g-job-setup):

1. **launches the session** —
   `claude --model <tier> --session-id <uuid> -p "/next-ticket N" --output-format json`,
   `/next-ticket N --resume` for a resume, then the permission mode
   (`AFK_PASS_CLAUDE_ARGS` — the owner's call, with NO default: unset, the
   job refuses as `setup-failed` before any session starts, the loop's own
   rule). Its environment is the old loop's:
   `TOLARIA_LOOP_DRAIN=1` (the skill's hand-off detaches no driver),
   `TOLARIA_LOOP_RUN_ID=gh-<run id>-<attempt>` (the session-origin hook books
   the session under it), `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`. The
   session reads `job.md` ([a pass inside a job](#a-pass-inside-a-job)) and
   pushes after every commit;
2. **bounds it** — `AFK_PASS_TIMEOUT_MIN` (default 180, at most 190) ends the
   session BEFORE the job's `timeout-minutes: 210`, so the record still gets
   written; a job killed by its own timeout leaves none (a `timed_out` run,
   which the dispatcher's `records-unknown` hold does not wait for);
3. **reads what the pass left** — the issue's open PR (by branch,
   `feat/issue-N` or `fix/issue-N`) and labels, the session's transcripts
   (`~/.claude/projects/*/<uuid>.jsonl` and its subagents' under
   `<uuid>/`) for tokens and the usage limit, the JSON result for the cost;
4. **pushes stopped work** — when the pass stopped short (usage limit,
   timeout, error, no hand-off) on its own issue branch, uncommitted work is
   committed as `wip(afk-pass): …` and the branch pushed, both
   `--no-verify` (the pre-push format check would refuse a stopped pass's
   unformatted edits, and the work dies with the worktree): the next
   dispatch resumes it from `origin`. A detached HEAD, any other branch, a
   hand-off, an abort or an issue whose state could not be read is left
   alone — nothing here can push the base;
5. **writes the record** — `record.json` in `$RUNNER_TEMP/afk-pass-record`,
   uploaded as the `afk-pass-record` artifact `if: always()` (14 days), and
   the job summary; even a refused dispatch or a crash leaves one, and a
   job whose worktree or job setup failed gets a `setup-failed` record from
   a bash step (`if: failure()`, no bun needed);
6. **refills the slot** — `gh workflow run afk-dispatch.yml`,
   `continue-on-error` (the kill switch refuses the dispatch).

**Outcomes** (the record's `outcome`), first match wins:

| Outcome        | When                                                                                                               | Run   |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ----- |
| `handed-off`   | the issue's PR is labelled `ready-to-land`                                                                         | green |
| `closed`       | the issue is closed                                                                                                | green |
| `usage-limit`  | a transcript carries the API's rate-limit refusal (`error: "rate_limit"`)                                          | green |
| `aborted`      | the issue holds neither `in-progress` nor `pr-open` (`abort.md` released)                                          | green |
| `timeout`      | the session ran past `AFK_PASS_TIMEOUT_MIN`                                                                        | red   |
| `error`        | `claude` exited non-zero, or the issue's state could not be read                                                   | red   |
| `no-hand-off`  | `claude` exited 0 with the claim still held and nothing in the queue                                               | red   |
| `setup-failed` | the job setup failed, the dispatch's inputs are malformed, or `AFK_PASS_CLAUDE_ARGS` is unset — no session started | red   |

A red run counts toward the dispatcher's failure streak; its claim stands,
and the dispatcher resumes it (branch pushed) or releases it (nothing
pushed). **A usage limit** is green on purpose: the record's
`usageLimitResetAt` is the latest `resetsAt` the refusal named, and the
dispatcher holds every new pass until it passes (`usage-limit` hold). A
refusal naming no reset (a model that needs usage credits) holds one hour.

**Public logs.** The session's stdout (the JSON result) and stderr go to
`~/.cache/tolaria/jobs/<run id>-<attempt>/afk-pass-<N>.log` and
`.stderr.log` on the machine; the transcript stays in `~/.claude/projects`.
The log gets the exit code, the path and the outcome; the summary, issue,
PR, outcome, duration, cost and tokens per model — no host name. The `gh`
token is masked by the job setup.

**Repository variables** (beside the dispatcher's):

| Variable               | Meaning                                                                                                        | Default |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------- |
| `AFK_PASS_CLAUDE_ARGS` | the session's extra `claude` arguments — its permission mode, e.g. `--dangerously-skip-permissions` — required | none    |
| `AFK_PASS_TIMEOUT_MIN` | the session's bound, minutes (at most 190)                                                                     | 180     |

Run one by hand (the issue must already be claimed — the job never claims):
`gh workflow run afk-pass.yml -f issue=<N> -f model=sonnet`.

### pr-gate

`.github/workflows/pr-gate.yml` posts two commit statuses on a PR's head
sha; `scripts/pr-gate.ts` is the I/O, `scripts/lib/pr-gate.ts` the two
decisions. It runs on `pull_request_target` (`opened`, `synchronize`,
`reopened`, `edited` — the body decides a repair — and `labeled`), so it is
the **base's** workflow and code that run, with a token that can write
statuses: the job checks out the base only and reads the PR as data —
author, body, file list — through the API, never its tree.

| Status                                | Green when                                                                                                                                                                             | Red when                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`trusted-author`](#g-trusted-author) | the author is in [`TRUSTED_AUTHORS`](#g-trusted-authors); Mergify's own queue PRs (`mergify[bot]`, `mergify/merge-queue/…`, same repository) always                                    | the author is not, or the PR touches `.github/`, `.mergify/` or `.mergify.yml` (a rename counts both names), or its file list is truncated (over 3000 files) |
| [`base-health`](#g-base-health)       | no RED stands on the base's health lineage (GREEN, AMBER, INFRA, no verdict yet), or the PR closes a repair issue declared on the pivot (`health-fix`); Mergify's own queue PRs always | a RED or second RED stands and the PR closes none of its declared repair issues                                                                              |

`base-health` is the land-runner's RED rule — `healthAdmission`, which
`planTick` reads too, so the two cannot drift. One difference: the
land-runner reads an unreadable verdict store as no RED for one 60 s tick,
but a commit status stands until something re-posts it — so `pr-gate`
posts `base-health` **`pending`** instead (held, not blamed) and the run
goes red; the next sweep decides again. Each status is decided on its own:
a failed file-list read never leaves an old `base-health` standing. A PR
touching `.github/` — this workflow's own PRs included — is never
queueable: the owner merges it by hand. **Known gap:** the gate's own code
outside `.github/` (`scripts/pr-gate.ts`, `scripts/lib/pr-gate.ts`, the
health modules it imports, `tolaria.config.json`) is queueable today, as
ADR 0156 §8 names only `.github/` and `.mergify.yml`.

**Mergify's queue PRs pass both.** Mergify judges a queued PR's entry
conditions on its draft ([the merge queue](#the-merge-queue)), so a red there
dequeues the PR. `trusted-author` would be red because the draft's author,
`mergify[bot]`, is no trusted author; `base-health` under a RED because the
draft's body is Mergify's and declares no repair (issue #5978).

**Re-gate.** A `health` or `health-fix` commit status — a verdict written,
or a repair issue recorded on the pivot — fires the workflow's `status`
trigger, which re-posts both statuses on every open PR labelled
`ready-to-land`: a RED holds the queue, a GREEN or AMBER reopens it, a newly
declared repair is admitted. Only a status written with a personal token
fires it (the machines' `gh` login writes the verdicts; a status written
with a job's `GITHUB_TOKEN` fires nothing — so the [`health`](#health)
workflows dispatch `pr-gate` explicitly when they end). GitHub cannot filter `status` by context, so every
OTHER status written with a personal token (`health-run`, `ui-walk`) shows
as a **skipped** `pr-gate` run — expected, not a failure. A 15-minute
`schedule` sweeps the same queue: it heals a `pending` left by an outage and
a race between a PR's own run and a re-gate. By hand: Actions → pr-gate → Run workflow (input
`pr` = one PR, empty = the queue), or locally, posting nothing:

```bash
TRUSTED_AUTHORS=<login> bun scripts/pr-gate.ts --dry-run --pr <N>
```

Both statuses are entry conditions of [the merge queue](#the-merge-queue)
(the [structure guard](#g-structure-guard)'s `queue-entry` rule).

## The merge queue

`.mergify.yml` (ADR 0156 §3 and §8, Amendment I; issue #5642). Mergify reads
it from the **base** branch, so a PR is judged by the rules already merged,
never by its own. Since [the cut-over](#the-cut-over) (issue #5643) it is the
only merger of a `ready-to-land` PR. `land:ready` still adds `queue:shadow` to
a PR the queue admits — a marker [`pr-refresh`](#pr-refresh) reads, no longer
a condition. A PR touching `.github/` or `.mergify.yml` never enters the
queue: the owner merges it by hand.

| Rule                       | Value                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-queue                 | `merge_protections_settings.auto_merge_conditions`: `label=ready-to-land` — no `@mergifyio queue` comment needed                                                                                                                                  |
| Entry (`queue_conditions`) | `ready-to-land`, no `land-failed`, no red `check:lane (advisory)` ([`pr-check`](#pr-check)), [`trusted-author`](#g-trusted-author) and [`base-health`](#g-base-health) green, no file under `.github/`, no `.mergify.yml`                         |
| Merge (`merge_conditions`) | [`queue-lane`](#queue-lane) green on the queue's draft — and nothing else: the entry gates were proven on the PR                                                                                                                                  |
| Parallel checks            | `merge_queue.max_parallel_checks: 2` — two speculative drafts, one per machine's [`lane`](#g-lane) runner                                                                                                                                         |
| Batch                      | `batch_size: 1` — no batches (at a 15 % red rate a batch holds a bad PR more often than it saves a run)                                                                                                                                           |
| Merge method               | `squash`, as `land` merges                                                                                                                                                                                                                        |
| Dequeue                    | on `checks-failed` or `checks-timeout`: `ready-to-land` → `land-failed`, plus a comment naming the reason and linking the `queue-lane` runs; Mergify's own dequeue comment (`status_comments: outcomes`) links the failing run of this PR's draft |

`land-failed` is the repair pick's trigger (`afk-dispatch` re-fires the PR's
issue), and `-label=land-failed` keeps the PR out of the queue until the
repair's `land:ready` swaps the labels back. Mergify's default `dequeued`
label is off (`dequeued_label: null`).

**Where Mergify judges the entry conditions.** While a PR is queued, Mergify
re-checks the check conditions of `queue_conditions` on the queue's **draft**,
not on the PR (the draft's body lists them as "Required conditions to stay in
the queue"), and a PR dequeued because one stopped holding is not requeued by
itself: Mergify's lifecycle says it "must be fixed and requeued". So a check
in `queue_conditions` must be an entry gate a draft passes by construction:
`pr-gate` posts both of its statuses green on a queue PR (issue #5978). A RED
holds a PR at entry, on its own head. A PR already in the queue is not
stopped by it: it finishes, unless its own head's re-gate dequeues it first —
which of the two happens to a PR not yet drafted (third or later) is not
observed yet. A check that reads the PR's body (the `land` refusals) can
never be one: `land:ready` runs those before the hand-off. A PR stranded
anyway — `ready-to-land`, no `land-failed`, both gates
green, no `queued` label (Mergify's own), its "Mergify Merge Queue" check
stuck on "conditions under evaluation" — re-enters with a comment:

```bash
gh pr comment <N> --body "@mergifyio requeue"
```

**Who lands a PR** is decided at hand-off (issue #5952). `land:ready`
computes the PR's [`trusted-author`](#g-trusted-author) verdict exactly as
`pr-gate` posts it (`trustedAuthorStatus`: a trusted author, a file list
that is not truncated, no path under `.github/` or `.mergify/` and no
`.mergify.yml`, a rename counting both names). Green, it adds `queue:shadow`
beside `ready-to-land` and the queue lands the PR. Otherwise it removes any
`queue:shadow` and names the owner as the merger: since the cut-over the
land-runner no longer runs, and such a PR is merged by hand. A repair goes to the queue too, a PR the runner failed included
(issue #5986). The command's last line names the merger. It also makes
sure GitHub links the PR as closing the issue its branch names (a bare
`Closes #N`, appended when `closingIssuesReferences` lacks it), so the issue
closes at merge whoever merges. The fallback, should the queue stall, is
[the cut-over's rollback](#the-cut-over).

Should [the rollback](#the-cut-over) bring the land-runner back, it never
touches a `queue:shadow` PR — not to land it, not to unlabel it once Mergify
merged it: its `gh pr list` excludes the label and
`planTick` skips any that slips through (`scripts/lib/land-runner.ts`,
pinned by `scripts/__tests__/land-runner.test.ts`). So a PR has exactly one
merger. What the land-runner does after a merge — closing the issue,
releasing the claim, seeding the preset scenario — it does not do for a
shadow PR: GitHub closes the issue through the closing ref `land:ready`
ensured, and [`post-merge`](#post-merge) does the rest for every merge,
whoever merged (`housekeeping` releases the claim, `seed` seeds the preset
scenario).

The [structure guard](#the-structure-guard) pins the entry, merge,
parallel-check, batch and dequeue rows (`queue-entry`, `queue-merge`,
`queue-shape`, `queue-dequeue`); auto-queue, the merge method,
`dequeued_label` and `status_comments` are not pinned.
A PR touching `.mergify.yml` never enters the queue itself — the owner
merges it by hand, as for `.github/` (ADR 0156 §8.4).

### The cut-over

Issue #5643, after 26 shadow merges (the shadow log is in that issue). Three
acts, in this order:

1. **The config.** `.mergify.yml` drops `queue:shadow` from the auto-queue,
   the entry and the refusal rule, and gains
   `-check-failure=check:lane (advisory)`; [`pr-check`](#pr-check)'s lane
   skips the queue's drafts. The PR touches both files, so the owner merges
   it by hand.
2. **The land-runner retired.** On the MacBook:
   `launchctl bootout gui/$(id -u)/com.tolaria.land-runner`. `land` and the
   runner's code stay in the tree two weeks as the fallback.
3. **The ruleset on the base branch** (`staging: merges through the queue`):
   no deletion, no force-push, a pull request required (no review, squash
   only), the [`trusted-author`](#g-trusted-author) status required. Bypass:
   the repository admin role — the owner, for `gaps:sync`, `release` and the
   hand merges of `.github/` PRs. `Mergify Merge Queue` is not required: it
   turns green only after Mergify's merge. A direct push from any other
   identity is refused.

**Rollback**, should the queue stall: revert the config PR, then
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tolaria.land-runner.plist`
— the runner lands every `ready-to-land` PR without `queue:shadow` again.

## A pass inside a job

An `afk-pass` job (workflow: issue #5650; dispatcher: issue #5649) runs
`claude -p "/next-ticket N"` on a [`pass`](#g-pass) runner. The skill is the
same file an attended terminal reads; it detects the job by
`GITHUB_ACTIONS=true` and then reads `.claude/skills/next-ticket/job.md`,
which lists the only five differences:

| Step     | In a job                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Pick     | None. The dispatcher picked N and put it in the prompt; the pass never runs `queue:plan`.                                             |
| Model    | None. The dispatcher launched the session on the issue's `model:*` tier.                                                              |
| Claim    | None. The `in-progress` label is the claim, set by the dispatcher; the pass reads it back and never sets it (no `queue:claim`).       |
| Worktree | The [job worktree](#g-job-worktree), a detached HEAD at the base tip. The pass cuts `feat/issue-N` (or `fix/`) and pushes it at once. |
| Hand-off | `bun run land:ready <PR#>` while the landing stack stands; after it is deleted, `gh pr edit <PR#> --add-label ready-to-land`.         |

**A pass's life**, in order:

1. the dispatcher labels the issue `in-progress` and dispatches `afk-pass`;
2. the job cuts its [job worktree](#g-job-worktree) and runs the
   [job setup](#g-job-setup);
3. the pass reads the issue, then `git switch -c feat/issue-N` and
   `git push -u origin HEAD`;
4. it implements, and **pushes after every commit** — the job has a
   `timeout-minutes` and its disk dies with it, so an unpushed commit is a
   lost one; a killed job is resumed from the pushed branch (a claim with no
   live `afk-pass` run is re-dispatched, and the skill's `--resume` path
   fetches the branch);
5. one review round, then it opens the PR and labels it `ready-to-land`;
6. it exits. The job's last step removes the worktree; the claim stands
   (`land:ready` moves it to `pr-open`) until the merge releases it. Only an
   abort has the pass remove the label itself.

**A repair pick** is the same issue re-fired by the `land-failed` label. The
failing run's log is on GitHub: the pass finds the failing check with
`gh pr checks <PR#> --json name,state,link` and reads it with
`gh run view <run-id> --log-failed` (to a file, then `grep`; see
[Public logs](#public-logs)).

**An abort** releases the claim with
`gh issue edit N --remove-label in-progress --remove-assignee @me` — label and
assignee together — after wiring the prerequisite or handing owner work back
as `ready-for-human` (`abort.md`). `queue:release` writes a journal row the
job flow does not read.

### The session rule: no push to the base

`.claude/hooks/deny-guard.sh` § 2b denies a Bash `git push` that names the
base or release branch (`tolaria.config.json` → `branches`) as source or
destination — `origin main`, `HEAD:main`, `feat:main`, `+main`, `--all`,
`--mirror` — and a push with no refspec from a checkout that has one of them
checked out. A session's work reaches the base through a PR and the merge
queue, never through a push. `gaps:sync`, `release` and the queue push from
inside a `bun` process or Mergify, which the hook never sees, so they need
nothing. Moving a branch by hand on purpose says so in the command:

```bash
TOLARIA_ALLOW_BASE_PUSH=1 git push origin <ref>
```

The rule is pinned by `scripts/__tests__/hook-policy.test.ts` (§ 2b).
Force-pushing the base stays denied by § 2 whatever the hatch says.

## The structure guard

`scripts/__tests__/workflow-structure.test.ts` runs the pure check in
`scripts/ci/workflow-structure.ts` over `.github/workflows/*`,
`.github/actions/*/action.yml` and `.mergify.yml` (when present). It runs in
the lane of any diff under `scripts/` and costs ~0.1 s of tests (≤ 10 s ⇒ the
lane, issue #4963). Each line it prints names a rule:

| Rule                           | Fails when                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outsider-reaches-self-hosted` | a self-hosted job sits in a workflow an outsider can trigger — anything but `schedule`, `workflow_dispatch`, `push` with a `branches:` filter Dependabot's branches cannot match, and `issues` limited to `labeled`/`unlabeled`                                                                                                               |
| `pr-target-head-checkout`      | a `pull_request_target` job checks out anything but the base (`ref:` / `repository:` set) or fetches the PR head                                                                                                                                                                                                                              |
| `unpinned-uses`                | a `uses:` is not pinned to a full commit SHA (local `./` excepted; `docker://` refused)                                                                                                                                                                                                                                                       |
| `reusable-call`                | a job calls a reusable workflow (the guard cannot see the callee's runner)                                                                                                                                                                                                                                                                    |
| `local-action-unscanned`       | a `uses: ./…` is not a `.github/actions/<name>/action.y[a]ml` the guard reads                                                                                                                                                                                                                                                                 |
| `no-timeout`                   | a job has no positive `timeout-minutes`                                                                                                                                                                                                                                                                                                       |
| `no-toolchain`                 | a `run:` step comes before `uses: ./.github/actions/job-setup`                                                                                                                                                                                                                                                                                |
| `concurrency-group`            | a self-hosted job, or a workflow holding one, declares `concurrency` — except the job-level group of a job `dispatcher-serialised` or `queue-superseded` requires                                                                                                                                                                             |
| `queue-superseded`             | `queue-lane.yml`'s `queue-lane` (`SUPERSEDED_JOBS`) lacks exactly the job-level `concurrency: { group: SUPERSEDED_GROUP, cancel-in-progress: true }` — a superseded draft's run holds a `lane` runner the live draft waits for (issue #6020)                                                                                                  |
| `dispatcher-serialised`        | a job of `afk-dispatch.yml` or `health-fix.yml`, or `post-merge.yml`'s `housekeeping` / `nightly` (`SERIALISED_JOBS`), lacks a job-level `concurrency: { group, cancel-in-progress: false }` — two runs at once could claim one issue twice, spawn two fixers, or move one watermark twice                                                    |
| `host-pinned`                  | a self-hosted job's `runs-on` names one machine by a literal `host:<name>` (issue #5873) — that machine offline holds the job for 24 h; a per-machine duty is a matrix (`host:${{ matrix.host }}`) or an input, a shared duty names no host                                                                                                   |
| `self-hosted-clone`            | a self-hosted job uses `actions/checkout`                                                                                                                                                                                                                                                                                                     |
| `job-worktree`                 | a self-hosted job does not create the [job worktree](#g-job-worktree) first and remove it last `if: always()`, both under `shell: bash`                                                                                                                                                                                                       |
| `claude-raw-output`            | a `run:` line calls `claude` (or `claude-code`) and is not one `scripts/ci/run-quiet.sh` call; a `claude-code` action is refused as `unpinned-uses`                                                                                                                                                                                           |
| `job-setup-contract`           | the [job setup](#g-job-setup) lost its token mask, `setup-node.sh`, `setup-bun.sh` or `worktree:init`, or nests an action                                                                                                                                                                                                                     |
| `corpus-exclusion-gating`      | `TOLARIA_HOSTED_NO_VERDICT_CORPUS` (the hosted lane's corpus exclusion) appears in a workflow holding a self-hosted job, or in a shared action                                                                                                                                                                                                |
| `queue-entry`                  | a `.mergify.yml` queue rule's `queue_conditions` lack `label=ready-to-land`, `-label=land-failed`, `-check-failure=check:lane (advisory)`, `trusted-author` and `base-health` green, `-files~=^\.github/` or `-files=.mergify.yml`; still require `label=queue:shadow`; or the job posting `check:lane (advisory)` runs on the queue's drafts |
| `queue-merge`                  | a queue rule's `merge_conditions` are anything but `check-success=queue-lane` alone                                                                                                                                                                                                                                                           |
| `queue-shape`                  | `merge_queue.max_parallel_checks` is not 2, or a queue rule's `batch_size` is not 1                                                                                                                                                                                                                                                           |
| `queue-dequeue`                | no `pull_request_rules` entry turns a `checks-failed`/`checks-timeout` dequeue into `land-failed` (removing `ready-to-land`) with a comment carrying a link                                                                                                                                                                                   |

Every rule fails closed: only ONE spelled-out hosted image (`ubuntu-24.04`,
`macos-15`, …) counts as GitHub-hosted. Anything else — an expression, a
group, a list, and `Linux`, `macOS`, `X64`, `ARM64`, which every self-hosted
runner also carries and GitHub matches case-insensitively — is self-hosted.
`CENSUS_TESTS` (`scripts/lib/census-tests.ts`) admits `.github/`,
`.mergify.yml` and `scripts/ci/`, so a diff touching only a workflow file
still runs the guard in its lane.

## Repository settings checklist (ADR 0156 §8)

The repository is public: these settings, not the workflow files, are what
keep an outsider's code off the [runners](#g-runner). Set once, by the owner,
in the repository's Settings; a slice that needs a new one adds its row here.

- [ ] **Actions → General → Fork pull request workflows from outside
      collaborators: "Require approval for all external contributors".** The
      barrier that matters: a fork PR can rewrite any check in its own workflow
      files.
- [ ] **Actions → General → Workflow permissions: "Read repository contents
      and packages permissions"** (read-only default `GITHUB_TOKEN`); a job
      that writes asks for its permission explicitly.
- [ ] **Actions → Variables → Repository variable
      [`TRUSTED_AUTHORS`](#g-trusted-authors)**, seeded with the owner's login
      (who also authors the loop's PRs). Admin-only, out of any PR's reach.
- [ ] **Actions → Variables → `AFK_TOKEN_BUDGET`** (and, optionally,
      `AFK_BUDGET_MAX_PCT`, `AFK_BUDGET_HOURS`) before the
      [dispatcher](#g-dispatcher) is meant to start passes
      ([§ afk-dispatch](#afk-dispatch)); unset, it holds.
- [ ] **No secret in a PR job.** Claude's and `gh`'s credentials stay on the
      machines, in the owner's user; a workflow never reads them from GitHub
      secrets.
- [ ] **Actions → Runners** lists every [runner](#g-runner) of both machines
      online, with its [labels](#g-label) (`bun run runner status` prints the
      same).

- [ ] **Actions → General → Allow actions: GitHub-owned + the pinned
      third-party ones the workflows name.** Today the workflows use only
      GitHub-owned `actions/checkout` and `actions/upload-artifact`
      ([`afk-pass`](#afk-pass)'s record); node and bun are installed by
      script precisely so the allow-list needs no entry.
- [ ] **Both machines' runners re-installed after issue #5636**
      (`bun run runner install`), so their units export
      `TOLARIA_PRIMARY_CHECKOUT`.

`pr-check` stays advisory: no ruleset requires it. `pr-gate` needs nothing
beyond `TRUSTED_AUTHORS`: its token asks for `statuses: write` itself. Later
slices add: the queue's required checks and entry conditions (Phase 1).

## Where the flow fails

Review of 12–18 October 2026: 151 merged PRs, 52 of them (34 %) with at least
one `land-failed`. The 113 failure comments are 77 **episodes**, an episode
being one PR head failing for one reason, however many attempts it took. Every
fix below **removes a duplicate authority or feeds a mechanism that already
exists**; none adds a system. Read this before adding a check.

### The flow, one owner per step

1. The session implements and runs targeted tests. It hands off with
   `ready-to-land` and never merges.
2. [`pr-check`](#pr-check) runs the full lane on the merge ref at PR open.
3. The queue admits the PR only when its entry statuses
   ([`trusted-author`](#g-trusted-author), [`base-health`](#g-base-health))
   are green.
4. [`queue-lane`](#queue-lane) runs the lane on the rebased draft, with one
   flaky re-run.
5. [`pr-fixup`](#pr-fixup) regenerates a stale generated artefact instead of
   failing the PR.
6. [`post-merge`](#post-merge) does what a merge obliges on each machine.
7. [`health`](#health) gates the base tip, and the
   [RED ladder](#g-red-ladder) handles a RED.

Since [the cut-over](#the-cut-over) (issue #5643) every step is a job; the
land-runner, which did steps 3–5 for the PRs outside [shadow](#g-shadow), is
retired.

### Failure classes

| Class                             | Episodes | Should be caught by                       | The gap                                                                                                                                     | Fix                                                                                                             |
| --------------------------------- | -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Rebase conflict                   | 21       | the picker's `## Target files` overlap    | append-only lists (blade registry, grammar fixtures, round-trip pins) and this guide, which every slice edits                               | issue #5942 (owner's pick, no new driver)                                                                       |
| The PR's own defect               | ~15      | the session's targeted runs, then step 2  | the land-runner lands a PR whose `pr-check` is already red                                                                                  | closed: `-check-failure=check:lane (advisory)` in `queue_conditions` (issue #5643)                              |
| Tree moved under the lane         | 8        | —                                         | the guard compared the stash list, shared by every worktree: another session's lint-staged commit reds the lane                             | issue #5993: only HEAD and status count as a move                                                               |
| Load-sensitive tooling test       | ~7       | —                                         | tests asserting on wall-clock time or machine load                                                                                          | issue #5874; the loop driver and gate mutex tests go with issue #5656                                           |
| Defect inherited from the base    | ~6       | the culprit's own lane                    | a whole-tree guard the culprit's lane never runs: the blade-index drift test (`bot-node`), a CR ledger stale entry its merge driver revives | issue #5940 (an admitted cheap guard, 1.9 s, which also makes `pr-fixup`'s `blade-index` row live); issue #5677 |
| RED base written as `land-failed` | 5        | the land-runner's hold                    | the land-runner process ran 3-day-old code                                                                                                  | restarted on 2026-10-18; issue #5941 makes it restart itself                                                    |
| Environment                       | ~3       | the [job setup](#g-job-setup)'s toolchain | `node` missing from a service's `PATH`                                                                                                      | closed (the pinned toolchain)                                                                                   |

Two defects distort the numbers above rather than add to them:

- **Double attempt.** 34 of the 77 episodes ran twice. The land-runner's
  queue read goes through GitHub's search index, which still lists a PR it has
  just relabelled. Its notification then calls one PR "same cause on 2 PRs —
  likely infra". Fix: issue #5941.
- **False RED from load.** On 2026-10-18 health went RED at `8442d0b4` on
  timeouts alone. `duplicate-test-blocks` took 146 s on the Huawei against
  15 s on a calm MacBook. Health reads the machine only at a step's start and
  end, so the load during the 21-minute `test` step was never seen and the run
  was not classified [INFRA](#g-infra). It was the lineage's second RED: the
  line stopped, and the bisect, run under the same load, blamed a PR already
  reverted. Fix: issue #5939, which samples on the liveness ticks and
  names why a retry was refused.

A hold is no failure, but one stranded a PR. On 2026-10-18 PR #5854 sat
14 h with no merger: the RED reddened `base-health` on its queue draft,
Mergify dequeued it, and no GREEN requeued it (`@mergifyio requeue` did).
Fix: issue #5978.

The [shadow](#g-shadow) comparison that decides the cut-over (issue #5643)
counts episodes, not attempts, and leaves out holds.

### The machines

Each machine runs one [`lane`](#g-lane) and two [`pass`](#g-pass) runners; the
MacBook also runs [`seed`](#g-seed); the land-runner is retired (issue #5643).
A health run therefore shares its machine with up to two passes. ADR 0156
accepted a fixed runner count in place of RAM-aware admission; the answer to a
load-induced timeout is to classify it [INFRA](#g-infra) (excused once, then
the tree's), not to bring admission back. Working on the MacBook while the
queue runs: [pause](#pause-and-resume) its runners.

A long-lived process that runs repository code (the land-runner was the only
one) must restart when that code changes. Jobs need nothing: each one runs the code
of its own sha.

### The rule for the next gap

1. Name the class and the step that should have caught it.
2. Close it with the cheapest of: delete a duplicate authority; add a row to a
   table that already exists (`CHEAP_GUARDS`, `FIXES`, `queue_conditions`,
   `REGENERATED_ARTIFACTS`); feed an existing classification. Only then a new
   check, stating its measured cost (≤ 10 s goes in the lane,
   `docs/agents/quality-gates.md`).
3. Count episodes, not attempts, and a hold is never a failure.

## Troubleshooting

| Symptom                                             | Look at                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (rollback only) the land-runner acts on stale rules | its process predates the change: it exits 75 between ticks when its sources change (issue #5941); if not, `launchctl kickstart -k gui/$(id -u)/com.tolaria.land-runner`               |
| `could not get a registration token`                | the `gh` login is not the repository's admin: `gh auth status`                                                                                                                        |
| `node not resolvable on the rendered PATH`          | run `install` from a shell where `command -v node` resolves                                                                                                                           |
| a [runner](#g-runner) offline on GitHub             | `bun run runner status`; `paused` = expected; `STOPPED` = its log (MacBook) or `journalctl` (Huawei)                                                                                  |
| the [Convex agent](#g-convex-agent) restarts        | `~/.cache/tolaria/convex/agent.log` — usually a second `convex dev` holding the port                                                                                                  |
| `TOLARIA_PRIMARY_CHECKOUT is unset`                 | the runner predates issue #5636: `bun run runner install` on that machine                                                                                                             |
| `deny-guard` blocks a `git push` of a session       | the push names the base/release branch, or is a bare push from a checkout on it: push the feature branch, or use `TOLARIA_ALLOW_BASE_PUSH=1` on purpose                               |
| `refusing workspace …`                              | `job-worktree.sh` ran outside a runner's `_work/<repo>/<repo>` directory — never point it at a checkout by hand                                                                       |
| a `sync` leg red: `could not fast-forward …`        | that machine's primary checkout diverged by the owner's own commits (the notice names them); `gaps:sync` strandings heal themselves. Pull it by hand                                  |
| `housekeeping` red: `shared state … moved`          | two runs raced (a hand run beside the job — the group keeps jobs apart): the loser dropped its watermark; the next hourly run re-reads. `git ls-remote origin 'refs/tolaria/state/*'` |
| `pr-check` red, the lane green locally              | the receipt in the run's log; a dirty-tree refusal there = `worktree:init` changed a tracked file (e.g. `bun.lock`)                                                                   |
| `trusted-author` red on the owner's PR              | it touches `.github/` or `.mergify.yml`: the owner merges it by hand; otherwise `TRUSTED_AUTHORS` is unset or misspelt                                                                |
| a shadow PR sits unqueued, its gates green          | Mergify dropped it when a queue condition failed on its draft or its own head: `@mergifyio requeue` ([the merge queue](#the-merge-queue))                                             |
| `base-health` red with the base green               | the re-gate did not run: Actions → pr-gate → Run workflow (or `--pr <N>`)                                                                                                             |
| `health` red, `health:status` names a flake         | the ladder could not write the GREEN (store unreachable): re-run the job, or `bun run health:bisect ladder --sha <sha>`                                                               |
| an early RED, no `ladder` run                       | `health.yml` is not on the default branch yet (a dispatch needs it there): run the ladder by hand                                                                                     |
| `health` INFRA `deployment-skew`                    | the primary checkout serves `convex dev`: off base, dirty or behind. Switch it to base, ff it, wait for the push, re-run (issues #6132, #6133)                                        |
| jobs fail when the MacBook lid closes               | [`caffeinate`](#g-caffeinate) cannot stop a clamshell sleep on battery: keep it on power, or [pause](#g-pause) before closing                                                         |

## Glossary

### <a id="g-runner"></a>Runner

A self-hosted GitHub Actions runner: GitHub's agent process on one of the
owner's machines that takes jobs whose `runs-on` labels it carries. One
directory, one registration, one service each.

### <a id="g-label"></a>Label

A tag a [runner](#g-runner) registers with; a job's `runs-on` names the
labels it needs and goes to the first free runner carrying all of them.
Tolaria's role labels are [`pass`](#g-pass), [`lane`](#g-lane),
[`seed`](#g-seed), plus `host:<name>`.

### <a id="g-pass"></a>`pass`

The [label](#g-label) of a [runner](#g-runner) that runs one Claude Code
session per job. Their count is the machine's concurrency cap.

### <a id="g-lane"></a>`lane`

The [label](#g-label) of a [runner](#g-runner) for verification work: queue
checks, batch health, release.

### <a id="g-seed"></a>`seed`

The [label](#g-label) of the [runner](#g-runner) on the machine holding the
owner's Convex deployment (the MacBook): scenario seeding runs there.

### <a id="g-pause"></a>Pause

Stopping a machine's [runners](#g-runner) without unregistering them: a
`.paused` mark plus a disabled [user service](#g-user-service), undone by
`resume`.

### <a id="g-user-service"></a>User service

A service run by the owner's own service manager, not root's: a launchd
agent in `~/Library/LaunchAgents/` on macOS, a `systemctl --user` unit on
Linux.

### <a id="g-convex-agent"></a>Convex agent

`com.tolaria.convex`, the MacBook's `convex dev --local` as a launchd
[user service](#g-user-service), so the deployment outlives any job.

### <a id="g-caffeinate"></a>`caffeinate`

macOS's keep-awake wrapper; `-i -s` prevents idle and system sleep while the
wrapped [runner](#g-runner) lives (system sleep only on AC power).

### <a id="g-linger"></a>Linger

systemd-logind's per-user switch that starts a user's services at boot and
keeps them after logout — what lets the Huawei's [runners](#g-runner) run
with nobody logged in.

### <a id="g-declaration"></a>Machine declaration

`~/.local/share/tolaria/actions-runner/machine.json`: the host name and
per-[label](#g-label) counts the last `install` used, so a re-run without
flags declares the same [runners](#g-runner).

### <a id="g-primary-checkout"></a>Primary checkout

The clone that owns `.git/` (not a worktree): where the Convex deployment
state and the units' working directory live.

### <a id="g-job-worktree"></a>Job worktree

The git worktree of a machine's [primary checkout](#g-primary-checkout) that
a self-hosted job works in, cut at the job's `$GITHUB_WORKSPACE` by
`scripts/ci/job-worktree.sh create` and removed by its `remove`. Never a
clone: `primaryCheckout()` resolves from it as from any worktree.

### <a id="g-job-setup"></a>Job setup

`.github/actions/job-setup`: the composite action every job runs before its
first `run:` step — token mask, pinned node and bun, `worktree:init`.

### <a id="g-structure-guard"></a>Structure guard

`scripts/__tests__/workflow-structure.test.ts`: the test that fails when a
workflow file, the job setup or `.mergify.yml` breaks a security or
correctness invariant ([§ The structure guard](#the-structure-guard)).

### <a id="g-dispatcher"></a>Dispatcher

`afk-dispatch.yml`: the one workflow that starts AFK [passes](#g-pass) —
picks, claims, dispatches, or holds; one run at a time
([§ afk-dispatch](#afk-dispatch)).

### <a id="g-hold"></a>Hold

A reason the [dispatcher](#g-dispatcher) starts no pass this time (RED,
usage limit, budget, failure streak, no pass workflow, no free runner). A
hold is a run that exits 0 with "nothing to do", never a waiting process.

### <a id="g-budget-reading"></a>Budget reading

This machine's token use over the window (`usage:window`'s weighted local
transcripts — the owner's sessions and this machine's passes) plus the other
machine's pass records that ended in it. The owner's sessions on the OTHER
machine are not in it: set the budget with that headroom.

### <a id="g-shadow"></a>Shadow

Phase 1 of the queue (ADR 0156 § Migration), ended by [the
cut-over](#the-cut-over) (issue #5643): Mergify landed only the PRs labelled
`queue:shadow` (since issue #5952, every PR `land:ready` hands off whose
`trusted-author` verdict is green) and the land-runner the rest, so the two
ran side by side on real PRs. The label survives as `pr-refresh`'s marker.

### <a id="g-trusted-authors"></a>`TRUSTED_AUTHORS`

The admin-only Actions repository variable listing the accounts whose PRs
and issues the pipeline acts on; everyone else waits for the owner.

### <a id="g-trusted-author"></a>`trusted-author`

The commit status [`pr-gate`](#pr-gate) posts: green for a PR by a
[trusted author](#g-trusted-authors) that leaves `.github/` and
`.mergify.yml` alone, or for a Mergify queue PR.

### <a id="g-base-health"></a>`base-health`

The commit status [`pr-gate`](#pr-gate) posts: green unless a RED stands on
the base branch's health lineage and the PR closes none of that RED's
declared repair issues; always green for a Mergify queue PR.

### <a id="g-infra"></a>INFRA

A health verdict the tree is not responsible for — the machine slept, was
saturated, or the deployment was down (`scripts/lib/health-verdict.ts`). It
proves nothing, so it never replaces a GREEN or a RED on the store, and the
next run re-gates the tip.

### <a id="g-early-run"></a>Early run

`health-main --early` on a GitHub-hosted runner after a merge batch
([`health-early`](#health)): the offline gate minus the committed-corpus
tests. Only its RED reaches the store.

### <a id="g-red-ladder"></a>RED ladder

What a RED goes through before it reaches the owner (PRD #5620 story 57):
the [flake check](#g-flake-check), the [bisect](#g-bisect), at most two
fixer attempts, the revert of the culprit, then one email and one
`ready-for-human` issue. `scripts/health-bisect.ts` is its first two rungs,
[`health-fix`](#health-fix) the rest.

### <a id="g-flake-check"></a>Flake check

The ladder's first rung: the RED's failing files re-run fresh at the same
sha. Not reproduced, the RED closes as GREEN and the flaky test is filed.

### <a id="g-bisect"></a>Bisect

The ladder's second rung: a binary search of the base's commits after the
last GREEN on the RED's failing files; the first red commit's PR is the
culprit, named in the RED's evidence.

### <a id="g-shared-state"></a>Shared state

Pipeline state every runner reads and writes (issue #5873): one git ref per
duty on origin, `refs/tolaria/state/<key>` (`housekeeping`, `nightly`), each
a parentless commit holding that key's `<key>.json`. Read with `ls-remote` +
`cat-file`, written with `push --force-with-lease` — the compare-and-swap
that keeps two machines from moving one watermark twice; one ref per key so
the keys never spoil each other's lease. Distinct from the verdict store (a
commit status, keyed by sha).
