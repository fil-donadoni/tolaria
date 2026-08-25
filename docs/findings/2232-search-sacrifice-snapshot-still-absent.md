---
title: The ISMCTS leaf still resolves a sacrifice-cost payoff for zero
discoveredBy: 2232
status: draft
confidence: medium
---

**What is wrong.** #2232 taught the search sandbox to reconstruct the
additional-cost snapshot for the graveyard-EXILE leg, so Necropolis resolves in
the tree with the same X live play gives it. The SACRIFICE leg is still
unreconstructed: an ability that reads back what it sacrificed resolves for
`undefined` inside every rollout, scores exactly like `pass`, and is therefore
never chosen — the same failure shape #2155 fixed for unpaid costs.

**Evidence.** `convex/gre/search.ts` push site: the item is built from
`buildActivatedAbilityStackItem` with `costOut.additionalSacrificeSnapshot`
supplied only by `applyActivationCostsForSearch`'s exile branch
(`convex/gre/applyMove.ts`, the `picks.exileFromGraveyard` block). The
sacrifice branch immediately above it (`activationSacrificeVictims` →
`removePermanentTo(state, id, "graveyard", "sacrifice")`) records nothing, and
the comment at the push site now says so explicitly. Affected shipped cards:
Priest of Yawgmoth (`convex/cards/sets/atq/black.ts` — "add {B} equal to the
sacrificed artifact's mana value") and Freyalise Supplicant, which reads
`getAdditionalSacrificePower()`.

**Why it may not deserve its own issue.** The effective POWER half (CR 613
layer 7c) genuinely cannot be recovered after `removePermanentTo` has run, so
closing it means restructuring `activationSacrificeVictims` to report its
victims rather than just applying them — more than a snapshot copy. It may be
better as a line on the bot roadmap than a standalone ticket, and it costs
nothing until someone measures the bot declining a Priest of Yawgmoth line.
