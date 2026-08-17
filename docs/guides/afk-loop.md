# Running the queue unattended (the AFK loop)

How to make the machine drain the `ready-for-agent` backlog on its own, how to
watch it, and how to tell a stopped run from a broken one.

Design rationale lives in ADR 0097 (out-of-process driver) and ADR 0099 (handoff
and crash retry). This document is the operating manual.

## The one command

```bash
bun run loop:afk
```

That arms the checkout and detaches a driver that keeps running after this
terminal, this SSH session, and the Claude Code session that launched it are all
gone. Stop it with `bun run loop:afk --stop`.

## The three layers, and which one you want

| Layer                | Command                                                             | Lives as long as        |
| -------------------- | ------------------------------------------------------------------- | ----------------------- |
| One batch, by hand   | `claude` → `/process-gh-issues`                                     | your session            |
| Driver in foreground | `bun run loop:drain --claude-args '--dangerously-skip-permissions'` | your terminal           |
| **Detached driver**  | **`bun run loop:afk`**                                              | until stopped or halted |

They are the same engine. `loop:afk` writes an arming file and launches
`loop-drain.sh`; `loop-drain.sh` is a `while` loop around a fresh
`claude -p "/process-gh-issues"` per pass.

**A "pass" is one batch**: select up to `BATCH_CAP = 4` file-disjoint issues,
fan out one subagent per issue, review, merge-train, close, exit. One pass = one
`claude` process. `MAX_PASSES = 1` is enforced by the skill **and** by
`.claude/hooks/deny-guard.sh`, deliberately: the context reset between passes is
the cost-containment mechanism, so continuous draining has to be an
out-of-process loop.

Nothing is lost at the process boundary — every piece of state a resumed pass
needs is durable: the `in-progress` GitHub label, the branch and PR, and
`.claude/telemetry/green-sha`.

## Before you start

1. **The queue has work.**

    ```bash
    gh issue list --search 'is:open is:issue label:ready-for-agent -label:in-progress' \
      --json number --limit 500 --jq 'length'
    ```

    Zero unclaimed issues is a `queue-empty` stop, immediately.

2. **`main` is green.** The loop refuses to branch off red, and correctly so.
3. **No driver is already running** — `bun run loop:afk --status`. Two drivers
   over one queue double the spend and interleave merge-trains; `--single-instance`
   (which the handoff always passes) refuses, but check anyway.
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

**Arming is a separate, durable, human act.** The conf file
(`.claude/telemetry/afk.conf`) records that the driver may run `claude` with
`--dangerously-skip-permissions` — it will edit files, push branches and merge
PRs with nobody watching. That choice is written in plain text so you can read,
audit and revoke it, never inferred from the fact that a pass finished.

`--stop` writes a stop-file and is honoured **during** a backoff, not just
between passes. It is never cleared automatically: `--resume` is how you say so.
To abort the pass in flight as well, kill the pid `--status` prints.

### Options (recorded in the conf on `--arm` / `--start`)

| Flag                           | Default                          | Effect                                                                   |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------ |
| `--claude-args <str>`          | `--dangerously-skip-permissions` | permission mode for each pass                                            |
| `--budget <n>` `--max-pct <n>` | off / 80                         | local-proxy token budget guard (see below)                               |
| `--max-passes <n>`             | 0 (unlimited)                    | hard cap on passes                                                       |
| `--max-consecutive-errors <n>` | 3                                | crashes tolerated in a row before stopping                               |
| `--start-delay <secs>`         | 45                               | grace before the first pass (the calling pass is still releasing claims) |
| `--no-caffeinate`              | off                              | do not hold the Mac awake — an overnight run needs it awake              |

**The budget guard is opt-in and fails closed.** With no `--budget` it is
disabled and says so once. With one, it reads `bun run usage:window` before every
pass, and any unreadable answer stops the run (`usage-error`) rather than
skipping the check. It is a **local proxy** for relative burn — there is no quota
endpoint to poll — so treat it as a brake, not a meter.

## Monitoring

```bash
bun run loop:afk --status                     # the summary you want at breakfast
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

`queue_*` counts **unclaimed** `ready-for-agent` issues. Claiming an issue does
not move the progress signal — only a real landing does.

### Stop reasons

| `reason`       | Meaning                                                            | What to do                                                                               |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `queue-empty`  | nothing unclaimed left                                             | nothing — this is success                                                                |
| `max-passes`   | the cap you set                                                    | nothing                                                                                  |
| `stop-file`    | you asked                                                          | `--resume`                                                                               |
| `budget`       | burn ≥ `--max-pct`                                                 | wait for the window, or raise the budget deliberately                                    |
| `rate-limit`   | the transcript matched a usage-limit shape                         | wait. Never retried on purpose: there is no quota to poll, so a backoff would be a guess |
| `claude-error` | `claude` exited non-zero `--max-consecutive-errors` times in a row | read the last pass log                                                                   |
| `usage-error`  | the budget reader failed                                           | fix `usage:window`; the guard refuses to run blind                                       |
| `gh-error`     | the queue count could not be read                                  | check `gh auth status`                                                                   |
| `no-progress`  | passes ran and the queue did not move                              | **investigate — see below**                                                              |

Note the rate-limit detector greps the whole transcript, so an agent writing the
word "quota" in an unrelated sentence can stop a run. Accepted on purpose: it
fails safe.

## When it stops without doing anything

`no-progress` is the reason worth reading carefully, because it describes a
symptom and not a cause. The queue did not move — but a pass that never really
ran looks exactly like a queue that has nothing to give.

**Check the pass log size first.**

```bash
ls -la .claude/telemetry/loop-drain/
```

A pass that did real work leaves kilobytes: a receipt naming issues, PRs, gate
counts. **A pass log of a few hundred bytes is a pass that died on its feet.**
The shape observed on 2026-08-17, four passes in a row:

```
"Waiting on background push + full test baseline; both will notify when done."
"Batch claimed (#2445, #1969, #1851, #1852)… waiting for that background job"
```

In headless mode (`claude -p`) the end of the turn is the end of the process.
An agent that backgrounds a gate and ends its turn "waiting for a notification"
is never woken: the pass exits, having claimed issues and released nothing.

The residue to clean up afterwards:

```bash
# 1. worktrees the dead pass never tore down
bun run wt:gc                 # report; --yes to remove the finished ones

# 2. claims it never released — issues labelled in-progress with no live branch/PR
gh issue list --search 'is:open label:in-progress' --json number,title,updatedAt
```

An `in-progress` issue whose branch and worktree are gone and which has no open
PR was orphaned by a crashed process; removing the label is safe and puts it
back in the pool. An issue whose branch **does** exist belongs to a session that
may still be alive — leave it (the account is shared, so unclaiming someone
else's live work is indistinguishable from unclaiming your own).

## What stays yours

The loop drains the queue; it never fills it. Between runs, the human work is:

- **Fill the queue** — `/new-qa-issue`, `/new-card`, `/new-set`, or
  grill → `/to-prd` → `/to-tickets`, ending in issues labelled `ready-for-agent`.
- **Set `Priority`** on the board. It is the only override that beats the
  heuristics, and a `P2` outranks an unprioritized `bug` deliberately.
- **Unblock** `needs-design` and `ready-for-human` — the loop reports them and
  moves on.
- **Review HITL PRs** — an issue flagged for a human is implemented, gated and
  left open, never merged by the train.

## Costs

Four mechanisms, all already on:

- **`MAX_PASSES = 1` per process** — the context reset between batches is the
  saving; enforced by a hook, not by prose.
- **`BATCH_CAP = 4`** — also a CPU budget: `BATCH_CAP × vitest workers` should
  stay at or below the core count.
- **Model routing** — every subagent spawn must pass an explicit `model`
  (`spawn-guard.sh`). Without it a subagent inherits the session tier, which
  silently puts routine work on the most expensive model. Measured leakage fell
  from 10% to 0% once the hook landed.
- **The budget guard** above.

`bun run loop:scorecard` reports the review-blocking rate, fixup rounds, gate
runs and model-routing leakage over a window.
