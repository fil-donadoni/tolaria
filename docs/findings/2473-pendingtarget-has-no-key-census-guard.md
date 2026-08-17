---
title: PendingTarget has no compile-forced key census, unlike PendingCast
discoveredBy: 2473
status: draft
confidence: medium
---

**What is wrong.** `PendingCast` has a compile-forced exhaustive key census —
`CAST_KEY_CENSUS: Record<keyof PendingCast, ParkClass>` in
`convex/gre/owedPayment.ts:76` — so a new field cannot `tsc` until someone
classifies it, and the classification forces the author to think about whether
the payer is waiting on it. `PendingTarget` has no equivalent. Its only
compile-forced set, `PENDING_TARGET_FILTER_KEYS`
(`convex/gre/state.ts`, ADR 0068 / #1956), covers **filter** keys only, and
exists for a different reason (clearing a prior target group's constraint
between Fumarole-style groups).

The consequence is that a value threaded onto `pendingTarget` has no guard
asking two questions a reviewer would: (a) must
`applyRequirementToPendingTarget` (`convex/game.ts:5571`) preserve it across a
multi-group walk, or clear it? and (b) does `finalizeTargetSelection` forward it
to `pendingCast` on **both** of its park branches, or only the one the author
happened to be looking at?

**Evidence.** `convex/gre/owedPayment.ts:76` (`Record<keyof PendingCast, …>`)
versus `convex/gre/state.ts:2898` (`export type PendingTarget = {`), which has
no unrestricted `Record<keyof PendingTarget, …>` anywhere in the tree: the two
hits for `keyof PendingTarget` (`convex/gre/state.ts:3205` and `:3248`) are both
`Record<FilterKey & keyof PendingTarget, true>`, i.e. the filter subset only.
`PendingTarget` currently carries eight announcement-time payload fields that
all have exactly this forward-to-commit obligation — `chosenX`,
`chosenModeId`, `kickerPayments`, `buybackPaid`, `phyrexianLifePips`,
`alternativeCostId`, `divideTotal`, and (as of #2473)
`castOffSorceryTiming` — and each one was threaded by hand.
`applyRequirementToPendingTarget` mutates in place and explicitly clears only
the filter keys plus `zone`/`divideTotal`/`divideAmounts`, so the preserve/clear
decision for every other field is implicit rather than declared.

The two park branches already disagree, which is the concrete form the missing
census takes. The field #2473 adds (`castOffSorceryTiming`) forwards on both,
but two OLDER payload products diverge between them: the pick-park literal
(`convex/game.ts:6456`) carries `evoked` (from `alternativeCostId`) and omits
`targetAmounts`; the mana-park literal (`convex/game.ts:6616`) carries
`targetAmounts` (from `divideTotal`) and omits `evoked`. `dashed` is the only
one of the three in both. Neither omission looks reachable in today's
catalogue — `targetAmounts` needs divide-as-you-choose plus a
sacrifice/exile/convoke pick on the same spell, `evoked` needs an Evoke
creature with a cast-time target requirement — but "unreachable today" is
exactly the invariant a compile-forced census would state out loud instead of
leaving to a reader diffing two 25-line object literals.

**Why it may not deserve its own issue.** No live bug **on the field #2473
adds**, and the two divergences above are latent rather than reachable (see the
combinations named there) — so nothing here is this PR's to fix. The census
would be a pure-prophylaxis guard, and `owedPayment.ts`'s `ParkClass`
vocabulary does not
transfer (a `PendingTarget` field is not "park"/"non-park" — it is
"forward-to-commit" / "clear-between-groups" / "identity"), so it needs its own
small type rather than a reuse. That makes it a real design task, not a
one-liner — which argues for it being a line on an existing hygiene tracker
unless a field is actually found to have been dropped.
