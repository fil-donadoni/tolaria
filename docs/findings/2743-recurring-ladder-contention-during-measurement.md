---
title: A quiet measurement window is hard to hold — heavy ladder.ts jobs recur every ~15-20 minutes on this machine
discoveredBy: 2743
status: draft
confidence: medium
---

**What is wrong.** #2738's comment 5394668153 asked #2743 to re-measure the
`skin`/`engine` lanes on a quiet machine, since both prior measurements were
taken while a 7-worker `ladder.ts --tier decision` job saturated the CPU. The
instructions handed to this issue's implementer stated "the machine is quiet
right now (load ~1.6, ladder finished at 15:21)". By the time the implementer
reached the measurement step (~15:37, sixteen minutes later), a **new**
`ladder.ts --tier decision --variant placebo` job (pid 82015+, 7-8 workers at
~90% CPU) was already running, and stayed running continuously through at
least 15:48 — load average climbing from ~9.6 to ~25 over that window.

**Evidence.** `ps aux | grep ladder` at 15:37 showed 7 `ladder/worker.ts`
processes already 5+ minutes into their run; `uptime` climbed from load
average 9.62 at 15:37 to 25.42 at 15:44. This is the second time in one PRD
(#2738) that a "the machine is quiet, go measure" instruction was stale by the
time the measuring session reached the step — the first time produced the
contended 343.3s/275.2s figures #2743 was asked to correct.

**Update — waited it out, it did not clear.** The implementer polled
`uptime`/`pgrep -f ladder/worker.ts` every ~7-8 minutes from 15:37 through
16:12 (five checks, ~35 minutes total): 8 workers stayed alive the entire
window, per-worker accumulated CPU time climbing past 38 minutes each by
16:12, load average oscillating 9.6–25.4 the whole time with **no sustained
drop**. A fourth concurrent user/session joined partway through (`uptime`
`users` count went 3→4). Rather than measure under this and mislabel the
result "quiet" — the exact mistake #2738's comment flagged — the implementer
left the `skin`/`engine` quiet figures **unverified** in
`docs/agents/quality-gates.md` and recorded this evidence instead. The quiet
re-measurement is still owed; it just could not be produced inside one
session against a machine that was contended for the entire session.

**Why it may not deserve its own issue.** This is an operational/scheduling
observation about how AFK loop sessions and `ladder.ts` heavy runs share this
one machine, not a code defect — there is nothing to fix in this repo's
source. It may already be exactly what the PRD's "amortising the merge-train"
out-of-scope note and the general CPU-admission-control design
(`scripts/gate.ts`) are meant to bound, in which case it is already tracked
implicitly. Worth a line in `docs/agents/quality-gates.md` or the AFK-driver
docs only if a maintainer decides recurring-contention windows are worth
scheduling around (e.g. a `ladder.ts` cron slot that avoids the hours agents
are known to run measurement-sensitive work) — otherwise `declined` is a
reasonable outcome.
