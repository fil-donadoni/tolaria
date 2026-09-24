---
title: Merging test:bot into the test:app invocation saves 10–20 s and gives up the documented uncontended bot run — rejected
discoveredBy: 4480
status: declined
confidence: high
---

**What is wrong.** `bun run test` runs `test:app`, `test:bot` and `test:blade`
as three vitest invocations under one mutex, each paying its own transform
and worker start-up. Sharing one invocation would save an estimated 10–20 s.

**Evidence.** `package.json` scripts; measured walls 2026-09-24 (app 354 s at
load 18, bot 85 s, blade 322 s); `docs/agents/quality-gates.md` on the bot
run's separation.

**Why declined.** The separate bot invocation is deliberate: the bot suite's
timings are read on their own, uncontended by the dom project, and its
worker/timeout profile differs (60 s timeouts, `TOLARIA_BOT_FAST`). The
saving is below the noise floor of a loaded machine. PRD #4480 takes the
sequencer and the blade shard instead.
