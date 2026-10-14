# Adopt the GitHub-native pipeline for the AFK workflow: self-hosted Actions runners verify, a merge queue lands, scheduled workflows gate health and release; the home-built orchestration is retired and the whole shape becomes a template portable to any project

## Status

proposed — written 2026-10-14 at the owner's request as the LAST iteration of
the workflow discussion ("arrivare a una soluzione che mi permetta di
concentrarmi sul prodotto"). Becomes accepted on the owner's word, recorded in
this section with the date. Supersedes the grill of the same day (PRD A "loop
never stops", PRD B "cockpit"): every decision reached there — Hold, mail via
Resend, the driver as a service, an always-on dashboard, a Tailscale heartbeat
— is re-examined below and most of it dissolves. Where this record and ADR
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
number of runner instances registered per machine** — MacBook 3–4, Huawei 1–2,
from the measured 1,900 MB per session (ADR 0154) — not a cap computed per
pick. A pass that cannot act (usage limit, RED base, nothing to pick) exits 0
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

Mergify (`.mergify.yml`, free for open source) queues a PR when it carries
`ready-to-land` and `pr-check` is green: oldest first, `land-failed`
repairs ahead, rebase onto the tip, re-check, merge — batch size 1 (the
serial `land` of today), batches later if the queue backs up. A PR the queue
rejects is labelled `land-failed` with the reason as a comment; that label
event re-fires `afk-pass` on its issue as the repair pick. The GitHub native
queue replaces Mergify the day the repository moves to an organization, if
it ever does; nothing above depends on which queue runs.

Retired by this section: `land.ts`, `land-runner.ts`, `land-ready.ts`, the
gate mutex and `gate-run.sh`, `machine-admission.ts`, the verdict store,
the claims journal, the reaper, `runner-units/`.

### 4. Post-merge, health, release are scheduled workflows

- `post-merge.yml` on `push` to the base branch, one concurrency group:
  scenario seed (MacBook runner, its Convex), `gaps:sync`, grammar residue,
  umbrella detach — the `housekeeping` and nightly crons that issue #5592 was
  to schedule.
- `health.yml` on a 2-hour `schedule` and on dispatch, Huawei runner:
  `check:all` + `test` on the base tip; the result is a native commit status
  and a native failure email. `afk-pass` reads the status before picking;
  the repair is `/health-fix` as a job, dispatched once per RED tip.
- `release.yml` on dispatch: the full gate including `check:ui --all` on the
  Huawei, then fast-forward of the release branch, under a GitHub
  Environment. ADR 0116's green-at-release holds unchanged.

### 5. Observability is the Actions UI

Runs, logs, durations and the queue per workflow; the runners page for
which machine is online; native email on a failed run; Mergify's queue page;
checks on every PR. Each `afk-pass` prints its token usage and cost from
`claude -p --output-format json` into the job summary. The telemetry
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

- **Phase 0 — freeze and runners.** Register runners (MacBook ×3, Huawei ×1)
  as user services; `pr-check.yml` as an advisory check. Proof: every open PR
  shows the check; one deliberate red is red.
- **Phase 1 — the queue.** `.mergify.yml` in shadow (acts only on a
  `queue:shadow` label), then cut-over: `land:ready` becomes the label, the
  land-runner stops. Proof: 20 PRs merged by the queue; failed-land share
  ≤ today's; a rejected PR carries `land-failed` and re-fires its pass.
- **Phase 2 — the schedules.** `post-merge.yml`, `health.yml`,
  `release.yml`; retire runner units, crons, verdict store, health cadence,
  `release.ts`. Proof: one RED tip visible as a status and an email; one
  release through the workflow.
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
- **GitHub native merge queue via an organization transfer.** Viable and
  free; costs the user Project board and the repository literals. Mergify
  first; revisit if Mergify's free tier changes.
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
- **Two things Ralph has and this design adopts.** The **sandbox** as a
  declared toolchain: the Linux runner runs the pass under a job `container:`
  (the Docker Desktop sandbox on the MacBook once it carries Convex and the
  browser — the "special image" Pocock mentions), which is the second answer
  to the #5598 class after the declared setup steps. The **sigil and the
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
