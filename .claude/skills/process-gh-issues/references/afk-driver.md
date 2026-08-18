# The AFK driver — `bun run loop:afk` / `bun run loop:drain`

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered when setting up or debugging continuous unattended draining (§ Running
unattended). Full rationale: ADR 0097 (the driver) and ADR 0099 (the handoff
that starts it, and the crash-retry policy).

---

Two layers, one job:

| Layer                                  | What it is                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `loop:drain` (`scripts/loop-drain.sh`) | a POSIX `sh` loop around a fresh `claude -p "/process-gh-issues"` per pass — the "Ralph" pattern               |
| `loop:afk` (`scripts/loop-handoff.sh`) | arms the checkout and **detaches** that driver, so one command (or one finished pass) starts an unattended run |

The driver never re-uses a conversation, so it never trips the deny-guard
`/loop` trips.

## Starting a run — one command, then walk away

```sh
bun run loop:afk                     # arm (if needed) + detach a driver
bun run loop:afk --status            # armed? driver alive? stop-file? last 5 passes
bun run loop:afk --stop              # stop after the current pass finishes
bun run loop:afk --resume            # clear the stop-file and start again
bun run loop:afk --arm               # record the conf without starting anything
bun run loop:afk --disarm            # end-of-pass handoff stops firing
```

The detached driver runs in **its own session** (`setsid` via `perl`, plus
`nohup`), so it survives the terminal, the SSH connection and the Claude Code
process that launched it, and is not killed by a process-group signal aimed at
that parent. It runs under `caffeinate -i -s` (opt out with `--no-caffeinate`)
because a Mac that sleeps stops the run as surely as a crash does.

**Arming is what makes a finished pass start the next one.** `/process-gh-issues`
ends with `sh scripts/loop-handoff.sh --from-pass` (SKILL.md §4, last step),
which no-ops unless `.claude/telemetry/afk.conf` exists. Arming is therefore a
deliberate, durable, revocable human act — an ordinary interactive pass must
never silently fork an hours-long run that auto-approves every permission
prompt. The conf records that permission mode **in plain text** so it can be
read, audited and deleted; it is parsed, never sourced or `eval`'d (an
unattended process reads it and then runs `claude` with what it finds).

The handoff also no-ops — quietly, exit 0, never failing the batch that just
landed — when the pass was itself started by the driver
(`TOLARIA_LOOP_DRAIN=1`; without this check every driven pass would fork
another driver and the fan-out would be exponential), when a driver is already
running over this checkout (its pid file, liveness-checked so a killed driver
leaves no stale lock), or when the stop-file exists.

`bun run loop:drain` remains the way to run the driver in the **foreground** of
a terminal you are watching.

## Stop reasons

Split into two groups. The first five are checked BEFORE a pass runs, in the
order listed. The last three are only knowable AFTER `claude` exits, so they
are checked once the pass finishes. The pass log and
`.claude/telemetry/loop-drain.log` record which one fired.

**Pre-pass:**

| Reason        | Meaning                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stop-file`   | `.claude/telemetry/loop-stop` exists — `touch` it to stop the driver after the current pass finishes (the kill switch for a run in flight)                                                                                           |
| `max-passes`  | `--max-passes` reached                                                                                                                                                                                                               |
| `budget`      | the local-proxy token pct crossed `--max-pct` (disabled, and said so once at startup, when no budget is configured)                                                                                                                  |
| `usage-error` | a budget IS configured but its pct couldn't be read back — the reader crashed, exited non-zero, or returned something unparsable. **Fails CLOSED**: stops the run exactly like `budget` would, never skips the check and runs anyway |
| `queue-empty` | no unclaimed `ready-for-agent` issues left — the ordinary, healthy end of a run; do not poll aggressively, a human must refill the queue                                                                                             |

**Post-pass:**

| Reason         | Meaning                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rate-limit`   | the pass transcript matched a rate-limit/usage-limit shape — stops and reports rather than sleeping until reset. **Never retried**, whatever the crash-retry budget is: there is no quota endpoint to poll, so any backoff would be a guess (ADR 0097)                                                             |
| `claude-error` | `claude` exited non-zero with NO rate-limit-shaped message — a crash, a bad `--claude-args` string, a hook denial. Kept distinct from `rate-limit` so the one telemetry field a human reads isn't misread. **Retried first** (see below); this reason means the retries ran out                                    |
| `no-progress`  | 2 consecutive passes with neither the TOTAL open `ready-for-agent` count nor `.claude/telemetry/green-sha` moving. Deliberately NOT the unclaimed count — a pass that only CLAIMS issues (adds `in-progress`) drops the unclaimed count without landing anything, which would otherwise look like progress forever |

## Crash retry (ADR 0099)

A single `claude` crash used to end an overnight run outright. It is now
retried with a doubling backoff (`--error-backoff-secs`, default 60s, capped
by `--error-backoff-max-secs`), bounded by **consecutive** failures
(`--max-consecutive-errors`, default 3). Any pass that does not crash resets
the streak, so a flaky environment cannot spin here forever and a genuinely
broken one still stops with `claude-error`. `--max-consecutive-errors 1`
restores the old stop-on-first-crash behaviour.

The backoff sleeps in short chunks and re-checks the stop-file each time — the
kill switch works **during** a backoff, not only between passes. A retry is
logged with reason `claude-retry`; that reason never ends a run.

A red baseline the pass itself did not cause (§0b row 3) is reported and
surfaced by the pass, not detected by the driver — a subsequent pass keeps
reporting it, so treat repeated `no-progress` stops as the signal to go read
the pass log under `.claude/telemetry/loop-drain/`.

**The stop-file is never cleared automatically.** Once you `touch
.claude/telemetry/loop-stop` (or a run trips it another way), every future
`loop:drain` invocation stops at pass 0 with `reason=stop-file` until you
remove it — `rm .claude/telemetry/loop-stop` before relaunching, or the next
run silently no-ops.

## The budget guard is a local proxy, not a quota reading

There is no supported way to read Anthropic's real usage/quota from this
machine (no `claude usage` subcommand, nothing in `~/.claude/config.json` /
`daemon.status.json` / `stats-cache.json` / the transcripts; `/usage` is
interactive-only). `scripts/lib/usage-window.ts` instead sums the top-level
token fields in this machine's own Claude Code JSONL transcripts over a
trailing window, weights them by an explicit, overridable price table
(`--weights <file.json>`), and compares the weighted total against a budget
you declare — `--budget <weighted-tokens>` or `TOLARIA_LOOP_TOKEN_BUDGET`.
**Never read the resulting percentage as "percent of my Anthropic quota
used."** An unrecognised model always weights as the most expensive known
class (fail expensive), never the cheapest. And if the reader can't be read
back at all (see `usage-error` above), the guard stops the run rather than
guessing — it never silently skips the check.

**Calibrate before picking a number.** Weighted totals over a real 5-hour
window run in the hundreds of millions, not millions — a budget in the wrong
order of magnitude trips the guard at pass 0 forever (or, if a per-pass typo
also breaks the reader, would previously have disabled the guard entirely —
now it just stops with `usage-error` instead). Check your own machine's
recent burn first:

```sh
bun run usage:window --hours 5 --budget 1 --pretty
```

`--budget 1` is a deliberate no-op value — it makes `pct` read as an absurd
percentage of 1, which is fine, since the number you actually want is
`weighted`. Use that as the basis for a real `--budget`.

## Permissions

A truly unattended pass needs a permission mode or the first tool prompt
blocks forever with nobody watching. The driver never defaults this — it is
security-relevant and is the user's call — and warns once at startup when
`--claude-args` is empty:

```sh
bun run loop:drain \
  --budget 200000000 --max-pct 80 \
  --claude-args '--dangerously-skip-permissions'
```

(`--budget 200000000` is an example in the right order of magnitude for a
5-hour window — see § Calibrate above, it is not a number to copy blind.)

## Flags

| Flag                       | Env fallback                | Default                            |
| -------------------------- | --------------------------- | ---------------------------------- |
| `--budget`                 | `TOLARIA_LOOP_TOKEN_BUDGET` | unset (guard disabled)             |
| `--max-pct`                | —                           | `80`                               |
| `--window-hours`           | —                           | `5`                                |
| `--max-passes`             | —                           | `0` (unlimited)                    |
| `--stop-file`              | —                           | `.claude/telemetry/loop-stop`      |
| `--claude-args`            | —                           | empty (warns; see Permissions)     |
| `--max-consecutive-errors` | —                           | `3`                                |
| `--error-backoff-secs`     | —                           | `60` (doubles per retry)           |
| `--error-backoff-max-secs` | —                           | `900`                              |
| `--pid-file`               | —                           | `.claude/telemetry/loop-drain.pid` |
| `--single-instance`        | —                           | off (the handoff always passes it) |
| `--start-delay`            | —                           | `0` (the handoff passes `45`)      |
| `--dry-run`                | —                           | off                                |

Every numeric flag is validated at startup — a non-numeric value (a typo, a
suffix like `2M`, a separator like `2_000_000`) is a loud `exit 2`, never a
guard that silently does nothing or coerces to 0.

`--start-delay` is a grace period before the **first** pass: the handoff
detaches the driver from inside a pass that is still running its Release step,
and starting the next pass the same second would race that pass's
`--remove-label in-progress` calls.

**`--dry-run` always ends in `reason=no-progress` after 2 passes, by design.**
A dry run never lands anything (`claude` isn't actually invoked to do the
work), so the TOTAL open count and green-sha never move — the no-progress
guard is doing exactly its job. This is not a bug to fix; don't read it as
one.

## Dead passes — a pass that ends its turn waiting on a background job

Under `claude -p` the end of the turn IS the end of the process. There is no
later notification, so a pass that starts a gate in the background and closes
its turn saying it will resume when notified never resumes: the process exits
with the batch claimed and nothing released.

Observed 2026-08-17, four consecutive passes, whole transcripts of a few
hundred bytes each:

```
"Waiting on background push + full test baseline; both will notify when done."
"Push gate still running… Waiting for completion notification before claiming."
"Batch claimed (#2445, #1969, #1851, #1852)… waiting for that background job"
```

The queue read 200 → 196 across six passes and the driver stopped on
`no-progress`, which described the symptom and hid the cause.

**The tell is the size of the pass log.** A pass that did real work leaves
kilobytes — a receipt naming issues, PRs and gate counts. A few hundred bytes
means it died on its feet:

```bash
ls -la .claude/telemetry/loop-drain/
```

**The residue** is claims and worktrees nothing will release:

```bash
bun run loop:doctor        # claims with no branch and no PR; --release drops them
bun run wt:gc              # worktrees left behind; --yes removes the finished ones
```

`loop:doctor` holds a claim younger than two hours as `suspect` rather than
releasing it: no branch and no PR is also exactly what a HEALTHY pass looks
like between claiming its batch and pushing the first branch, and the sessions
share one GitHub account, so a wrong release unclaims live work.

**The rule this produced** is in the frame (§ Running unattended): in a headless
pass nothing waits on a background job. Redirect a gate to a file and read the
file — `deny-guard.sh` § 3 already forbids piping it into a pager, because the
pipeline's exit code would be the pager's.
