---
title: forEach { set: "bound" } silently skips every non-battlefield member
discoveredBy: 2600
status: draft
confidence: high
---

**What is wrong.** `forEach { set: "bound", ref }` iterates a picks/list binding
and binds `$each` per member, but its member branch for `set: "bound"` is
battlefield-scoped: `ctx.getOwnerId(member)` answers only for a battlefield
permanent, so a member sitting in a graveyard, exile, hand or library leaves
`$each` UNCAPTURED and the whole body skips for that member. The construct then
does nothing at all, with no error and no red — the same shape that works over
a `choice(zone: "battlefield")` picks binding is inert over a
`choice(zone: "graveyard")` one.

**Evidence.** `convex/gre/effects/interpreter.ts` `execForEach` — the
`set: "players"` and `set: "graveyard"` branches bind `$each` explicitly
(`noteChoice` / a `graveyard-card` `bindSnapshot`), and the `else` branch that
serves `set: "bound"` guards on `ctx.getOwnerId(members[k]) !== undefined`.
Observed while adding `mill.bindAll` (issue #2600): a `forEach` over the milled
set exiled nothing, while the same set consumed as a bare `cards` ref
(`moveZone { cards: { ref: "$milled" } }`) moved both cards. The validator
accepts the shape either way — `checkOpListRefs` checks only that the ref names
a `list` or `picks` binding (issue #1284), never where its members live.

**Why it may not deserve its own issue.** No shipped card hits it today: every
`forEach { set: "bound" }` in the catalogue iterates battlefield picks (Frantic
Search's lands is the canonical one), and the graveyard case has its own
dedicated `set: "graveyard"` selector. It becomes a real ticket the first time a
card wants "for each of the cards milled this way, …" — at which point the fix
is either a per-member zone lookup in the `bound` branch (the
`graveyard`/`exile` owner getters already exist) or a validator refusal that
makes the inert shape loud instead of silent.
