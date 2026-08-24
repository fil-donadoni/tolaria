---
title: an --accept= token that names no actual diff is silently ignored
discoveredBy: 2673
status: draft
confidence: low
---

**What is wrong.** `recordBudgets`/`planRecord` (`scripts/ui-gate/index.ts`,
`scripts/ui-gate/budgets.ts`) only consult `accepted.has(token)` while walking
an actual regression/tightening it found. A token in `--accept=` that never
matches anything this run measured — a typo'd surface id, a stale key from a
previous invocation, a viewport that came back clean this time — is silently a
no-op. The author gets no signal that half of what they typed on the command
line did nothing.

**Evidence.** `scripts/ui-gate/budgets.ts` `planRecord`: the loop only reads
`accepted.has(token)` from inside the per-key diff branch; nothing in
`RecordPlan` reports which tokens in the input `accepted` set were never
consulted.

**Why it may not deserve its own issue.** `--accept=` is a brand-new flag with
no users yet, and the failure mode is "did less than intended," not "did
something wrong" — the refusal-by-default behavior this issue (#2673) adds
means an unconsumed token just leaves the number at its safer, unchanged prior
ceiling. Worth a one-line "unused --accept token(s): …" warning in
`recordBudgets`'s output if a future PR touches this file again; not urgent
enough to justify a dedicated ticket today.
