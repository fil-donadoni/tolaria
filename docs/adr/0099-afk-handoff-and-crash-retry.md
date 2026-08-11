# A finished pass hands off to a detached driver, and a crash is retried

## Status

accepted

## Context

ADR 0097 built `scripts/loop-drain.sh`: an out-of-process `sh` loop that can
run `/process-gh-issues` pass after pass unattended. What it did not build is
anything that **starts** it. In practice the loop was therefore still driven by
a human typing a command per session: `/process-gh-issues` runs exactly one
batch (`MAX_PASSES = 1`, enforced by the skill and by
`.claude/hooks/deny-guard.sh`) and exits, so every invocation stopped at the
end of its batch and waited for a person. The observed symptom, in the user's
words: "ti blocchi ad ogni batch completato."

Two things stood between "the driver exists" and "the machine drains the queue
for hours on its own".

**Nothing launched the driver, and nothing kept it alive.** A driver started
from a Claude Code session's shell is a child of that session: it dies with the
terminal, with the SSH connection, or when the process group is signalled. And
a Mac that goes to sleep stops an overnight run as effectively as a crash.

**A single crash ended the run.** ADR 0097 stopped on `claude-error` — any
non-zero `claude` exit with no rate-limit-shaped message. Over a multi-hour
unattended window that is the difference between "drained the queue" and
"stopped at 01:12 on a transient failure and idled until morning".

A third question came with the first: an unattended pass needs a permission
mode (`--dangerously-skip-permissions`) or it blocks on the first tool prompt
with nobody watching. ADR 0097 deliberately refused to default that, since it
is security-relevant. But the feature being asked for here is precisely "a
finished pass starts the next one with no human in the loop", so the choice has
to be recorded _somewhere_ durable rather than typed each time.

## Decision

**`scripts/loop-handoff.sh` (`bun run loop:afk`) is the AFK entry point**, and
it works from both ends:

- A human runs `bun run loop:afk` once and walks away.
- Every `/process-gh-issues` pass ends with `sh scripts/loop-handoff.sh
--from-pass` (SKILL.md §4, last step), so the machine keeps going even if the
  driver itself died.

**The driver is detached into its own session.** `perl`'s `POSIX::setsid()`,
plus `nohup`, plus `caffeinate -i -s` (opt out with `--no-caffeinate`): the run
outlives the shell, terminal and Claude Code process that started it, is not
killed by a process-group signal aimed at that parent, and the machine stays
awake for it.

**Arming is a separate, durable, revocable human act.** The end-of-pass handoff
no-ops unless `.claude/telemetry/afk.conf` exists. That file records the
permission mode the unattended passes will use, in plain text, so it can be
read, audited and deleted (`--disarm`); it is **parsed, never sourced or
`eval`'d**, because an unattended process reads it and then runs `claude` with
what it finds. `--start`/`--resume` write it and warn loudly on stderr when the
recorded mode auto-approves every prompt. An ordinary interactive pass on an
unarmed checkout therefore behaves exactly as before.

**Three more no-op conditions keep the fan-out sequential and stoppable**, all
of them quiet exit-0s (a handoff that cannot start must never fail a batch that
just merged PRs): the pass was itself started by the driver
(`TOLARIA_LOOP_DRAIN=1`, exported into every driven pass — without it each pass
would fork its own driver and the fan-out would be exponential); a driver is
already running over this checkout (a pid file, checked with `kill -0` so a
killed driver leaves no stale lock, enforced as a lock by the driver's own
`--single-instance`); or the stop-file exists. The driver also takes a
`--start-delay` (45s from the handoff) so pass N+1 does not race pass N's
Release step, which is still removing `in-progress` labels when the handoff
fires.

**A `claude` crash is retried with a doubling backoff, bounded consecutively.**
`--max-consecutive-errors` (default 3), `--error-backoff-secs` (default 60,
doubling, capped by `--error-backoff-max-secs`). Any pass that does not crash
resets the streak, so the bound is on _consecutive_ failures: a flaky
environment cannot spin forever, and a genuinely broken one still stops with
`claude-error` exactly as before. Retries are logged with a new, non-terminal
reason `claude-retry`. The backoff sleeps in short chunks and re-checks the
stop-file each one — a kill switch that only works between passes is not a kill
switch. `--max-consecutive-errors 1` restores ADR 0097's behaviour exactly.

**A rate limit is still never retried.** ADR 0097's reasoning is unchanged and
was re-confirmed when this was decided: there is no supported way to read
Anthropic's quota or its reset time from this machine, so any backoff would be
a guess. `rate-limit` stops the run on the first occurrence regardless of the
crash-retry budget — the two are deliberately different failures with different
policies, which is why 0097 split the reasons in the first place.

## Consequences

- One command (`bun run loop:afk`) starts an unattended run that survives the
  session that started it; `bun run loop:afk --status` / `--stop` are the
  supervision surface. `bun run loop:drain` stays the foreground driver for a
  terminal a human is watching.
- The end-of-pass handoff makes the loop self-sustaining: even if the driver
  process is killed, the next pass that completes on an armed checkout starts a
  new one.
- An armed checkout is a standing authorisation to run `claude` with the
  recorded permission mode until someone disarms it. That is the point, and it
  is why arming is a file a human writes rather than a state inferred from a
  pass having finished.
- `claude-error` in the telemetry log now means "the retries ran out", not "one
  crash happened". A run that recovered leaves `claude-retry` lines behind, so
  a flaky night is still visible the next morning instead of being smoothed
  away.
- The stop-file remains the kill switch and is still never cleared
  automatically — `bun run loop:afk --resume` is the explicit way to clear it
  and start again.

## What would change the answer

If a supported quota endpoint appears, the `rate-limit` reason becomes
retryable on a real reset time rather than a guessed one — that is ADR 0097's
revisit trigger, and it is the only thing that should move the
never-sleep-on-a-rate-limit rule.

If `claude` grows a supervised daemon mode (a long-lived process that accepts
successive prompts with a context reset between them), the process-per-pass
shape and most of this script become unnecessary — the reset, not the process,
is what the design needs.

## Alternatives considered

**Default the permission mode in the driver and skip arming.** Rejected: every
`/process-gh-issues` run — including a casual interactive one — would then fork
a detached, auto-approving, hours-long run. The marker file is what separates
"the user asked for an AFK run" from "a pass happened to finish".

**Let the pass itself loop instead of handing off.** Rejected, and this is ADR
0097's core point restated: the context reset between batches IS the
cost-containment mechanism, and the deny-guard enforces it.

**`launchd` / a cron job instead of a detached process.** Rejected as heavier
than the problem: a `launchd` plist is machine state outside the repo, needs
install/uninstall steps, and buys nothing over `setsid` for a run the user
starts and stops by hand. Re-evaluate if the run should survive a reboot.

**Retry a crash indefinitely.** Rejected: an unattended loop that retries
forever on a broken tree burns tokens all night to accomplish nothing. The
bound is on consecutive failures precisely so that progress, not elapsed time,
is what buys more attempts.
