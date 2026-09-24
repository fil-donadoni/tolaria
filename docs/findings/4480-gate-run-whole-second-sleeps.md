---
title: gate-run.sh sleeps in whole seconds by construction, so its tests spend 38 s waiting
discoveredBy: 4480
status: draft
confidence: high
---

**What is wrong.** `scripts/gate-run.sh` polls and waits with integer shell
arithmetic (`sleep 1`-granularity), so `scripts/__tests__/gate-run.test.ts`
(15 tests, 38 s measured 2026-09-24) spends most of its wall in deliberate
whole-second waits, and the driver itself cannot poll faster than 1 s.

**Evidence.** `scripts/gate-run.sh` (`POLL_SECS`, `WAIT_SECS`, the wait loop);
per-test durations in the session's `vitest-node.json` (5.6 s and 5.2 s for
the "run outlives the call" cases).

**Why it may not deserve its own issue.** A millisecond knob means either
`sleep 0.2` (not POSIX `sh`) or a bun helper inside a shell driver whose whole
point is surviving the tool's process death; 38 s spread over 4 workers is
~10 s of wall on a tooling-only diff. Take it only if PRD #4480's tooling
ticket (#4485) leaves `gate-run` as the largest scripts file.
