# Adopt the GitHub-native pipeline for the AFK workflow: self-hosted Actions runners verify, a merge queue lands, scheduled workflows gate health and release; the home-built orchestration is retired and the whole shape becomes a template portable to any project

## Status

accepted — owner's decision of 2026-10-14 ("ok, repo personale con Mergify.
accetta l'ADR e apri il PRD"), written at the owner's request as the LAST
iteration of the workflow discussion ("arrivare a una soluzione che mi
permetta di concentrarmi sul prodotto"). The repository stays **personal and
public**; the queue is **Mergify on its Open Source plan**; **Docker is ruled
out**. Supersedes ADR 0154 §9 (topology B': fixed machine roles, the shared
verdict store, `landRunner.platform` / `healthRunner.platform`) and the
crons of ADR 0154 §5–6, which become workflows (§4). Supersedes the grill of
the same day (PRD A "loop never stops", PRD B "cockpit"): every decision
reached there — Hold, mail via Resend, the driver as a service, an always-on
dashboard, a Tailscale heartbeat — dissolves into GitHub's own scheduling,
notifications and runner status. Where this record and ADR
0110 / 0116 / 0136 / 0154 name a script, the script stays the authority on
what runs TODAY until the migration phase that retires it lands.

## Context

### The ask

AFK flows that create and resolve issues, verify by scripts rather than by
prose, release without a hand, and are observable — fast, reliable, and
**portable to other projects of other sizes and stacks**. Budget unchanged:
the $100/month Claude Code Max subscription; $200 only to multiply throughput
on an infrastructure that already works.

### The measured state, 2026-10-14

Every figure is re-derivable; the source is named beside it.

- **Throughput and share of workflow work.** Since 2026-08-01: 1,656 issues
  closed, 1,523 PRs merged (`gh api search/issues`). 357 of the closed issues
  — 22% — carry `area:workflow`, `area:infra` or `area:monitoring`. The open
  backlog is 599 issues, 441 of them `ready-for-agent`.
- **Size of the home-built workflow.** Scripts whose name says workflow
  (land, loop, queue, gate, health, telemetry, housekeeping, reaper, claim,
  machine, verdict, worktree, release, runner, admission, board, …): **~60k
  lines, plus ~53k lines of their tests** (`find scripts … | xargs wc -l`);
  the telemetry dashboard 17k; skills, hooks and rules 6.8k; `docs/agents` +
  `docs/guides` 8.8k; 132 `package.json` scripts; 155 ADRs, a large share
  about the workflow. The product — `convex/` + `src/` without tests and card
  sets — is 448k lines, the card sets 291k.
- **What that code re-implements.** A CI runner with concurrency control
  (`gate.ts`, `gate-run.sh`, `machine-admission.ts`), a merge queue
  (`land.ts`, `land-runner.ts`, the gate mutex), scheduled jobs (health
  cadence, `runner-units/`, the crons of ADR 0154 §5–6 — none of which is
  scheduled anywhere yet, issue #5592), commit statuses (the verdict store),
  notifications (`notify-owner.ts`), runner liveness (the heartbeat PRD B
  was about to add), dashboards (`dashboard/`), and job orchestration
  (`loop-drain.sh`, 1,600 lines of shell).
- **Reliability of the orchestration.** `loop-afk.log`, 2026-09-27 →
  10-14: the loop exited on its own 13 times for a RED base, 5 for "no
  eligible head", 7 for the session cap, and once each for a rate limit,
  three Claude crashes, and a dead Convex backend. On 2026-10-14 four PRs went
  `land-failed` inside ten minutes because the land-runner's launchd agent had
  no `node` on its `PATH` (issue #5598) — a defect class that a job declaring
  its own toolchain cannot have.
- **Where the time goes.** `bun run telemetry:latency`, 2026-10-08 → 10-14,
  133 `/next-ticket` sessions: wall median 24.9 min, p90 115 min; gate, test
  and build median **0.4 min**, p90 9.5 min; idle p90 31 min. The gate is
  not the bottleneck; the pass and its waiting are.

### Verified constraints, 2026-10-14

- **The repository is public and user-owned** (`gh repo view`:
  `private=false`, `org=false`). Consequences: GitHub Actions minutes are free
  on public repositories, with or without self-hosted runners; branch
  protection and rulesets are free; Mergify is free for open source.
- **GitHub's native merge queue is for organization-owned repositories**
  (any plan when public, Enterprise Cloud when private); a user-owned
  repository cannot have one on any plan. Reaching it means transferring the
  repository to a free organization — a move that keeps issues, PRs and
  redirects, and costs the user-level Project board (it must be recreated as
  an organization project) and every `fil-donadoni/tolaria` literal in
  scripts.
- **The self-hosted runner fee** ($0.002/min, announced December 2025 for
  March 2026) was postponed by GitHub with no new date; public repositories
  were never in its scope.
- **A Claude subscription in automation.** Claude Code's own GitHub Actions
  documentation supports a subscription token (`claude setup-token`, Pro and
  Max) for its action. The loop today runs `claude -p` on the owner's
  machines under the Max subscription; a self-hosted runner on the same
  machines runs the same binary with the same credentials. No change of
  footing.
- **What only our machines can run.** The local Convex backend, the browser
  walk (`check:ui`), the full suite in RAM, and the Claude subscription — so
  every job runs on **self-hosted runners**; GitHub-hosted runners are not in
  the design at all.

## Decision

**Adopt the GitHub-native pipeline. Keep home-built only what verifies
Tolaria.** The line is: a check script is ours (`check:lane`, `check:all`,
`cr:lint`, `check:ui`, the blade, the oracle gates); everything that
schedules, serialises, supervises, records or displays is GitHub's.

### 1. The producer stays Claude Code on our machines

One pass = one job, `afk-pass.yml`, triggered by `issues: labeled` with
`ready-for-agent` and by a 30-minute `schedule` sweep that picks the oldest
unclaimed one (the backlog is 441 deep). Steps: claim by label, a worktree off
the base branch, `claude -p "/next-ticket N"`, push, PR. Parallelism is **the
number of `pass` runners registered** — on BOTH machines, sized by the Max
subscription's usage limits (the two machines share one account) rather than
by RAM — not a cap computed per pick. The machines have no fixed roles (§7). A pass that cannot act (usage limit, RED base, nothing to pick) exits 0
with "nothing to do"; the next event or sweep fires again. This is the whole
of PRD A's Hold: **a job that skips, re-fired by the scheduler**, with nothing
long-running left to supervise but the runner service, whose liveness GitHub
shows as online/offline.

### 2. Verification is a required check

`pr-check.yml` on `pull_request`: `bun run check:lane` on the merge ref (the
PR merged into the current base — what would land), on a self-hosted runner,
with the toolchain **declared in the job** (`oven-sh/setup-bun`,
`actions/setup-node`). A ruleset makes it required. The lane stays exactly
what ADR 0154 §8 says a PR owes.

### 3. Landing is a merge queue

Mergify (`.mergify.yml`, Open Source plan) queues a PR when it carries
`ready-to-land` and `pr-check` is green: oldest first, rebase onto the tip,
re-check, merge, with **two parallel (speculative) checks**, one per machine.
The plan matrix on mergify.com/pricing, read 2026-10-14: the Open Source plan
(public repositories) includes Merge Queue, Parallel Checks, Stacked PRs and
PR Dependencies; it does NOT include Batch, PR Priorities, Pause, Two-Steps CI
or Job Auto-Retry (the private-repo Free plan, ≤ 5 users, includes them all).
A simulation fed by the measured lanes (142 lanes 2026-10-06 → 14: PASS mean
5.4 min, FAIL mean 3.6 min, 14.8 % red; 1 min of job overhead per check)
puts the ceiling at 7.4 merged PR/h for today's serial `land`, 8.3 for a
serial queue, **16.0 with two parallel checks** and 22.9 with three; at
10 PR/h arriving, two parallel checks hold the queue-to-merge wait at
9.6 min p50 / 17 min p90, where today's serial land grows without bound.
Batches add nothing at a 15 % red rate (a batch of 3 holds a bad PR 38 % of
the time and is split), so the repository stays public and the plan Open
Source. Without priorities a repair re-enters at the back of the queue. A PR the queue
rejects is labelled `land-failed` with the reason as a comment; that label
event re-fires `afk-pass` on its issue as the repair pick. The GitHub native
queue replaces Mergify the day the repository moves to an organization, if
it ever does; nothing above depends on which queue runs.

Two pieces of `land` have no Mergify equivalent and become workflows of our
own, reusing the code that exists:

- **`pr-refresh.yml` — a PR in conflict on generated files.** Mergify updates
  a PR through GitHub and drops it on a conflict; `land` today rebases and
  regenerates (`REGENERATED_ARTIFACTS`, `resolve-generated-artifacts`) —
  16 of the 311 recorded landings did. On every `push` to the base branch, on
  a `lane` runner, the workflow lists the `ready-to-land` PRs GitHub reports
  `CONFLICTING`, rebases each with that resolver, regenerates and pushes; the
  PR passes the gates again and re-enters the queue. A conflict in real code
  gets `land-failed` with the reason, i.e. a repair pick.
- **`pr-gate.yml` — the gates Mergify requires.** On `pull_request_target`,
  on a GitHub-hosted runner, with the BASE's code and no checkout of the PR,
  it posts two commit statuses: `trusted-author` (§8) and `base-health` —
  green when the latest health verdict on the base tip is GREEN or AMBER, or
  when the PR closes a declared repair issue: the RED gate `land` applies
  today (issue #4964). `health.yml` re-dispatches it over the queued PRs when
  it writes a verdict, so a RED stops the queue except for repairs and a
  GREEN reopens it — the Open Source plan's missing Pause and Priorities.

The rest of `land` moves without loss: the `check:ui` receipt and the
`## Preset scenario` refusal become checks of `pr-check.yml`; seed, telemetry
ingest and teardown go to `post-merge.yml`.

Retired by this section: `land.ts` (but its resolver and RED rule, above),
`land-runner.ts`, `land-ready.ts`, the gate mutex and `gate-run.sh`,
`machine-admission.ts`, the verdict store, the claims journal, the reaper,
`runner-units/`.

### 4. Post-merge, health, release are scheduled workflows

- `post-merge.yml` on `push` to the base branch, one concurrency group:
  scenario seed (`seed` runner: the machine holding the Convex deployment the
  owner plays on, the MacBook today), `gaps:sync`, grammar residue,
  umbrella detach — the `housekeeping` and nightly crons that issue #5592 was
  to schedule.
- `health.yml` on a 2-hour `schedule` and on dispatch, any `lane` runner:
  `check:all` + `test` on the base tip; the result is a native commit status
  and a native failure email. `afk-pass` reads the status before picking;
  the repair is `/health-fix` as a job, dispatched once per RED tip.
- `release.yml` on dispatch: the full gate including `check:ui --all` on a
  `lane` runner with a Convex deployment, then fast-forward of the release branch, under a GitHub
  Environment. ADR 0116's green-at-release holds unchanged.

### 5. Observability is the Actions UI

Runs, logs, durations and the queue per workflow (the Actions tab, filtered
by workflow, status, branch, actor); the runners page for which machine is
idle, busy or offline; native email and web notifications on a failed run
(to the actor; for a scheduled workflow, to its creator; failed-only
selectable); Mergify's queue page; checks on every PR. Each `afk-pass` writes
issue, PR, outcome, duration, tokens and cost (from `claude -p
--output-format json`) to `$GITHUB_STEP_SUMMARY` — shown on the run's
Summary page; 1 MiB per step, immutable once uploaded, no documented API —
and uploads the same as a small JSON artifact, which a weekly workflow
aggregates into PR/h, failure share and wait times in its own summary.
GitHub's Actions performance metrics (run and queue times, failure rates,
one year back) are GA on all cloud plans for repositories (changelog
2025-03-14); whether a personal repository shows them is read off its
Insights tab once workflows run. The telemetry
dashboard, `telemetry.db` and the transcript ingest leave the critical path
(kept as an optional local tool until nobody opens it, then deleted).
PRD B's cockpit, Tailscale heartbeat and mutual surveillance are not built:
the phone opens github.com.

### 6. Portability is a template

What a new project copies: `.github/workflows/{afk-pass,pr-check,post-merge,
health,release}.yml`, `.mergify.yml`, the `/next-ticket` skill family, and
one config block naming the project's own scripts (`check`, `test`,
`release`, `seed`) and runner labels. What it brings: those scripts and one
runner per machine. Nothing Tolaria-shaped — Convex, the browser walk, the
blade — leaks into the template; it is named in the config and nowhere else.

### 7. Two machines, one runner pool

Topology B' (ADR 0154 §9) gave each machine a role because the
orchestration was ours. With GitHub dispatching, both machines register the
same runners and a job goes to the first free one; differences survive only
where state lives, as runner labels: `pass` (a Claude session, both
machines), `lane` (queue checks, health, release; both — they are the two
parallel checks), `seed` (the machine holding the owner's Convex
deployment). The owner stops the MacBook's runners while working on it and
the Huawei carries the queue; the Huawei, always on, keeps it alive at night.
`landRunner.platform`, `healthRunner.platform` and the shared verdict store
retire with it.

### 8. Only trusted authors reach the runners and the queue

The repository is public, and GitHub recommends self-hosted runners only for
private repositories: a fork's PR could run code on them. The owner's rule:
the loop accepts PRs and issues only from a list only the owner can change;
everything else waits for a human. The list is the Actions repository
variable `TRUSTED_AUTHORS` (admin-only, out of any PR's reach), seeded with
the owner's account, which also authors the loop's PRs. Five barriers:

1. **"Require approval for all external contributors"** (repository Actions
   settings): a fork PR's workflows wait for the owner's approval — the
   barrier that matters, because a PR can rewrite any check written in its
   own workflow files.
2. **`trusted-author`**, posted by `pr-gate.yml` from the base's code (§3).
3. **The queue admits** only PRs with `trusted-author` and `base-health`
   green and the `ready-to-land` label (an outsider cannot label); Mergify
   reads its configuration from the base branch.
4. **A PR touching `.github/` or `.mergify.yml` never enters the queue**; the
   owner merges it by hand, so no pass can loosen its own gates.
5. **`afk-pass` picks only issues opened by a trusted author or labelled
   `ready-for-agent` by the owner**: an outsider's issue body may carry
   instructions aimed at Claude.

Claude's and `gh`'s credentials stay on the machines, under a dedicated
system user that runs the runners; no PR job receives a secret. Moving to an
organization adds nothing here on the Free plan: one default runner group,
additional groups on Team, and no documented per-workflow restriction.

### 9. The board stays; the picker loses its machinery

Priority, `blocked by` dependencies and sub-issues are native GitHub data and
are untouched. GitHub does not pick the next issue — the project's built-in
automations only set Status and add or archive items — so `queue:plan`'s
ordering (band, standalone before slice, priority, bugs, age; blocked and HITL
skipped) stays, as the first step of `afk-pass`. Its cap, admission, claims
journal and foreign-machine logic go: the cap is the runner count, the claim
a label both machines read on GitHub.

### 10. GitHub-hosted runners, where they fit

Standard GitHub-hosted runners are free and unmetered on public repositories
(4 CPU, 16 GB, x64 or arm64; 20 concurrent jobs on the Free plan; 6 h per
job). `pr-gate.yml` always runs there. Queue lanes and health MAY run there —
the queue then survives both machines being off — at a cost of a cold start
per job, measured in phase 0. Passes, preset seeding and the browser walk
stay on our machines (the subscription's token, the owner's Convex
deployment, the browser). Under the $100 plan they add reliability, not
drain speed.

### Budget

| Item                               | Today        | After                      |
| ---------------------------------- | ------------ | -------------------------- |
| Claude Code Max                    | $100/month   | $100/month (unchanged)     |
| GitHub                             | Free, public | Free, public               |
| Actions minutes (self-hosted only) | —            | $0 (public; fee postponed) |
| Merge queue                        | home-built   | Mergify $0 (open source)   |
| Tailscale, Resend                  | planned      | not needed                 |

Hedge: should a per-minute fee ever reach public repositories (not
announced), the same YAML runs on Gitea/Forgejo Actions or Woodpecker on the
Huawei; the cut is a remote URL, not a rewrite.

### Drain forecast

Backlog 441 `ready-for-agent` (2026-10-14), new issues excluded. October
1–13 closed 28 issues a day — and opened 27, which is why the queue holds
near 440. The binding limit is the subscription, not machines or queue: the
5-hour window was hit on October 5, 11, 12 and 14 with 3–4 sessions on the
MacBook alone, and the loop measured rate-limit at 20–40 sessions/day on
October 11 (both machines share one account). Forecast: **≈ 16 days at
$100** (14–28), with or without the second machine; **≈ 5 days at $200**
(3.5–7, four times the limits), where the serial `land` (≈ 178 PR/day) would
have become the next limit — so the $200 plan pays only after this migration,
as the owner stated.

## Consequences

- **Deleted, not maintained:** roughly 110k lines of scripts and their tests,
  the 17k-line dashboard, ~60 package scripts, the runner units, and the
  ADR/guide prose that explains them. The migration below is the last
  workflow work; it is mostly deletion.
- **Lost:** RAM-aware session admission (replaced by a static runner count,
  re-measured when a machine changes), the claims journal (labels and job
  assignment carry the same fact), the transcript-level telemetry (the job
  summary carries tokens and cost per pass), the dashboard's history views.
- **Gained:** zero-ops supervision, failure visible within minutes from any
  device, a toolchain declared per job (the #5598 class is gone), one YAML
  per concern, and a workflow another project adopts in an afternoon.
- **Unchanged:** what a PR owes (ADR 0154 §8), green-at-release (ADR 0116),
  the DSL-first and proof-of-failure norms, the `/next-ticket` pass itself.
- **Risks and their answers.** `schedule` events can be late — the triggers
  are events, the sweep is the fallback. A GitHub outage stops everything —
  it does today too (`gh` is in every script). Shared subscription limits
  across runners — the pass skips and the sweep retries. The migration is
  itself workflow work — bounded by the phases below, the old stack frozen
  from phase 0.

## Migration

Each phase is one or two PRs; the old stack is **frozen** from phase 0 (no
PRD A, no PRD B, no new workflow feature). Each phase names what proves it.

- **Phase 0 — freeze, runners, the missing crons.** Register `pass`, `lane`
  and `seed` runners on both machines under a dedicated system user, as user
  services; repository settings of §8; `TRUSTED_AUTHORS`; `pr-check.yml` as an
  advisory check. `post-merge.yml` runs `housekeeping` on every push and
  `health:nightly` on a nightly schedule at once — nothing schedules them
  today (issue #5592, superseded). Measure a lane on a GitHub-hosted runner.
  Proof: every open PR shows the check; one deliberate red is red;
  `gaps:sync` runs after a merge.
- **Phase 1 — the queue.** `pr-gate.yml` (`trusted-author`, `base-health`),
  `pr-refresh.yml`, the `check:ui` receipt and preset-scenario checks in
  `pr-check.yml`; `.mergify.yml` with two parallel checks, in shadow (acts
  only on a `queue:shadow` label), then cut-over: `land:ready` becomes the
  label, the land-runner stops (issues #5598 and #5599 superseded). Proof:
  20 PRs merged by the queue; failed-land share ≤ today's; a rejected PR
  carries `land-failed` and re-fires its pass; a conflicting generated file
  is regenerated without a pass; a RED base holds a non-repair PR.
- **Phase 2 — the schedules.** `health.yml`, `release.yml`; retire runner
  units, crons, verdict store, health cadence, `release.ts`. Proof: one RED
  tip visible as a status and an email, and the queue held by it; one release
  through the workflow.
- **Phase 3 — the pass.** `afk-pass.yml`; retire `loop-drain.sh`,
  `loop-handoff.sh`, `queue-plan`'s cap and claims, the reaper, machine
  admission, the dashboard. Proof: 24 h unattended on both machines, PR/h per
  machine ≥ today's, owner interventions counted and ≤ 1/day.
- **Phase 4 — deletion and the template.** Delete the retired code and its
  docs; amend ADR 0110/0116/0136/0154 where they name a retired script;
  extract the template to its own repository. Proof: `package.json` scripts
  and LOC deltas in the PR; a second project bootstrapped from the template.

Exit metrics, read monthly: PR/h per machine, failed-land %, owner
interventions per day, time-to-notice a failure (target ≤ 5 min, by email),
cost per month (target $100).

## Alternatives considered

- **Keep building (PRD A + PRD B).** Hold with grace periods and quiet hours,
  mail via Resend, the driver and the dashboard as supervised services, a
  Tailscale heartbeat with mutual surveillance. Rejected: five more slices of
  re-implementation, nothing portable, and the next incident class unknown —
  this record exists because the owner asked whether that was the only road.
- **Cloud coding agents as the producer** (Copilot coding agent, Codex cloud,
  Devin). Rejected: budget (Devin is ~$500/month; the others bill outside the
  subscription) and environment (no local Convex, browser or full suite).
  The producer stays Claude Code on our machines; what is adopted is
  everything after the PR.
- **Self-hosted CI** (Woodpecker, Gitea/Forgejo Actions, Jenkins) on the
  Huawei. The fallback if GitHub's terms move; more operations, less UI, no
  phone view out of the box.
- **GitHub native merge queue via an organization transfer.** Free for a
  public organization repository (per 2026 reports; the current docs carry no
  availability line), no third-party app, Actions metrics at organization
  level. Costs a controlled copy of the user Project board — GitHub copies
  views, fields and workflows, not items, so every Priority value is exported
  before and re-applied after (`backlog:triage --write` alone would not
  restore the hand-set `P0`s), then a dry `backlog:triage` must show no diff.
  It adds no security on the Free plan (§8) and the native queue lacks entry
  conditions and PR dependencies. Rejected for now by the owner; nothing above
  depends on which queue runs.
- **Stop the AFK loop and work attended.** Rejected: the 441-issue backlog
  and the owner's stated goal.

### Ralph — Huntley's loop, Pocock's Docker variant

Ralph (Geoffrey Huntley, 2025) is `while :; do cat PROMPT.md | claude -p;
done`: a fresh context per iteration, one task from a plan on disk,
implement, test, commit, exit; the plan file is the shared state. Matt
Pocock's variant (`aihero.dev`, "Getting Started With Ralph", the Day 5
workshop): a human-in-the-loop `ralph-once.sh` for tuning the prompt, then
`afk-ralph.sh <iterations>` — a `for` loop over `docker sandbox run claude
-p` (Docker Desktop's sandbox: the working directory mounted at the same
path, credentials in a volume, so `--dangerously-skip-permissions` cannot
touch the host), stopping on a `<promise>COMPLETE</promise>` sigil or the
iteration cap. Task source a `PRD.md` + `progress.txt`, or GitHub Issues
tagged AFK; TDD and "feedback loops" (tests, type checks) per task — in his
words the feedback loop quality "sets the ceiling on output quality"; an
automated review in a cleared context (Sonnet implements, Opus reviews);
parallelism and merging via his Sand Castle library (one worktree per agent,
a merger agent). No merge queue, no CI, no health or release gate, no
notifications, no second machine; progress is stdout, commits and
`progress.txt`; cost control is the iteration cap. Before the loop the human
grills, reviews the PRD and the vertical slices, then "leaves the loop";
after it, QA and review.

What the comparison says:

- **Tolaria's `/next-ticket` pass IS a Ralph iteration** — fresh context, one
  issue, tests, proof-of-failure, one review round, a PR — and its intake
  (`/grill` → `/to-prd` → `/to-tickets`) is Pocock's HITL phase to the
  letter. The producer is not what differs.
- **Everything Ralph deliberately lacks is what Tolaria built**: the ~110k
  lines are the queue, the gate, the health cadence, the orchestration and
  the telemetry around the loop. Ralph is portable because it has none of
  it; Pocock needs none of it because one agent commits to one branch and a
  human merges. Tolaria needs a subset — two machines, PRs instead of
  commits to the base, scripted verification before a merge, a release
  gate — and this record's answer is to take that subset from GitHub, not to
  write it: `afk-pass.yml` is a Ralph iteration whose `for` loop is the
  event scheduler, and the queue, the checks and the schedules are
  commodity.
- **Two ideas Ralph has and this design adopts, without its Docker.**
  Isolation: every runner runs as a dedicated system user, and every job
  declares its toolchain (bun, node, pinned) — the answer to the #5598
  class. Docker is ruled out by the owner (2026-10-14): on the MacBook its VM
  takes half the RAM by default (8 of 16 GB, on a machine already
  RAM-bound) and slows small-file I/O through VirtioFS; on the Huawei nothing
  is installed — one moving part fewer. The **sigil and the
  cap** as the pass contract: a pass exits 0 with "nothing to do" (the sigil)
  and the cap is runner count × subscription window, never a count inside a
  driver.
- **One thing Ralph does with an LLM that this design does with a script.**
  Sand Castle's merger agent reconciles branches by judgment; the merge
  queue reconciles by rebase and a re-run lane. For "verify by scripts, not
  prose" the queue wins, and it is what Pocock's own ceiling rule
  recommends.
- **Anthropic's `ralph-wiggum` plugin** (a Stop hook that keeps one session
  going until a completion promise) is a single-session loop; it has no place
  in a multi-issue AFK pipeline and is not adopted.

## What would change the answer

A per-minute Actions fee that reaches public repositories; Anthropic
disallowing subscription use on a self-hosted runner (then an API budget, or
no AFK); self-hosted runners proving unstable at ~10 jobs/hour; a product
need for a custom dashboard that the Actions UI cannot show.
