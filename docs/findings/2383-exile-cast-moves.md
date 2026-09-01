---
title: The Bot can never cast a card from EXILE — enumerateMoves has no exile cast loop (the sibling of 2358's graveyard gap)
discoveredBy: 2383
status: triaged
issue: 2971
confidence: high
---

**What is wrong.** `enumerateMoves` (`convex/gre/moves.ts`) never feeds an
EXILE card to `enumerateCastMoves`. The three call sites are `player.hand`, the
retrace loop over `player.graveyard`, and `libraryTop`; no player's `exile` is
scanned for a CAST at all. So every cast-from-exile permission the engine ships
is invisible to the play Bot: Ice Cauldron's "you may cast that card for as
long as it remains exiled", Dauthi Voidwalker's free cast, Robber of the Rich's
stolen top card, the impulse windows (Expressive Iteration, Headliner Scarlett,
Laelia, Inti), a madness cast, and now Elite Spellbinder's taxed grant
(issue #2383). The omission is silent in exactly the same way #2358's graveyard
gap is: `getLegalActions` correctly returns `"cast"` for those cards — the wire
projection even hands the human client a Cast button off that very call — so
nothing in the engine reports a disagreement, the Bot simply never considers
the move.

**Evidence.**

- `convex/gre/moves.ts` — `enumerateCastMoves` is called from three places
  (`for (const card of player.hand)`, the `hasRetrace` graveyard loop, and the
  `libraryTop` branch). `grep -n "player.exile" convex/gre/moves.ts` returns
  nothing.
- `convex/gre/rules.ts` — `getLegalActions` has a dedicated madness branch, a
  free-exile-cast branch and a `casterId` parameter added specifically for
  CROSS-PLAYER exile grants (issue #1156), so the legality half has been
  complete for a long time; only the candidate SET is missing.
- `convex/gameProjections.ts` — the exile projection attaches `legalActions`
  for `castableFromExileBy === viewerId`, which is how the human player gets
  the affordance the Bot never enumerates.

**Why it was not fixed here.** Issue #2383 shipped the object-scoped
`costIncrease` rider through `getCostModifiers`, the collector
`enumerateCastMoves` already folds through — so the pricing half is done: the
day the exile loop is added, an Elite-Spellbinder-taxed card is priced at
{1}{G}+{2} in the Bot's tap plan with no further change. Adding the loop itself
is not this issue's scope and carries the same hazard #2358 documents for the
graveyard: the sandbox executors must learn each mechanism's stack flags
(`castFromExileWithoutPayingManaCost`, `castableFromExileIncludesLand`,
`castFromExileManaSubstitution`, madness) or the Bot will announce casts the
commit path refuses to locate.

**Suggested slice.** One ticket covering both zones, since they share the
executor work: scan `player.exile` (and, per #2358, the graveyard's non-retrace
mechanisms) for `castableFromExileBy === player.id`, gate on
`getLegalActions(..., casterId)`, and teach `applyMoveInSearch` the flags each
grant sets.
