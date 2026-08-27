---
title: A decision-tier ladder verdict is unreachable for a headless agent — every game longer than the tool timeout can never complete
discoveredBy: 2684
status: draft
confidence: high
---

**What is wrong.** Several tickets (this one included) make "paste the
`--tier decision` ladder verdict block" an acceptance criterion, and
`.claude/hooks/deny-guard.sh` correctly forbids backgrounding `bun run ladder`
(it reaches `scripts/gate.ts`, so its exit code must be read). But a headless
agent's foreground command ceiling is 10 minutes, and a decision-tier R0 run is
~4–5 hours by the plan's own estimate. `--resume` makes the run crash-safe, so
the obvious loop is "run a 10-minute chunk, resume, repeat" — and that loop has
a floor it cannot cross: **any individual game that takes longer than one chunk
is restarted from scratch every chunk and can never be recorded.**

**Evidence.** Measured 2026-08-26 on this machine (8 cores), variant
`action-priors`, `--tier decision --rung R0`:

| chunk | workers | games completed | cumulative |
| ----- | ------- | --------------- | ---------- |
| 1–5   | 7       | 6, 6, 4, 7, 4   | 27/240     |
| 6–9   | 7       | 8, 4, 2, 1      | 41/240     |
| 10    | 4       | **0**           | 42/240     |
| 11    | 14      | 3               | 45/240     |

Individual game durations printed by `formatLiveLine` ranged 62 s to 542 s. The
short games drained out of the plan in the first few chunks; what remains are
games that exceed the ceiling, which is why the yield decays toward zero rather
than staying flat. Dropping to `--workers 4` — which gives each game MORE cpu —
completed nothing at all, because the pool hands each worker a static
round-robin slice of the remaining plan, so with 4 workers all four slots sat on
the four slowest remaining games; raising it to 14 (oversubscribed) helped only
because later workers reach faster pairings. Roughly half of every chunk's
worker-time is also discarded outright as in-flight games at the kill.

**Why it may not deserve its own issue.** It is a harness constraint, not an
engine bug, and there are cheap dispositions that need no code: an orchestrator
running interactively has no 10-minute ceiling and can simply run the ladder
itself, so the answer may be "a decision-tier verdict is never an implement
subagent's job — the ticket should ask for the run FILE and let the orchestrator
render the block". If it does deserve code, the two candidates are a
`--deadline <seconds>` flag that makes the runner exit cleanly with its verdict
block before the ceiling (turning chunking into a supported mode rather than a
kill), and a per-game turn cap so no single game can exceed a chunk. Either is a
separate ticket from any bot-strength work.
