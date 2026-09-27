---
title: The choice Op's count accepts only numbers, so "search for that many cards" cannot be written as an Effect Script
discoveredBy: 3011
status: draft
confidence: medium
---

**What is wrong.** `choice.count` is typed `number | { min: number; max: number }`
(`convex/cards/types.ts`, the `op: "choice"` member). An `EffectValue` is not
accepted, so a pick whose size comes from an earlier Op cannot be expressed.
That rules out `max: { ref: "$n" }` bound by `moveZone.bindCount`, and it rules
out X.

**Evidence.** Jester's Mask (`convex/cards/sets/ice/colorless.ts`) is the one
consumer issue #3011 listed that stays `resolve()` for this reason and no
other. Its Oracle text: "Target opponent puts the cards from their hand on top
of their library. Search that player's library for that many cards. That player
puts those cards into their hand, then shuffles." Its hand→library move is
already `moveZone`'s whole-zone shape, and `bindCount` (issue #4302) captures
"that many". The only thing missing is a `choice` whose `max` reads that
binding.

**Why it may not deserve its own issue.** Right now the only consumer we know
of is one ICE card. Before filing, grep the corpus for "for that many cards" and
"choose X cards" to see whether a Grammar Gap already names this form.
