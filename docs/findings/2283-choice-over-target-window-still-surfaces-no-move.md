---
title: A pending CHOICE layered over a live pending TARGET still surfaces no bot move
discoveredBy: 2283
status: draft
confidence: low
---

**What is wrong.** `enumerateMoves`' mid-resolution-choice branch bails out with
`[]` whenever a `pendingTarget` is ALSO live, regardless of who owes what. Issue
#2283 made an engine-raised target selection answerable, but deliberately did
not touch that combination: with both a `pendingChoices[0]` and a raised
`pendingTarget` on the state, the choice outranks (CR 608.2 / 101.4, the
`computeExpectedInput` precedence) yet the enumerator offers no candidate for
it, so the bot has nothing to do and the same freeze shape returns.

**Evidence.**

- `convex/gre/moves.ts` — the head-choice branch returns `[]` when
  `state.pendingCast || state.pendingTarget || state.pendingActivation ||
state.pendingCompanionPay` is set, before ever calling `choiceCandidates`.
- `convex/gre/search.ts` (`decidingPlayer`) — #2283 mirrored the same
  precedence deliberately (`if (state.pendingChoices?.length) return null` inside
  the pending-target branch) so the two surfaces cannot disagree; consistent, but
  consistently unanswerable.
- The raised-target producers do not obviously create this state:
  `raiseTriggerTargetSelection` (`convex/gre/rules.ts:2632`) runs at trigger
  placement, and `applyRaisedTargetFinalization`
  (`convex/gre/pendingTargetOrigin.ts`) chains to the next targeted trigger only
  after the queue has drained.

**Why it may not deserve its own issue.** I could not construct the state from
any shipped card, and it may be unreachable by construction — a pending choice
suspends resolution before a target selection can be raised, and a raised
selection freezes priority before a choice can be enqueued. If that invariant
really holds, the right output is a comment (or an assertion) saying so, not a
ticket. It is also plausibly subsumed by the generic never-freeze liveness
backstop (#2284), which is where a "the bot owes something it cannot answer"
watchdog belongs anyway.
