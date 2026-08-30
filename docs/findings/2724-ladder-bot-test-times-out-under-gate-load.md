---
title: ladder.bot.test.ts's cross-game isolation case times out at 60s when the gate runs it alongside everything else
discoveredBy: 2724
status: fixed
confidence: medium
---

**What is wrong.** `check:pr`'s bot lane failed once on a diff that touches no
bot code, on a 60s vitest timeout rather than an assertion. The same file passes
in isolation, where the case takes ~80s of the file's 132s — i.e. it is already
over the default `testTimeout` on its own and only passes because a lightly
loaded machine gets it under the wire. On a machine running several sessions it
is a coin flip, and it fails as a red gate on an unrelated PR.

**Evidence.** `src/lib/ai/selfplay/ladder.bot.test.ts:158` — `each spec's
outcome is independent of the order games are played in`; the failure was
`Error: Test timed out in 60000ms` after 79601ms inside `check:guards`
(`TOLARIA_BOT_FAST=1 vitest run --project bot-node --project bot-dom`). An
isolated `bunx vitest run src/lib/ai/selfplay/ladder.bot.test.ts` on the same
tree: `Tests 11 passed`, `Duration 132.42s`, tests 112.87s.

**Why it may not deserve its own issue.** It is one line — an explicit
`{ timeout: … }` on that `it` — and might be better folded into whatever bot
ticket next touches the ladder, or fixed by shrinking the three-game replay the
case plays rather than by raising the ceiling. It is also possible the machine
was unusually loaded and the real headroom is larger than one sample suggests.
It also overlaps
`docs/findings/2743-recurring-ladder-contention-during-measurement.md`, which
records that this machine runs long `ladder.ts` jobs most of the time — so the
"unusually loaded" case may simply be the normal one, and the fix may belong to
whoever owns that contention rather than to this test. What makes it worth
recording is the failure MODE: a red `check:pr` on a
frontend-only diff reads as "my change broke the bot" and costs a debugging
detour before anyone notices it is a timeout.

**Resolution.** Fixed in PR #2955 by giving the `it` an explicit 300s
timeout: the test measures order-independence, never speed, so the default 60s
bound was only ever a false-positive red on a loaded machine.
