---
title: dry-run echo in loop-drain.sh still omits TOLARIA_LOOP_DRAIN=1
discoveredBy: 2622
status: draft
confidence: low
---

**What is wrong.** The dry-run echo at `scripts/loop-drain.sh:388` prints the
`claude -p ...` invocation a pass _would_ run, but never included
`TOLARIA_LOOP_DRAIN=1` — only the real invocation (line 424) sets it. #2622
fixed the same class of drift for the new
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` prefix (the dry-run line now carries
it), but left the pre-existing `TOLARIA_LOOP_DRAIN=1` gap alone — it predates
this issue and isn't part of its acceptance criteria.

**Evidence.** `scripts/loop-drain.sh:409` (pre-#2622; now line 424) has always
set `TOLARIA_LOOP_DRAIN=1` on the real invocation; line 388's dry-run string
has never mentioned it (confirmed by reading the file at the tip of `main`,
890daab0, before this issue's change).

**Why it may not deserve its own issue.** `TOLARIA_LOOP_DRAIN` only changes
whether the pass's own end-of-pass handoff (`scripts/loop-handoff.sh`)
detaches a second driver — it has no user-visible effect a `--dry-run` reader
would need to see to judge what a real run "would do" (unlike the background
ceiling, which changes whether long subagent work survives). A one-line fix
if someone wants exact fidelity; low value on its own.
