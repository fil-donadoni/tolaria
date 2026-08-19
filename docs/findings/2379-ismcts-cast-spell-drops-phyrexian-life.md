---
title: the ISMCTS cast-spell sandbox never pays a Move's Phyrexian life, while the greedy sandbox does
discoveredBy: 2379
status: draft
confidence: high
---

**What is wrong.** The two search sandboxes that replay a `cast-spell` Move
disagree about `Move.payLife` (CR 107.4f — the life paid for `{C/P}` pips the
enumerator chose to cover with life, 2 each). The greedy 1-ply sandbox charges
it; the ISMCTS tree does not. So inside the tree that actually picks the move, a
Phyrexian cast is free of its life cost — Dismember paying both pips with life
looks 4 life cheaper than it is, every rollout.

**Evidence.**

- `convex/gre/applyMove.ts`, `case "cast-spell"` — charges it:
  `if (move.payLife && move.payLife > 0) { player.life -= move.payLife; }`
- `convex/gre/search.ts`, `case "cast-spell"` — the same branch runs
  `applyDelveExileForSearch` → `applyTapPlan` → `removeFromZone` → push, with no
  `move.payLife` read anywhere in the case.
- The enumerator does set it: `convex/gre/moves.ts` computes
  `payLife = split.lifePips * PHYREXIAN_LIFE_PER_PIP` and emits
  `...(payLife > 0 ? { payLife } : {})` on the Move.

This PR added `applyAdditionalCostLegForSearch` to BOTH sandboxes precisely so
the new caster-chosen leg could not land in this state; the pre-existing
`payLife` asymmetry sitting one line away is what made the omission visible.

**Why it may not deserve its own issue.** It is a one-line fix in an area with
an obvious owner, so it might just ride along with the next bot slice rather
than earning a ticket. Against that: the two sandboxes disagreeing is exactly
the "the bot simulates a different game than the server plays" class the file's
own comments call out, and the divergence is silent — no test compares the two
sandboxes' post-state for the same Move, which may be the more valuable thing to
add.
