# Running the queue unattended (the AFK loop)

How to make the machine [drain](#g-drain) the `ready-for-agent` backlog on its
own, how to watch it, and how to tell a stopped run from a broken one.

Design rationale lives in ADR 0097 ([out-of-process](#g-process-boundary)
[driver](#g-driver)) and ADR 0099 ([handoff](#g-handoff) and crash retry). This
document is the operating manual.

**New here?** Every bolded piece of jargon below is defined in the
[Glossary](#glossary) at the bottom, and every occurrence links straight to it —
click any term, read two sentences, come back.

## The one command

```bash
bun run loop:afk
```

That [arms](#g-arming) the checkout and detaches a [driver](#g-driver) that keeps
running after this terminal, this SSH session, and the Claude Code session that
launched it are all gone. Stop it with `bun run loop:afk --stop`.

## The three layers, and which one you want

| Layer                             | Command                                                             | Lives as long as        |
| --------------------------------- | ------------------------------------------------------------------- | ----------------------- |
| One [batch](#g-batch), by hand    | `claude` → `/process-gh-issues`                                     | your session            |
| [Driver](#g-driver) in foreground | `bun run loop:drain --claude-args '--dangerously-skip-permissions'` | your terminal           |
| **Detached [driver](#g-driver)**  | **`bun run loop:afk`**                                              | until stopped or halted |

They are the same engine. `loop:afk` writes an [arming](#g-arming) file and
launches `loop-drain.sh`; `loop-drain.sh` is a `while` loop around a fresh
`claude -p "/process-gh-issues"` per [pass](#g-pass).

**A [pass](#g-pass) is one [batch](#g-batch)**: release dead
[claims](#g-claim), select up to `BATCH_CAP = 4` file-disjoint issues,
[fan out](#g-fan-out) one [subagent](#g-subagent) per issue, review,
[merge-train](#g-merge-train), close, exit. One [pass](#g-pass) = one `claude`
process. `MAX_PASSES = 1` is enforced by the skill **and** by
`.claude/hooks/deny-guard.sh`, deliberately: the context reset at the
[process boundary](#g-process-boundary) is the cost-containment mechanism, so
continuous [draining](#g-drain) has to be an out-of-process loop.

Nothing is lost at that [boundary](#g-process-boundary) — every piece of state a
resumed [pass](#g-pass) needs is durable: the `in-progress` GitHub label, the
branch and PR, and [`green-sha`](#g-green-sha).

## Before you start

1. **The [queue](#g-queue) has work.**

    ```bash
    gh issue list --search 'is:open is:issue label:ready-for-agent -label:in-progress' \
      --json number --limit 500 --jq 'length'
    ```

    Zero unclaimed issues is a `queue-empty` stop, immediately.

2. **`main` is green.** The loop refuses to branch off red, and correctly so.
3. **No [driver](#g-driver) is already running** — `bun run loop:afk --status`.
   Two [drivers](#g-driver) over one [queue](#g-queue) double the spend and
   interleave [merge-trains](#g-merge-train); `--single-instance` (which the
   [handoff](#g-handoff) always passes) refuses, but check anyway.
4. **Priorities are set.** The board's `Priority` field (P0/P1/P2) beats every
   heuristic. It is the one lever that decides what gets done tonight.

## Commands

```bash
bun run loop:afk                  # arm + start a detached driver
bun run loop:afk --status         # armed? driver alive? stop-file? last 5 passes
bun run loop:afk --stop           # stop after the current pass finishes
bun run loop:afk --resume         # clear the stop-file and start again
bun run loop:afk --arm            # write the conf, start nothing
bun run loop:afk --disarm         # end-of-pass handoff stops firing
```

**[Arming](#g-arming) is a separate, durable, human act.** The conf file
(`.claude/telemetry/afk.conf`) records that the [driver](#g-driver) may run
`claude` with `--dangerously-skip-permissions` — it will edit files, push
branches and merge PRs with nobody watching. That choice is written in plain
text so you can read, audit and revoke it, never inferred from the fact that a
[pass](#g-pass) finished.

**[Arming](#g-arming) survives the run it was created for.** `--disarm` is the
only thing that clears it: a [driver](#g-driver) that stops on its own leaves the
conf in place, so the next [pass](#g-pass) you run **by hand** — even an
unrelated one — will [hand off](#g-handoff) to a fresh [driver](#g-driver) at the
end. If you did not expect a [driver](#g-driver) to be running, check
`--status` before assuming nobody armed one.

`--stop` writes a [stop-file](#g-stop-file) and is honoured **during** a backoff,
not just between [passes](#g-pass). It is never cleared automatically:
`--resume` is how you say so. To abort the [pass](#g-pass) in flight as well,
kill the pid `--status` prints.

### Options (recorded in the conf on `--arm` / `--start`)

| Flag                           | Default                          | Effect                                                                             |
| ------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------- |
| `--claude-args <str>`          | `--dangerously-skip-permissions` | permission mode for each [pass](#g-pass)                                           |
| `--prompt <text>`              | `/process-gh-issues`             | the prompt each [pass](#g-pass) runs — **scopes** the run (see below)              |
| `--budget <n>` `--max-pct <n>` | off / 80                         | local-proxy token [budget guard](#g-budget-guard) (see below)                      |
| `--max-passes <n>`             | 0 (unlimited)                    | hard cap on [passes](#g-pass)                                                      |
| `--max-consecutive-errors <n>` | 3                                | crashes tolerated in a row before stopping                                         |
| `--start-delay <secs>`         | 45                               | grace before the first [pass](#g-pass) (the calling one is still releasing claims) |
| `--no-caffeinate`              | off                              | do not hold the Mac awake — an overnight run needs it awake                        |

**`--prompt` scopes an unattended run to part of the [queue](#g-queue).**
`/process-gh-issues` takes free-text args that narrow which issues a
[pass](#g-pass) considers, so `--prompt "/process-gh-issues figli di 2405"`
[drains](#g-drain) only PRD #2405's children — without it an unattended run can
only ever take the global [queue](#g-queue) in board-priority order
(`--claude-args` appends CLI _flags_ to `claude`, not prompt text). The value is
recorded in the conf and printed by `--status`, because an
[armed](#g-arming) run that _looks_ unscoped but isn't is a trap. It must be a
single line: a newline would be truncated when the conf is read back, so it is
rejected at [arm](#g-arming) time.

**A scoped run still releases claims globally.** [Claim](#g-claim) release
(§1a of the skill) is deliberately outside whatever the `--prompt` narrows to —
scoping which issues a [pass](#g-pass) _works_ must never scope which
[orphans](#g-orphan) it _frees_, or a scoped run quietly strands everything
outside its scope. This was the shape of an eight-[claim](#g-claim) pile-up on
2026-08-20.

**The [budget guard](#g-budget-guard) is opt-in and fails closed.** With no
`--budget` it is disabled and says so once. With one, it reads
`bun run usage:window` before every [pass](#g-pass), and any unreadable answer
stops the run (`usage-error`) rather than skipping the check. It is a **local
proxy** for relative burn — there is no quota endpoint to poll — so treat it as
a brake, not a meter.

## Monitoring

```bash
bun run loop:afk --status                     # the summary you want at breakfast
bun run loop:status                           # per-claim: verdict, stage, priority
tail -f .claude/telemetry/loop-drain.log      # one line per pass
ls -la .claude/telemetry/loop-drain/          # full transcript per pass
bun run loop:scorecard --days 7               # review-blocking, fixup rounds, model routing
git worktree list                             # leak detector
```

`loop-drain.log` is seven space-separated fields:

```
epoch  pass  exit  pct  queue_before  queue_after  reason
1786975612  4  0  n/a  200  196  no-progress
```

`queue_*` counts **unclaimed** `ready-for-agent` issues. [Claiming](#g-claim) an
issue does not move the progress signal — only a real landing does.

### Stop reasons

| `reason`       | Meaning                                                                                      | What to do                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue-empty`  | nothing unclaimed left                                                                       | nothing — this is success                                                                                                                                                                                                                                                                                                                                       |
| `max-passes`   | the cap you set                                                                              | nothing                                                                                                                                                                                                                                                                                                                                                         |
| `stop-file`    | you asked                                                                                    | `--resume`                                                                                                                                                                                                                                                                                                                                                      |
| `budget`       | burn ≥ `--max-pct`                                                                           | wait for the window, or raise the [budget](#g-budget-guard) deliberately                                                                                                                                                                                                                                                                                        |
| `rate-limit`   | the transcript matched a usage-limit shape                                                   | wait. Never retried on purpose: there is no quota to poll, so a backoff would be a guess                                                                                                                                                                                                                                                                        |
| `claude-error` | `claude` exited non-zero `--max-consecutive-errors` times in a row                           | read the last [pass](#g-pass) log                                                                                                                                                                                                                                                                                                                               |
| `usage-error`  | the [budget](#g-budget-guard) reader failed                                                  | fix `usage:window`; the guard refuses to run blind                                                                                                                                                                                                                                                                                                              |
| `gh-error`     | the [queue](#g-queue) count could not be read                                                | check `gh auth status`                                                                                                                                                                                                                                                                                                                                          |
| `claims-held`  | a [pass](#g-pass) claimed work and landed nothing — likely killed mid-batch                  | `bun run loop:doctor` to inspect, `bun run loop:doctor --release` to drop `in-progress` on the orphans — but not yet: `classifyClaim` only rates a claim `orphan` after 2–24h (`suspect`/`live` first), so run right after this stop reports "0 orphaned" and releases nothing. Wait out that window (or drop the label by hand if you're certain), then resume |
| `no-progress`  | [passes](#g-pass) ran and the [queue](#g-queue) did not move, and nothing was claimed either | **investigate — see below**                                                                                                                                                                                                                                                                                                                                     |

Note the rate-limit detector greps the whole transcript, so an agent writing the
word "quota" in an unrelated sentence can stop a run. Accepted on purpose: it
fails safe.

## When it stops without doing anything

`no-progress` is the reason worth reading carefully, because it describes a
symptom and not a cause. The [queue](#g-queue) did not move — but a
[pass](#g-pass) that never really ran looks exactly like a [queue](#g-queue) that
has nothing to give.

**Check the [pass](#g-pass) log size first.**

```bash
ls -la .claude/telemetry/loop-drain/
```

A [pass](#g-pass) that did real work leaves kilobytes: a [receipt](#g-receipt)
naming issues, PRs, [gate](#g-gate) counts. **A [pass](#g-pass) log of a few
hundred bytes is a [pass](#g-pass) that died on its feet.** The shape observed on
2026-08-17, four [passes](#g-pass) in a row:

```
"Waiting on background push + full test baseline; both will notify when done."
"Batch claimed (#2445, #1969, #1851, #1852)… waiting for that background job"
```

In [headless mode](#g-headless) the end of the turn is the end of the process. An
agent that backgrounds a [gate](#g-gate) and ends its turn "waiting for a
notification" is never woken: the [pass](#g-pass) exits, having
[claimed](#g-claim) issues and released nothing.

The second killer is the same shape with a timer attached. `claude -p` waits a
bounded time for background tasks once the main turn ends and then terminates
the process, which was killing [subagents](#g-subagent) mid-edit — 18 of ~34
recorded [pass](#g-pass) logs carry
`Background tasks still running after 600s; terminating`. The
[driver](#g-driver) now sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` so a
[pass](#g-pass) runs to completion; [pass](#g-pass) cost stays bounded by the
[budget guard](#g-budget-guard), which is the correct instrument for it.

The residue to clean up afterwards:

```bash
bun run loop:doctor        # claims nothing will release; --release drops them
bun run wt:gc              # worktrees the dead pass never tore down; --yes removes them
```

`loop:doctor` is the **single authority** on whether a [claim](#g-claim) is
alive. The [driver](#g-driver) itself runs it with `--release` before every
[pass](#g-pass) — ahead of the queue count, so anything it reclaims is work that
pass can pick up — and the skill runs it again as its own first step, so by the
time you read a stopped run's residue it has usually already been cleaned. Its
rule, in order: an open PR is alive; a branch **on the remote** is alive; the
claim's **owning process still running** is alive at any age; a **local-only**
branch is alive for 24h and an [orphan](#g-orphan) after that; no branch at all
is `suspect` for two hours and an [orphan](#g-orphan) after that.

Every release is written back into the claim journal
(`.claude/telemetry/claims.jsonl`) as a `released` row carrying `by:
"loop:doctor"` and the verdict's reason, so "what reclaimed this issue, and on
what evidence" is answerable after the fact:
`jq 'select(.by == "loop:doctor")' .claude/telemetry/claims.jsonl`.

**The local/remote distinction is the load-bearing part.** A local branch
outlives the process that made it — a killed [pass](#g-pass) leaves its
[worktree](#g-worktree) and branch on disk forever — so counting any branch as
proof of life let eight [claims](#g-claim), four of them P0, read as live for
25–36 hours. The `suspect` state exists for the opposite risk: no branch and no
PR is also exactly what a HEALTHY [pass](#g-pass) looks like between
[claiming](#g-claim) its [batch](#g-batch) and pushing the first branch, and the
sessions share one GitHub account, so a wrong release unclaims live work with no
signal that it happened.

Releasing a [claim](#g-claim) frees the board, **never the disk**. An
[orphan's](#g-orphan) [worktree](#g-worktree) routinely holds real uncommitted
work — the [pass](#g-pass) was mid-edit, which is usually why it is an
[orphan](#g-orphan). Commit it on its local branch first (`--no-verify`, no
push) before removing anything: loose changes are volatile, because
`lint-staged` stashes them on every commit anywhere in the repo.

## What stays yours

The loop [drains](#g-drain) the [queue](#g-queue); it never fills it. Between
runs, the human work is:

- **Fill the [queue](#g-queue)** — `/new-qa-issue`, `/new-card`, `/new-set`, or
  grill → `/to-prd` → `/to-tickets`, ending in issues labelled
  `ready-for-agent`.
- **Set `Priority`** on the board. It is the only override that beats the
  heuristics, and a `P2` outranks an unprioritized `bug` deliberately.
- **Unblock** `needs-design` and `ready-for-human` — the loop reports them and
  moves on.
- **Review [HITL](#g-hitl) PRs** — an issue flagged for a human is implemented,
  [gated](#g-gate) and left open, never merged by the
  [train](#g-merge-train).

## Costs

Four mechanisms, all already on:

- **`MAX_PASSES = 1` per process** — the context reset at the
  [process boundary](#g-process-boundary) is the saving; enforced by a hook, not
  by prose.
- **`BATCH_CAP = 4`** — also a CPU budget: `BATCH_CAP × vitest workers` should
  stay at or below the core count.
- **Model routing** — every [subagent](#g-subagent) spawn must pass an explicit
  `model` (`spawn-guard.sh`). Without it a [subagent](#g-subagent) inherits the
  session tier, which silently puts routine work on the most expensive model.
  Measured leakage fell from 10% to 0% once the hook landed.
- **The [budget guard](#g-budget-guard)** above.

`bun run loop:scorecard` reports the review-blocking rate, fixup rounds,
[gate](#g-gate) runs and model-routing leakage over a window.

## Glossary

Every term the rest of this guide links to. Ordered alphabetically.

### <a id="g-arming"></a>Arming

Writing `.claude/telemetry/afk.conf`, the file that says "this checkout may run
unattended [passes](#g-pass), with these flags". A deliberate, durable human act
(`bun run loop:afk --arm`), kept in plain text so it can be read and revoked. It
does **not** expire: only `--disarm` removes it, so an
[arming](#g-arming) outlives the [driver](#g-driver) it was created for and the
next finished [pass](#g-pass) will start a new one.

### <a id="g-batch"></a>Batch

The set of issues one [pass](#g-pass) works on at once — up to `BATCH_CAP = 4`,
chosen so their declared file sets do not overlap. Disjointness is what makes it
safe to implement them in parallel [worktrees](#g-worktree).

### <a id="g-budget-guard"></a>Budget guard

An opt-in brake (`--budget`, `--max-pct`) that reads `bun run usage:window`
before each [pass](#g-pass) and stops the run past a burn threshold. A **local
proxy**, not a meter: there is no quota endpoint to poll. It fails closed — an
unreadable answer stops the run rather than skipping the check.

### <a id="g-claim"></a>Claim

The `in-progress` label on an issue, meaning "a [pass](#g-pass) is working this,
nobody else take it". Taken at selection and meant to come off on every exit
path. A [claim](#g-claim) nobody releases is an [orphan](#g-orphan).

### <a id="g-drain"></a>Drain (the queue)

To work the `ready-for-agent` backlog down, issue by issue, until it is empty.
The loop only ever drains — **it never fills**. Adding work to the
[queue](#g-queue) is a human act through the intake skills, and that asymmetry is
deliberate: an agent that files its own work removes the one place a human sets
direction.

### <a id="g-driver"></a>Driver

`scripts/loop-drain.sh` — the `while` loop that launches one `claude` process per
[pass](#g-pass) and decides when to stop. It is a plain shell script, not an
agent: it holds no context and makes no judgment calls, which is exactly why it
can outlive any single session.

### <a id="g-fan-out"></a>Fan-out

Spawning the [batch](#g-batch)'s [subagents](#g-subagent) concurrently, one per
issue, each in its own [worktree](#g-worktree). The opposite of the
[merge-train](#g-merge-train), which is deliberately serial: implementation
parallelises safely, merging does not.

### <a id="g-gate"></a>Gate

The quality checks a change must pass — `bun run check:pr` (fast, per-PR) and
`bun run check:all` + `bun run test` (full, at the [merge-train](#g-merge-train)).
There is no CI here: the local gate is the only gate, so nothing may be left for
a server to catch.

### <a id="g-green-sha"></a>green-sha (green-main)

`.claude/telemetry/green-sha` — the commit whose full [gate](#g-gate) last passed
on `main`. A [pass](#g-pass) whose tip matches it skips re-running the baseline
suite (same tree, same result). "Green-main" is the invariant it serves: `main`
is always green, and a [pass](#g-pass) never branches off red.

### <a id="g-handoff"></a>Handoff

The last action of a [pass](#g-pass): `scripts/loop-handoff.sh --from-pass`,
which starts a fresh [driver](#g-driver) if the checkout is [armed](#g-arming)
and no [driver](#g-driver) already owns it. It is what lets an unattended run
survive a [driver](#g-driver) dying — the baton is passed by whoever finishes,
not held by one long-lived process.

### <a id="g-headless"></a>Headless (print mode)

`claude -p "<prompt>"` — a non-interactive run that executes one turn and exits.
The [driver](#g-driver) uses it for every [pass](#g-pass). Its defining
constraint: **the end of the turn is the end of the process**, so nothing may be
left waiting on a background job, and a backgrounded [gate](#g-gate) never
reports back.

### <a id="g-hitl"></a>HITL

"Human in the loop" — an issue marked so the [pass](#g-pass) implements it,
[gates](#g-gate) it and opens the PR, but the [merge-train](#g-merge-train)
leaves it unmerged for a human to review.

### <a id="g-merge-train"></a>Merge-train

The serial stage that lands the [batch](#g-batch)'s PRs one at a time behind a
lock: rebase onto the current `main`, re-run the full [gate](#g-gate) on the
rebased tree, merge only if green. Serial on purpose — two PRs that each passed
their own gate can still be red together, and that combined state is what
actually lands.

### <a id="g-orphan"></a>Orphan

A [claim](#g-claim) nothing is going to release: the [pass](#g-pass) that took it
died, so its `in-progress` label sits there forever. Worse than a lost issue,
because the board reads it as _being worked_ — no later [pass](#g-pass) reselects
it and nothing revisits the decision. `bun run loop:doctor` is the authority that
finds and frees them.

### <a id="g-pass"></a>Pass

One iteration of the loop: one `claude` process, one [batch](#g-batch), from
[claim](#g-claim)-release through selection, [fan-out](#g-fan-out), review,
[merge-train](#g-merge-train) and close. `MAX_PASSES = 1` means a process does
exactly one and exits — see [process boundary](#g-process-boundary).

### <a id="g-process-boundary"></a>Process boundary

The line between one [pass](#g-pass)'s `claude` process and the next. Crossing it
throws away the conversation context, which is the whole point: context grows
super-linearly in cost, so a fresh process per [batch](#g-batch) is the
cost-containment mechanism. It is safe only because no loop state lives in the
conversation — the `in-progress` label, the branch, the PR and
[`green-sha`](#g-green-sha) are all durable on disk or on GitHub.

### <a id="g-queue"></a>Queue

The open issues labelled `ready-for-agent` and not [claimed](#g-claim). The
loop's only source of work; an empty one is a success condition, not a problem to
solve.

### <a id="g-receipt"></a>Receipt

The structured JSON a [subagent](#g-subagent) writes when it finishes
(`.claude/receipts/<batch>/`): what it did, which PR it opened, which paths it
touched, its proof-of-failure. It is what the [merge-train](#g-merge-train) reads
to compute merge order — and it survives the [pass](#g-pass), so an interrupted
run can be resumed from disk rather than from memory.

### <a id="g-stop-file"></a>Stop-file

`.claude/telemetry/loop-stop`. Its presence tells the [driver](#g-driver) to stop
after the current [pass](#g-pass) — honoured during a backoff too, not only
between [passes](#g-pass). Never cleared automatically; `--resume` is how you say
you meant it.

### <a id="g-subagent"></a>Subagent

A fresh agent the [pass](#g-pass) spawns for one job — implement an issue, review
a PR, fix up a branch. Its file reads and test output stay in **its** context,
and only its terse [receipt](#g-receipt) comes back, which is what keeps the
orchestrating [pass](#g-pass) small across a long run.

### <a id="g-worktree"></a>Worktree

A throwaway checkout (`git worktree`) with its own branch, one per issue, so
parallel [subagents](#g-subagent) never share a working directory. The shared
main checkout is read-only for this reason. A [worktree](#g-worktree) outlives
the [pass](#g-pass) that made it — including a killed one, which is why
`bun run wt:gc` exists and why a leftover local branch proves nothing about
whether anyone is still working.
