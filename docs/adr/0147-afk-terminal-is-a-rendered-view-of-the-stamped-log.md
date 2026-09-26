# The AFK terminal is a rendered view of the stamped log; a pass is bound to its transcript by `--session-id`

## Status

accepted — grilled 2026-09-26 (PRD #4717). Amends ADR 0099 and the issue
#4389 design of `scripts/loop-handoff.sh`: "the terminal and the file are
byte-identical" holds for the LOG only. First slice: issue #4721; the
`--session-id` binding ships with issue #4722.

## Context

`bun run loop:afk` runs the driver in the foreground (issue #4389) and pipes
everything through one stamper and one `tee`, so the terminal and
`.claude/telemetry/loop-afk.log` received the same bytes. That symmetry made the
terminal a raw log: every line read `YYYY-MM-DD HH:MM:SS loop-drain: …`, passes
ran into each other with no boundary, a warning looked like an informational
line, and the orphan-claim sweep took more room than the pass it followed. The
one screen an operator glances at while AFK did not answer _did the last pass
land, how much budget is left, is anything wrong?_

The log's plainness is load-bearing and must not move: `grep`, `tail`,
`loop:afk --status` read it, and the per-pass logs are grepped for the
rate-limit patterns.

## Decision

**The terminal is a rendered view of the stamped log.** The pipeline is
driver `2>&1` → stamper → `tee -a` the log → `{ renderer; cat; }`. The log is
written before the renderer sees a line, so it stays plain stamped text with
zero ANSI; the renderer (`scripts/loop-render.ts` around the pure
`scripts/lib/loop-render.ts`) turns each stamped line into a dim time column, a
fixed `│` gutter, glyphs in place of the source prefix, a rule around each pass
and a box around the run summary.

- **The renderer can never cost the run.** `{ renderer; cat; }` rather than
  `renderer || cat`: whenever the renderer stops reading — missing `bun`, a
  crash, a clean exit — `cat` drains the rest of the stream; with no reader,
  `tee` and then the driver would take SIGPIPE. A line that throws is printed
  raw with one `loop-render: degraded to plain — <err>` notice, and the rest
  of the stream passes through raw. `--plain`, `NO_COLOR` or a stdout that is
  not a TTY show the log's own lines. `--detach` is unchanged: nothing is
  rendered.
- **Classification is by tag, never by message text.** The driver writes a
  closed set of tagged prefixes — `loop-drain[<tag>]: …` with tag one of run,
  warn, error, pass, end, sweep, summary — and anything else is body text.
  A message can be reworded without moving a line into another class.
- **The pass-end line is new**, emitted right after the `loop-drain.log` row
  with the same facts as `k=v` words, plus the effective ceiling, the pass
  duration and the retry delay the row has no column for.
- **The date comes from the line's stamp, never the clock**, so a foreground
  run and a replay of the log (`--watch`, issue #4720) render identically.
- **A pass is bound to its transcript by `--session-id`.** The driver
  generates one UUID per pass, hands it to `claude -p --session-id`, and
  records it in the pass-start tag and in the `loop-drain.log` row, as a new
  field before `reason` (the rule the 9-field form followed, issue #3699).
  The live status line reads the transcript by that id; the binding is exact,
  never guessed from which session mentions the issue.

## Consequences

- The `loop-drain summary:` line is now `loop-drain[summary]:` and carries
  `duration=` (and `ceiling=` when budgeted). Nothing parsed the old prefix.
- Every later terminal feature — sweep collapse (issue #4718), markdown and
  wrapping (issue #4719), `--watch` (issue #4720), the status line (issue
  #4722) — extends the one pure `render(state, line, env)` core.
- A new structured line is a new tag in `DRIVER_TAGS`, not a new regex.

## Rejected alternatives

- **Colour inside the driver.** ANSI would land in the log that `grep`,
  `tail` and `--status` read, across about 40 scattered `echo` sites, and a
  `--detach` log would carry escape codes nobody sees rendered.
- **`claude -p --output-format stream-json`.** It would give structured pass
  events, but it changes the per-pass log that rate-limit detection greps,
  and turns the pass's own summary into JSON the log would then carry.
