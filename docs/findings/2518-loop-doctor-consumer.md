---
title: "`bun run loop:doctor` does not exist — the plan-mismatch flag has no aggregate reader yet"
discoveredBy: 2518
status: draft
confidence: high
---

**What is wrong.** #2518's acceptance criteria say a claim/plan mismatch is
"flagged — loudly in the ledger and in `bun run loop:doctor`". This PR
delivers the ledger half: `claims.jsonl` rows now carry `plan` (the plan
artefact in force for the session, or `null`) and `planMismatch` (`{claimed,
planned}` when the claimed issue was not in that plan's admitted batch), and
`claim-ledger.sh` also prints the mismatch to stderr in real time. There is no
`loop:doctor` script anywhere in `package.json` or `scripts/` today — it is
named in the issue as an existing consumer, but it does not exist.

**Evidence.** `grep -n '"loop:' package.json` shows `loop:scorecard`,
`loop:drain`, `loop:afk` — no `doctor`. `grep -rl loop:doctor .` (repo-wide)
returns nothing outside the #2518 issue body itself.

**Why it may not deserve its own issue yet.** The data this PR writes
(`plan`, `planMismatch` on every claim row) is exactly what a future
`loop:doctor` would read — the schema is intentionally self-describing (a
`jq 'select(.planMismatch != null)'` over `claims.jsonl` already answers "which
claims diverged from their plan" with no new tooling). Whether `loop:doctor`
becomes its own script, folds into `loop:scorecard`, or stays a one-line `jq`
recipe documented in a guide is a product decision, not a gap this slice left
half-built — the target-files list for #2518 (`scripts/queue-plan.ts`,
`scripts/lib/queue-plan.ts`, `.claude/hooks/claim-ledger.sh`, the two test
files) never included a doctor script, so building one was out of this PR's
declared scope.
