# The AFK driver — `bun run loop:drain`

<!-- Loaded on demand by .claude/skills/process-gh-issues/SKILL.md — not part of the frame. -->

Entered when setting up or debugging continuous unattended draining (§ Running
unattended). Full rationale: ADR 0097.

---

`loop:drain` (`scripts/loop-drain.sh`) is a POSIX `sh` loop around a fresh
`claude -p "/process-gh-issues"` per pass — the "Ralph" pattern. It never
re-uses a conversation, so it never trips the deny-guard `/loop` trips.

## Stop reasons

Checked in this order before every pass; the pass log and `.claude/telemetry/loop-drain.log`
record which one fired:

| Reason        | Meaning                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stop-file`   | `.claude/telemetry/loop-stop` exists — `touch` it to stop the driver after the current pass finishes (the kill switch for a run in flight)                       |
| `max-passes`  | `--max-passes` reached                                                                                                                                           |
| `budget`      | the local-proxy token pct crossed `--max-pct` (disabled, and said so once at startup, when no budget is configured)                                              |
| `queue-empty` | no unclaimed `ready-for-agent` issues left — the ordinary, healthy end of a run; do not poll aggressively, a human must refill the queue                         |
| `rate-limit`  | the pass output matched a rate-limit/usage-limit shape, or `claude` exited non-zero — stops and reports rather than sleeping until reset                         |
| `no-progress` | 2 consecutive passes with neither the queue count nor `.claude/telemetry/green-sha` moving — a batch failing identically every time would otherwise spin forever |

A red baseline the pass itself did not cause (§0b row 3) is reported and
surfaced by the pass, not detected by the driver — a subsequent pass keeps
reporting it, so treat repeated `no-progress` stops as the signal to go read
the pass log under `.claude/telemetry/loop-drain/`.

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
class (fail expensive), never the cheapest.

## Permissions

A truly unattended pass needs a permission mode or the first tool prompt
blocks forever with nobody watching. The driver never defaults this — it is
security-relevant and is the user's call — and warns once at startup when
`--claude-args` is empty:

```sh
bun run loop:drain \
  --budget 2000000 --max-pct 80 \
  --claude-args '--dangerously-skip-permissions'
```

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
