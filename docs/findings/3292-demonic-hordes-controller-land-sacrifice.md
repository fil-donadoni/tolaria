---
title: Demonic Hordes' upkeep sacrifice is the CONTROLLER's own land, still priced as an edict
discoveredBy: 3292
status: draft
confidence: medium
---

**What is wrong.** Issue #3292 taught the `sacrifice` valuer to sign a picks-set
sacrifice by its CHOOSER. Demonic Hordes is the inverse shape and the fix leaves
it mis-signed: the chooser is the OPPONENT, but the zone picked from is the
CONTROLLER's own — so it is the caster's land that dies, priced as +120 board
removal aimed at the other seat.

**Evidence.** `convex/cards/sets/lea/black.ts:256` —
`choice { player: "opponent", zoneOwnerId: "controller", filter: { type: "Land" } }`
then `sacrifice { permanents: { ref: "$picked" } }`. The valuer
(`convex/gre/ai/opValuers.ts`, `withBindingsOf`) attributes on `player` alone;
PR #3298 added a `zoneOwnerId` clause, but only as a fail-open guard on the
CONTROLLER-chosen branch — it declines to attribute, it does not read the field
as the answer. The general rule the two cases share is that whose permanent it
is comes from `zoneOwnerId ?? player`, not from `player`.

**Why it may not deserve its own issue.** One shipped card reaches it, and the
same one line would fix it: make `withBindingsOf` attribute on
`zoneOwnerId ?? player` instead of guarding on it. That is a line on the bot
value-model tracker rather than a ticket unless a second card lands on the
shape.
