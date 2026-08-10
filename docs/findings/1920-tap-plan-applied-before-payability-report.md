---
title: The search applies an activation's tap plan before learning the cost is unpayable, and its unreachability rests on an invariant that is already false
discoveredBy: 1920
status: draft
confidence: medium
---

**What is wrong.** In `applyMoveInSearch`'s `activate-ability` case
(`convex/gre/search.ts`) the order is:

```
applyTapPlan(state, playerId, move.tapPlan);          // mana leg, mutates
const paid = applyActivationCostsForSearch(...);      // may report false
if (paid && source && activated?.useStack) { ...push... }
```

When the helper reports `false` the tap plan has already been applied, so the
leaf keeps tapped mana sources with nothing pushed and no other cost paid — a
state no server move produces. It is _conservative_ (strictly worse for the
mover than reality, so it cannot overvalue the declined activation), which is
why it was left alone when the reporting path was added in PR #2454.

**Evidence.** `convex/gre/search.ts`, the `activate-ability` case: `applyTapPlan`
precedes the `applyActivationCostsForSearch` call whose boolean gates the push.

**Why this is worth tracking despite being unreachable today.** The
unreachability argument is "every leg that can report `false` is also gated in
`enumerateAbilityMoves`, so no enumerated move reaches the ordering" — i.e. the
ordering is protected by an invariant maintained in a _different file_, with
nothing checking that the two stay in step.

That invariant is **already false in one place**: the `chosenX` rejection point
(`docs/findings/1920-ungated-chosenx-rejection-point.md`) is a reachable
server-illegal activation with no enumerator gate. It happens not to trip _this_
ordering, because `chosenX` is rejected by the mutation rather than reported by
the helper — but it is a live demonstration that "every rejecting leg is gated"
is a claim about the current state of two files rather than a structural
property. PR #2454 needed four review rounds precisely because that claim was
made and falsified three times.

So the protection is thinner than "unreachable today" suggests, and the failure
mode is silent: a twelfth rejection point added to the helper without a matching
enumerator gate resurfaces this ordering with no test naming it.

**Why it may not deserve its own issue.** The consequence is bounded and
correctly signed — the leaf undervalues a move the search then declines anyway,
so no mis-preference can result from it, and it is genuinely unreachable through
`enumerateMoves` at HEAD. The honest fix is also small (hoist the payability
report above `applyTapPlan`, or roll the tap plan back on `false`), which argues
for folding it into whatever next touches this function rather than spending a
ticket on it. The argument for a ticket is that it is one of two places where
"the two doors answer differently" survives in this path, and the pattern —
mutate first, learn legality second — is the shape that produced the round-2 and
round-4 findings in the first place.
