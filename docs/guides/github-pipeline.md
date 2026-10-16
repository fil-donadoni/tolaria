# GitHub pipeline — runners, labels, pause/resume, repository settings

ADR 0156 (and its Amendment I) moves everything after the PR — verification
scheduling, the merge queue, post-merge jobs, health, release — onto GitHub
Actions and Mergify. Every job runs on a [self-hosted runner](#g-runner) on
one of the owner's two machines. This guide is the operating manual of that
stack; **every slice of PRD #5620 updates it in the same PR**. Version 1
(issue #5634) covered the [runners](#g-runner): install,
[labels](#g-label), [pause](#g-pause) / resume, and the repository settings
checklist. Version 2 (issue #5636) adds the [jobs](#jobs): the
[job setup](#g-job-setup) every workflow copies, the
[structure guard](#g-structure-guard) over the workflow files, and the first
two workflows — the advisory [`pr-check`](#pr-check) and
[`lane-timing`](#lane-timing). Version 3 (issue #5639) ports the refusals
`land` applies into the [required checks](#required-checks). Version 4 (issue #5638) adds
[`pr-refresh`](#pr-refresh), which keeps the queued PRs rebased.

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
  issue #5598) and a `TOLARIA_OWNER=unit:…` tag that keeps the reaper off the
  job trees.

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
with `cancel-in-progress` to drop a superseded run (`pr-check` does). The one
self-hosted exception is the [dispatcher](#g-dispatcher), which MUST run one
at a time ([§ afk-dispatch](#afk-dispatch)).

## Workflows

| Workflow                                  | Trigger                                              | Runner                                | What it proves                                                    |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| [`pr-check`](#pr-check)                   | `pull_request` (open, push)                          | GitHub-hosted `ubuntu-24.04`          | the PR's full `check:lane`, on the merge ref — advisory           |
| [`pr-check`](#required-checks) `refusals` | same                                                 | same                                  | one job per `land` refusal (five), `scripts/pr-checks.ts`         |
| [`lane-timing`](#lane-timing)             | dispatch (`host`), push of a `lane-timing/**` branch | `[self-hosted, lane, host:<machine>]` | the same lane on an owner's machine, to compare timings (phase 0) |
| [`pr-refresh`](#pr-refresh)               | push to the base branch                              | `[self-hosted, lane]`                 | rebases the queued PRs the push conflicts with or touches         |
| [`afk-dispatch`](#afk-dispatch)           | `ready-for-agent` label, every 30 min, dispatch      | `[self-hosted, pass]`, one at a time  | picks, claims and dispatches AFK passes, or holds                 |

### pr-check

`.github/workflows/pr-check.yml`: on every PR open and push, the full
`check:lane` on a free GitHub-hosted runner, on the merge ref (the PR merged
into the current base — what would land). **Advisory**: no ruleset requires
it, and `land` still pays the lane that gates the merge (ADR 0136); a red
`pr-check` is a defect found before the queue. A fork's PR runs it only after
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

`repair-proof` reads the health lineage through `verdictStore` (the `github`
backend needs only the job's `GH_TOKEN`). It passes with a printed `NOTE`
when the store cannot be read, or when every failing test the verdict names
was moved or deleted by the repair — it cannot decide, and `land` stays the
authority until the migration retires it. It reads commit statuses, so the workflow token carries `statuses: read`. A `land --repair` PR with no ledger issue gets no proof here (the flag is `land`'s), and the check never reproduces the RED refusal of a non-repair PR: both stay `land`'s. A PR that is not a declared repair
(closing none of the ledger's `/health-fix` issues) owes nothing to it.

Like `lane`, the checks are advisory until a ruleset names them; once it does,
this section is the list of required status contexts: `refusals (ui-receipt)`,
`refusals (scenario)`, `refusals (retired-rows)`,
`refusals (robustness-baseline)`, `refusals (repair-proof)`.

### pr-refresh

`.github/workflows/pr-refresh.yml`: GitHub and Mergify do not run our merge
drivers, and 37 % of PRs touch a driven file, so a queued PR conflicts on a
generated artefact the moment the base moves. On every push to the base, a
[`lane`](#g-lane) runner runs `bun run pr-refresh -- --before <old tip> --after <new tip>`
(`scripts/pr-refresh.ts`). It lists the open `ready-to-land` PRs of this
repository (never a fork) and refreshes each one that GitHub reports
`CONFLICTING`, or whose files the push touched (`git diff --name-only
<before> <after>`). Per PR:

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
| `no-pass-workflow` | `afk-pass.yml` is absent or disabled on the default branch (until issue #5650 lands, the dispatcher is inert)                          | `afk-pass.yml` is on the default branch and enabled                             |
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

## The structure guard

`scripts/__tests__/workflow-structure.test.ts` runs the pure check in
`scripts/ci/workflow-structure.ts` over `.github/workflows/*`,
`.github/actions/*/action.yml` and `.mergify.yml` (when present). It runs in
the lane of any diff under `scripts/` and costs ~0.1 s of tests (≤ 10 s ⇒ the
lane, issue #4963). Each line it prints names a rule:

| Rule                           | Fails when                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outsider-reaches-self-hosted` | a self-hosted job sits in a workflow an outsider can trigger — anything but `schedule`, `workflow_dispatch`, `push` with a `branches:` filter Dependabot's branches cannot match, and `issues` limited to `labeled`/`unlabeled` |
| `pr-target-head-checkout`      | a `pull_request_target` job checks out anything but the base (`ref:` / `repository:` set) or fetches the PR head                                                                                                                |
| `unpinned-uses`                | a `uses:` is not pinned to a full commit SHA (local `./` excepted; `docker://` refused)                                                                                                                                         |
| `reusable-call`                | a job calls a reusable workflow (the guard cannot see the callee's runner)                                                                                                                                                      |
| `local-action-unscanned`       | a `uses: ./…` is not a `.github/actions/<name>/action.y[a]ml` the guard reads                                                                                                                                                   |
| `no-timeout`                   | a job has no positive `timeout-minutes`                                                                                                                                                                                         |
| `no-toolchain`                 | a `run:` step comes before `uses: ./.github/actions/job-setup`                                                                                                                                                                  |
| `concurrency-group`            | a self-hosted job, or a workflow holding one, declares `concurrency` — except the dispatcher's job-level group below                                                                                                            |
| `dispatcher-serialised`        | a job of `afk-dispatch.yml` lacks a job-level `concurrency: { group, cancel-in-progress: false }` — two runs at once could claim one issue twice                                                                                |
| `self-hosted-clone`            | a self-hosted job uses `actions/checkout`                                                                                                                                                                                       |
| `job-worktree`                 | a self-hosted job does not create the [job worktree](#g-job-worktree) first and remove it last `if: always()`, both under `shell: bash`                                                                                         |
| `claude-raw-output`            | a `run:` line calls `claude` (or `claude-code`) and is not one `scripts/ci/run-quiet.sh` call; a `claude-code` action is refused as `unpinned-uses`                                                                             |
| `job-setup-contract`           | the [job setup](#g-job-setup) lost its token mask, `setup-node.sh`, `setup-bun.sh` or `worktree:init`, or nests an action                                                                                                       |
| `corpus-exclusion-gating`      | `TOLARIA_HOSTED_NO_VERDICT_CORPUS` (the hosted lane's corpus exclusion) appears in a workflow holding a self-hosted job, or in a shared action                                                                                  |
| `queue-entry`                  | a `.mergify.yml` queue rule's `queue_conditions` lack `label=ready-to-land`, `trusted-author` and `base-health` green, `-files~=^\.github/` or `-files=.mergify.yml` (Phase 1)                                                  |

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
      GitHub-owned `actions/checkout`; node and bun are installed by script
      precisely so the allow-list needs no entry.
- [ ] **Both machines' runners re-installed after issue #5636**
      (`bun run runner install`), so their units export
      `TOLARIA_PRIMARY_CHECKOUT`.

`pr-check` stays advisory: no ruleset requires it. Later slices add: the
queue's required checks and entry conditions, the `.github/` /
`.mergify.yml` exclusion (Phase 1).

## Troubleshooting

| Symptom                                      | Look at                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `could not get a registration token`         | the `gh` login is not the repository's admin: `gh auth status`                                                                |
| `node not resolvable on the rendered PATH`   | run `install` from a shell where `command -v node` resolves                                                                   |
| a [runner](#g-runner) offline on GitHub      | `bun run runner status`; `paused` = expected; `STOPPED` = its log (MacBook) or `journalctl` (Huawei)                          |
| the [Convex agent](#g-convex-agent) restarts | `~/.cache/tolaria/convex/agent.log` — usually a second `convex dev` holding the port                                          |
| `TOLARIA_PRIMARY_CHECKOUT is unset`          | the runner predates issue #5636: `bun run runner install` on that machine                                                     |
| `refusing workspace …`                       | `job-worktree.sh` ran outside a runner's `_work/<repo>/<repo>` directory — never point it at a checkout by hand               |
| `pr-check` red, the lane green locally       | the receipt in the run's log; a dirty-tree refusal there = `worktree:init` changed a tracked file (e.g. `bun.lock`)           |
| jobs fail when the MacBook lid closes        | [`caffeinate`](#g-caffeinate) cannot stop a clamshell sleep on battery: keep it on power, or [pause](#g-pause) before closing |

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

### <a id="g-trusted-authors"></a>`TRUSTED_AUTHORS`

The admin-only Actions repository variable listing the accounts whose PRs
and issues the pipeline acts on; everyone else waits for the owner.
