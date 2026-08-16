---
title: declaredBlockDelta discards a trampler's excess damage entirely
discoveredBy: 2444
status: draft
confidence: medium
---

**What is wrong.** The block-quality valuation simulates each blocked attacker
by spending its power on blockers "lethal first" and then throwing the remainder
away. Trample is never consulted, so the bot prices a blocked trampler as
dealing **zero** face damage — the same as a blocked vanilla creature. CR 702.19b
says the excess is assigned to the player (or the attacked planeswalker), and the
engine does exactly that. The valuation and the engine therefore disagree about
what a chump block against a trampler costs.

**Evidence.** `convex/gre/evaluate.ts:949-1000` (`declaredBlockDelta`): the
`for (const b of blockers)` loop decrements `remaining` by each blocker's lethal
threshold and the leftover is dropped; `faceDamage` is only ever incremented on
the `blockers.length === 0` branch at `:953-956`. Compare
`convex/gre/phases.ts:1010-1035` (`buildAutoDamageAssignments`), which assigns
`getCardPower(state, attacker) - toBlocker` to the excess sink. Same shape in
`declaredCombatDelta` (`convex/gre/evaluate.ts:841`).

Concretely: a 6/6 trampler blocked by a 1/1 deals 5 to the defender's face, and
the bot values that block as if it deals 0 — so chump-blocking a trampler looks
free.

**Why it may not deserve its own issue.** The file's own doc comment declares the
simulation "crude on purpose, matching the Danger Clock shape", and the neighbour
tests assert an ORDERING contract rather than magnitudes — so a deliberate
simplification is plausible rather than an oversight, and #2444's acceptance
criteria are about the assignment threshold, not the excess. It is also only
load-bearing when the pool has tramplers big enough for the leftover to matter.
If someone is already re-working `declaredBlockDelta`, this is a line in that
work rather than a ticket of its own.
