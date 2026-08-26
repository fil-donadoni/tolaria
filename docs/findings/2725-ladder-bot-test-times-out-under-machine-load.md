---
title: ladder.bot.test.ts's cross-game isolation test fails as a 60s wall-clock timeout under machine load
discoveredBy: 2725
status: draft
confidence: high
---

**What is wrong.** `each spec's outcome is independent of the order games are
played in` plays nine full self-play ladder games inside one `it`, against
vitest's default 60s `testTimeout`. On a loaded machine it does not fit: it
failed twice inside `bun run check:lane` (reported 68262ms on the first run) and
passed standing alone on the same tree seconds later, 11/11. The failure is a
wall-clock timeout, never an assertion — so it reads in the log exactly like a
real red, on a suite the reader has no reason to think is timing-sensitive.

**Evidence.** `src/lib/ai/selfplay/ladder.bot.test.ts:158` — `playInOrder` is
called three times, each replaying `SPECS.length` games, with no explicit
timeout argument. Measured 2026-08-26 on this machine at load average 37.6 (five
sessions sharing it): red inside the lane, green in isolation, on commit
`fc69a303`, whose diff touches no bot, GRE or AI file.

**Why it may not deserve its own issue.** It may be one line — an explicit
`60_000 * N` timeout on that `it`, or splitting the three orders into three
tests — in which case it belongs to whoever next opens the file rather than to a
ticket. It is worth writing down anyway because the failure mode is a
false-positive RED on an unrelated PR's gate, which is exactly the shape that
teaches people to re-run the lane instead of reading it (#2512's argument
against a flapping ceiling, one level up).
