---
title: No receipt role or outcome means "this landed", so a merge count has to be recounted from GitHub every time
discoveredBy: 2624
status: draft
confidence: medium
---

**What is wrong.** The `claims-held` predicate #2624 exports takes a merge
count, because "claimed work and merged nothing" is the distinction between a
pass that found nothing to do and a pass that lost work (PRD #2621, user story
5). Nothing in the receipt schema can supply that number. `WorkOutcome` is
`pr-open | wip | failed | collision` and `ReviewOutcome` is `approve | blocking`
— every one of them is written BEFORE the merge-train runs, and the train writes
no receipt of its own. So the batch directory records what was attempted and
reviewed, never what actually landed.

The consequence in this PR: the snapshot consumers can only pass `merges: 0`,
and it is sound solely because it is provable by construction (a claim that
merged is no longer open and no longer labelled `in-progress`, so it is not in
the claim list at all). The drain-side consumer in the follow-up ticket has no
such shortcut — it will have to count merges from `gh` or from the green SHA,
i.e. re-derive a fact the loop already knew at merge time and discarded.

**Evidence.** `scripts/lib/receipt.ts:47` (`ReceiptRole`), `:50` and `:53`
(`WorkOutcome` / `ReviewOutcome`) — no merged role or outcome;
`scripts/loop-status.ts:215-234` (`GatheredLoopStatus`) carries no merge count
either. `scripts/lib/loop-status.ts` § `snapshotClaimAccounting` records why the
snapshot side can prove zero instead of reading it.

**Why it may not deserve its own issue.** A `merge` receipt role is a schema
change touching `writeReceipt`'s validator, `queue:train` and the scorecard, for
a number that `gh pr list --state merged --search "merged:>=<ts>"` answers in one
call. If the drain-side ticket takes that call, nothing here needs fixing and
this is an observation, not a gap.
