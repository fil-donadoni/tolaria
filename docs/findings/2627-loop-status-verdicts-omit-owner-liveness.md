---
title: loop:status and the dashboard render claim verdicts that omit owner liveness
discoveredBy: 2627
status: draft
confidence: medium
---

**What is wrong.** `ClaimFacts` grew an `ownerAlive` fact in #2627 (the claim's
owning OS process, recorded at claim time by `claim-ledger.sh`). `loop:doctor`
gathers it; the verdict engine does not. So the same claim can be `orphan` in
`bun run loop:status` / the dashboard and `live` in `bun run loop:doctor` — the
opposite of why `classifyClaim` was extracted and shared in the first place
(#2519/#2624: "imported rather than re-derived", so the two cannot diverge).

**It is not a display nuance — it raises an alarm.** An earlier draft of this
note called it one; that was wrong, and correcting it is the point of this
revision. `deriveLoopVerdict` pushes an `orphaned-claims` finding on ANY orphan
verdict (`scripts/lib/loop-status.ts:566-571`), `orphaned-claims` is one of the
two codes that set `needsAttention` (`:587-588`), and `needsAttention` returns
the whole screen as **`NEEDS ATTENTION`** with the sentence "N claimed issue(s)
are orphaned — claimed with nothing to show, and nothing left to release them."
(`:596-605`). So the dashboard will alarm on exactly the claims `loop:doctor`
now DELIBERATELY holds because their owning process is alive and working: the
top-line health verdict of the loop goes red on a healthy pass, and it says the
claims are unreleasable when the sweep has just examined them and decided the
opposite. The direction is still the safe one — nothing releases a claim off
the status view — but the cost is an operator-facing false alarm on the one
screen whose job is to be trusted, not a cosmetic difference in a listing.

**Evidence.** `scripts/lib/loop-status.ts:677-682` calls
`buildClaimFacts(issue, input.prBranches, input.branches, now)` — four
arguments, so the fifth (`ownerAlive`) takes its `null` default, i.e. "unknown"
for every claim. The gatherer (`scripts/lib/loop-status-gather.ts`) never reads
`.claude/telemetry/claims.jsonl`, so nothing upstream has the fact to pass. The
join itself is already reusable: `parseClaimOwners` + `isOwnerAlive` are
exported from `scripts/loop-doctor.ts`, and `LoopStatusInput` would need one
more field carrying the owner map (or the derived `boolean | null` per issue)
for the fix to be a two-line change at the call site.

**Why it is still a draft rather than an issue.** Two reasons, and neither is
"it does not matter". First, it is a reporting gap, not a behavioural one:
nothing releases a claim off the status view, and the divergence never causes a
release `loop:doctor` would not make — so it does not belong in #2627, whose
whole risk surface is wrong releases. Second, the fix is not the two-line call
site: it is threading a new `LoopStatusInput` field through the gatherer, the
dashboard and their fixtures, which is real scope. Fold it into whichever slice
next touches `loop-status-gather.ts`, or ticket it on its own once the false
`NEEDS ATTENTION` is actually observed on a live board — which it will be, the
first time a long-running pass holds a local-only branch past 24h.
