# A pass never starts the driver, and the driver's token budget is mandatory

## Status

accepted (supersedes the `--from-pass` autostart of ADR 0099)

## Context

ADR 0099 made the end of every `/process-gh-issues` pass run
`sh scripts/loop-handoff.sh --from-pass`, which detached a `loop:drain`
driver whenever `.claude/telemetry/afk.conf` existed. Arming was designed as
"a deliberate, durable, revocable human act" — but durability is exactly what
made it fail: the conf survives for weeks, long after the intent behind it is
gone. The observed failure mode, repeatedly: the user launches ONE
interactive `/process-gh-issues`, and at the end of that pass a background,
permission-auto-approving, potentially multi-day driver forks itself off a
stale conf — a costly unattended run nobody asked for that day.

Compounding it, the driver's token-budget guard was **opt-in**
(`--budget` / `TOLARIA_LOOP_TOKEN_BUDGET`, unset → guard disabled with a
one-line warning). Every launch after 2026-08-23 omitted it —
`.claude/telemetry/loop-drain.log` shows `pct=n/a` on every pass from
1787612507 on, where earlier passes logged 67–70%. The two defects met in the
2026-08-25→27 incident: ~91% of the Max subscription's weekly allowance burnt
in 48 hours (~$12k API-equivalent per 72h measured from transcripts), with
the guard silently off.

The general lesson is the same one CLAUDE.md already records for gates: a
safety that depends on someone remembering to enable it is not a safety.

## Decision

1. **A pass NEVER starts the driver.** `loop-handoff.sh --from-pass` is a
   dead switch: unconditional exit-0 no-op, detaches nothing, whatever the
   conf says. It is kept (rather than deleted) only so older prompts and
   transcripts that still call it stay harmless. Unattended runs begin ONLY
   with an explicit human `bun run loop:afk --start` / `--resume`, or a
   foreground `bun run loop:drain`, typed in a terminal. The driver still
   launches its own subsequent passes — that is the driver process itself,
   not a new start.
2. **`afk.conf` is demoted to stored defaults for `--start`.** `--arm` /
   `--disarm` remain as conf editors; the conf no longer causes anything to
   run on its own.
3. **The token budget is mandatory.** `loop-drain.sh` refuses to start
   (exit 1) without `--budget` / `TOLARIA_LOOP_TOKEN_BUDGET`; the handoff's
   `--start` refuses first, loudly, rather than detaching a driver that dies
   into a log nobody watches. The only exception is the test-only hatch
   `TOLARIA_LOOP_ALLOW_NO_BUDGET=1`, which exists for the driver's own suite
   and announces itself on stderr; never set it for a real run.

## Consequences

- One command = one pass. Draining the queue for hours is always an explicit
  choice, made with a budget attached, revocable with `--stop`.
- The fail-closed pct guard of ADR 0097 now always runs; `usage-error` and
  `budget` stops cannot be bypassed by forgetting a flag.
- An armed-then-forgotten checkout can no longer surprise anyone: the worst a
  stale `afk.conf` can do is pre-fill flags the human sees echoed at
  `--start`.
- Guarding tests (proven red under mutation): `loop-handoff.test.ts`
  ("a pass NEVER starts the driver", "budget is mandatory on --start") and
  `loop-drain.test.ts` ("REFUSES to run when no budget is configured").
