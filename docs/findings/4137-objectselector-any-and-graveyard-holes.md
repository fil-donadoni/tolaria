---
title: The Oracle compiler's objectSelector accepts "any target" and a graveyard card, then lowers to an Op that reaches neither
discoveredBy: 4137
status: draft
confidence: medium
---

**What is wrong.** `objectSelector` (`convex/oracle/lowerEffects.ts`) refuses a
sweep, a player subject, a `that card` anaphor, `type: "player"`, `type: "spell"`
and `type: "spell-or-permanent"` — and then allocates a slot for everything
else. Two shapes `targetFilterRule` can produce fall through that gap:
`{ type: "any" }` (CR 115.4's "any target", which a PLAYER may fill) and a
requirement carrying `zone: "graveyard"` / `type: "card"`. Both lower to a
battlefield verb pointed at an object the verb cannot reach, which compiles a
card that is cast legally, targets legally, and then does nothing.

**Evidence.** Both compile to `ready` today:

- `Destroy any target.` → `{ op: "destroy", target: { target: 0 } }` with
  `targetRequirement { type: "any", count: 1 }`. Choose a player and the
  `destroy` Op has nothing to destroy.
- `Destroy target creature card in your graveyard.` → the same Op, against a
  card that is not on the battlefield.

Found while writing `colorChangeSelector` for the colour rule (issue #4137):
that selector was written as an allow-list for exactly these two shapes after
the PR #4188 review named them, and its twin one function above still is not.

**Why it may not deserve its own issue.** No PRINTED card spells either form
under a verb this grammar reads — "Destroy any target" is not Magic English,
and a graveyard-zoned descriptor only reaches `move-zone` today, which binds its
own selector. So the hole is unreachable from the corpus, and the fix is four
lines: give `objectSelector` the same allow-list shape, with the refusal
strings `colorChangeSelector` already carries. It may be better as a line on
whichever ticket next widens `descriptorRule`'s zone vocabulary than as a
ticket of its own.
