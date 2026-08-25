---
title: CR 118.5 is cited across the cost code for "additional cost", but it is the {0} rule
discoveredBy: 2232
status: draft
confidence: high
---

**What is wrong.** Roughly two dozen comments describe an additional
activation cost — "exile N cards from a single graveyard", the filtered
sacrifice, tap-other — as `CR 602.1 / 118.5`. Printed, CR 118.5 reads: "Some
costs are represented by {0}, or are reduced to {0}. The action necessary for a
player to pay such a cost is the player's acknowledgment that they are paying
it." It has nothing to do with additional costs. This is exactly the
resolvable-but-wrong class `cr:lint` cannot see: the id exists, so the scan
passes, and the surrounding prose is wrong anyway.

**Evidence.** `bun run cr 118.5` prints the {0} rule. Sites include
`convex/cards/types.ts` (the `sacrificeFilter`, `sacrificeFilterCount` and
`exileFromGraveyard` doc blocks), `convex/game.ts` (the exile-cost legality
gate and its commit block), `convex/gre/applyMove.ts` and
`convex/gre/moves.ts`. The rules that actually say what these comments mean are
CR 118.1 (a cost is an action necessary to take another action), CR 118.3 (a
player can't pay a cost without the resources) and CR 601.2h — reached for an
activated ability through CR 602.2b. #2232's own new comments use those three;
the pre-existing ones were left alone to keep the diff reviewable.

**Why it may not deserve its own issue.** It is a comment-only sweep with zero
behaviour change, and mechanising it is hard for the same reason `cr:lint`
misses it — a title-keyed check like `scripts/cr-keyword-citations.ts` works
for the 701/702 keyword blocks but there is no keyword word on a `CR 118.5`
line to key on. A hand pass over ~24 sites is cheap; deciding whether it is
worth a queue slot is a human call.
