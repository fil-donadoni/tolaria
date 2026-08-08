# The AFK driver — `bun run loop:drain`

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered when setting up or debugging continuous unattended draining (§ Running
unattended). Full rationale: ADR 0097.

---

`loop:drain` (`scripts/loop-drain.sh`) is a POSIX `sh` loop around a fresh
`claude -p "/process-gh-issues"` per pass — the "Ralph" pattern. It never
re-uses a conversation, so it never trips the deny-guard `/loop` trips.

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
| `rate-limit`   | the pass transcript matched a rate-limit/usage-limit shape — stops and reports rather than sleeping until reset                                                                                                                                                                                                    |
| `claude-error` | `claude` exited non-zero with NO rate-limit-shaped message in the transcript — a crash, a bad `--claude-args` string, a hook denial, or anything else. Kept distinct from `rate-limit` so the one telemetry field a human reads isn't misread                                                                      |
| `no-progress`  | 2 consecutive passes with neither the TOTAL open `ready-for-agent` count nor `.claude/telemetry/green-sha` moving. Deliberately NOT the unclaimed count — a pass that only CLAIMS issues (adds `in-progress`) drops the unclaimed count without landing anything, which would otherwise look like progress forever |

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

| Flag             | Env fallback                | Default                        |
| ---------------- | --------------------------- | ------------------------------ |
| `--budget`       | `TOLARIA_LOOP_TOKEN_BUDGET` | unset (guard disabled)         |
| `--max-pct`      | —                           | `80`                           |
| `--window-hours` | —                           | `5`                            |
| `--max-passes`   | —                           | `0` (unlimited)                |
| `--stop-file`    | —                           | `.claude/telemetry/loop-stop`  |
| `--claude-args`  | —                           | empty (warns; see Permissions) |
| `--dry-run`      | —                           | off                            |

All of `--max-passes`, `--max-pct`, and `--budget` are validated as numeric
at startup — a non-numeric value (a typo, a suffix like `2M`, a separator
like `2_000_000`) is a loud `exit 2`, never a guard that silently does
nothing or coerces to 0.
