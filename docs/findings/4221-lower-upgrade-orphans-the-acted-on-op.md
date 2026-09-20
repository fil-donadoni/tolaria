---
title: lowerUpgrade's structuredClone can orphan the op a later sentence's "that permanent" binds
discoveredBy: 4221
status: draft
confidence: low
---

**What is wrong.** The cross-sentence antecedent (`SentenceWalk.actedOn`, CR
608.2h) holds the acting Op **by reference**, so that a later sentence reading
"that permanent's mana value" can give it the `bind` that snapshots the object
(`convex/oracle/lowerEffects.ts:291-293`). `lowerUpgrade` lowers its base
sentence with the ordinary `lowerSentence` — so `walk.actedOn` survives the
call and points at the base's Op — but emits only `structuredClone(base.value)`
into each `else` branch. The op object the walk is holding is therefore **not**
the op in the emitted script: a later `actedOn.op.bind = bind` writes the
binding onto an orphan, and the `ref` that reads it dangles.

**Evidence.** `convex/oracle/lowerEffects.ts:1774` (the clone) against `:291`
(the mutation) and `:1711` (`gatedSentence`, which restores by reference and is
therefore correct). The same read-by-reference is done by `lowerCreateToken`
(`:1872-1884`), so this is not specific to the mana-value rule.

**Why it may not deserve its own issue.** Not reachable today, and it cannot
ship silently wrong if it becomes reachable. Four `upgrade-if-controls` shapes
with a `destroy` / `moveZone` base were probed during the review of PR #4227
and every one is refused upstream (`no slot consumed the line`), so no corpus
card reaches the combination. And `validateEffectScript`
(`convex/gre/effects/validate.ts`) reports a dangling binding, so such a card
would land in `quarantine` rather than compile to a script that reads 0. That
makes it a latent correctness trap for whoever next widens the upgrade
grammar, not a defect in the tree — likely a line on the upgrade rule's own
ticket rather than a ticket of its own.
