# The AFK driver is an out-of-process shell loop, and its budget guard is a local proxy

## Status

accepted

## Context

ADR 0092 settled that `/process-gh-issues` stays a single model-driven pass,
not a `Workflow` script, and named a dependency it did not build: **the AFK
driver**, the thing that turns "run one pass" into "keep draining the queue
unattended." That gap has stayed open because the obvious in-session tool
does not work for it. `.claude/hooks/deny-guard.sh:180-211` denies a second
`bun run queue:plan` inside the same conversation — by design, since
`MAX_PASSES = 1` and the pass's own context reset IS the cost-containment
mechanism (SKILL.md § Running unattended). `/loop` re-fires its prompt in the
SAME conversation, so context never resets between iterations and the
deny-guard kills pass 2 on the first re-invocation. No driver script existed
anywhere in `scripts/` or `~/.claude` before this change.

Two decisions were needed to close the gap: where the driver lives (in- or
out-of-process), and how it decides "burning too much money" without a real
quota API to read.

**On the quota question**: there is no supported way to read Anthropic's
actual usage/quota from this machine. Checked and absent: a `claude usage`
subcommand, anything under `~/.claude/config.json`, `daemon.status.json`, or
`stats-cache.json`, and the session transcripts themselves — `/usage` is
interactive-only. What IS on disk is Claude Code's own JSONL transcript per
session (`~/.claude/projects/<slug>/<session-id>.jsonl`, ~2GB across 678
files on this machine), and every assistant message line in it carries
`.message.usage` with real per-message token counts.

## Decision

**The driver is an out-of-process POSIX `sh` loop** (`scripts/loop-drain.sh`,
`bun run loop:drain`) around a fresh `claude -p "/process-gh-issues"` per
pass — the "Ralph" pattern. All the state a resumed pass needs already
crosses a process boundary without help: the `in-progress` GitHub label, the
branch/PR, and `.claude/telemetry/green-sha` (the same table SKILL.md § Running
unattended already documents). The driver adds nothing to that table; it only
decides, before each pass, whether to start another one, and stops on one of
eight named reasons: `stop-file` (a user kill switch — `touch
.claude/telemetry/loop-stop`), `max-passes`, `budget`, `usage-error` (the
budget guard is configured but its pct reading came back unparsable — the
guard FAILS CLOSED here, stopping exactly like `budget` rather than skipping
the check and running the pass anyway), `queue-empty`, `rate-limit` (detected
from the pass transcript matching a rate-limit-shaped message), `claude-error`
(a non-zero `claude` exit with NO such message — a crash, a bad
`--claude-args` string, a hook denial; kept distinct from `rate-limit` so the
one telemetry field a human reads doesn't conflate an ordinary failure with a
real usage limit), and `no-progress` (2 consecutive passes where neither the
TOTAL open `ready-for-agent` count nor `green-sha` moved — measured on the
total, not the unclaimed count, because claiming an issue alone drops the
unclaimed count without landing anything, which would otherwise look like
progress and reset the streak forever).

This is the same shape ADR 0092 already accepted as a dependency, made
concrete: a single orchestration layer per pass (the skill, model-driven,
unchanged), with a second, much dumber layer outside it that only starts and
stops processes. It does not attempt any of ADR 0092's four adaptive points
(collision back-off, stall probing, red-baseline triage, hand-back-vs-WIP) —
those stay inside the pass, exactly where 0092 left them. The driver's whole
job is the one thing a fresh process can do that a resumed conversation
cannot: reset context to zero for free.

**The budget guard is a LOCAL PROXY, not a quota reading, and the code and
docs say so in those words.** `scripts/lib/usage-window.ts` sums the
top-level usage fields per transcript line — deliberately never
`usage.iterations[]`, which repeats the same numbers under the same field
names and would double-count every line if also summed — into per-model
totals over a trailing window, then weights each category by an explicit,
overridable table (`DEFAULT_WEIGHTS`) anchored on relative list price (opus
output priced far above sonnet output; a cache write slightly above a fresh
input token; a cache read an order of magnitude below). An unrecognised model
string classifies as the MOST expensive known class, never the cheapest —
fail expensive, so a future model the table has never heard of cannot look
artificially cheap and keep an unattended loop running past its real spend.
The resulting percentage is compared against a budget the user declares
(`--budget` / `TOLARIA_LOOP_TOKEN_BUDGET`); a budget of zero or unset
disables the guard outright, and the driver says so once at startup rather
than silently skipping it forever.

## Consequences

- `bun run loop:drain` is a real, tested entry point; SKILL.md § Running
  unattended no longer points at `/loop`, which cannot drive this loop.
- The budget percentage this script reports must never be read as "percent of
  my Anthropic quota used." It is a same-machine, same-user relative-burn
  estimate against a number the user picked. Nothing here talks to
  Anthropic's billing or rate-limit systems.
- The rate-limit stop reason is the backstop for the case the budget proxy
  cannot catch (a quota that resets on a schedule the proxy doesn't model, or
  simply being wrong) — the driver stops and reports rather than assuming its
  own estimate was right.
- Once a budget IS configured, an unreadable pct reading is never treated as
  "the guard is off for this pass" — it stops the run (`usage-error`), the
  same as tripping the budget itself. A budget opted into and then silently
  un-enforced (the reader missing from `PATH`, a malformed `--budget` value)
  is a worse failure than a loud stop, because nothing else would have caught
  it before the spend did.
- A truly unattended run still needs an explicit permission mode
  (`--claude-args '--dangerously-skip-permissions'` or equivalent); the
  driver never defaults this, since it is a security-relevant choice, and
  warns once when it's omitted.

## What would change the answer

If a supported usage/quota endpoint appears (a `claude usage` subcommand, an
API the CLI exposes, anything that returns Anthropic's own accounting), that
is what should replace `usage-window.ts`'s weighting table — not a
better-tuned version of the proxy. The proxy's job was always "best available
signal," not "the right one."

If ADR 0092's revisit triggers fire (a workflow journal that survives a
process boundary, or the adaptive points reducing to tables), the pass itself
may grow an in-session hybrid loop for its implement→review phase — that is
orthogonal to this decision. The AFK driver's job stays the same either way:
start a fresh pass, stop for a documented reason, never guess quietly.

## Alternatives considered

**Drive it with `/loop`.** Rejected — this is the bug being fixed, not an
alternative. `/loop` keeps the conversation alive, so the deny-guard denies
`queue:plan` on the second iteration and the loop never gets past pass 1.

**Poll `ctx.scheduler` / a Convex cron for the outer loop.** Rejected: the
driver needs to launch and supervise an OS process (`claude -p`) and read
local transcript files under `~/.claude/projects` — neither is reachable from
inside Convex, and routing pass output through the backend to get there would
add a second transport for something a five-line `sh` loop already does
directly.

**Sleep-and-retry on rate limit instead of stopping.** Rejected per explicit
user instruction: the driver reports and exits non-zero on a detected rate
limit rather than guessing a backoff/reset window it has no reliable way to
learn (see the quota-API absence above — there is nothing to poll to know
when a limit clears).
