---
title: loop:status and the dashboard render claim verdicts that omit owner liveness
discoveredBy: 2627
status: draft
confidence: medium
---

**What is wrong.** `ClaimFacts` grew an `ownerAlive` fact in #2627 (the claim's
owning OS process, recorded at claim time by `claim-ledger.sh`). `loop:doctor`
gathers it; the verdict engine does not. So the same claim can be `orphan` in
`bun run loop:doctor` and `live` in `bun run loop:status` / the dashboard — the
opposite of why `classifyClaim` was extracted and shared in the first place
(#2519/#2624: "imported rather than re-derived", so the two cannot diverge).

Practically the divergence is narrow and always in the SAFE direction — the
status view under-reports liveness, never over-reports it — because
`ownerAlive` can only move a verdict towards `live`. An operator reading the
dashboard sees an amber claim that `loop:doctor` has already decided to hold.

**Evidence.** `scripts/lib/loop-status.ts:677-683` calls
`buildClaimFacts(issue, input.prBranches, input.branches, now)` — four
arguments, so the fifth (`ownerAlive`) takes its `null` default, i.e. "unknown"
for every claim. The gatherer (`scripts/lib/loop-status-gather.ts`) never reads
`.claude/telemetry/claims.jsonl`, so nothing upstream has the fact to pass. The
join itself is already reusable: `parseClaimOwners` + `isOwnerAlive` are
exported from `scripts/loop-doctor.ts:230-330`, and `LoopStatusInput` would
need one more field carrying the owner map (or the derived `boolean | null` per
issue) for the fix to be a two-line change at the call site.

**Why it may not deserve its own issue.** It is a reporting-fidelity gap, not a
behavioural one: nothing releases a claim off the status view, and the
divergence never causes a release that `loop:doctor` would not make. It may be
better folded into whichever slice next touches `loop-status-gather.ts` than
ticketed on its own — the cost of the fix is dominated by threading a new
`LoopStatusInput` field through the gatherer, the dashboard and their fixtures,
which is disproportionate for a display nuance if nobody has been misled by it.
