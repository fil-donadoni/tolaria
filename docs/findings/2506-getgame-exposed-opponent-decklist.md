---
title: getGame published both players' decklists to either client (closed incidentally by #2506)
discoveredBy: 2506
status: draft
confidence: high
---

**What is wrong.** Until the #2506 split, `game.getGame` returned the raw
`games` document with no projection and no `returns:` validator — including
`players[].deck.cards` for BOTH seats. Any client in a 2-player game could read
its opponent's full decklist straight off its own board subscription. The Match
projection guards this carefully (`projectMatch` strips the opponent's deck, and
`matchLifecycle.test.ts` has a dedicated "2-player sideboarding secrecy" block
for it, issue #397) — the `games` row simply bypassed that guard with the same
information.

**Evidence.** `convex/game.ts` `getGame` was `return await ctx.db.get(args.gameId)`,
subscribed by `src/components/board/board.tsx:136` in every game. The
replacement read, `getSeatDeck` (`convex/game.ts`), is gated on
`seatBelongsToUser(args.playerId, userId)`, so a 2-player client can now fetch
only its own list; solo / vs-AI are unaffected because both handles belong to
the one user. What still crosses is `games.cardIds` — the deduped set of print
ids across both decks, needed for art preloading — so the opponent's card
IDENTITIES are still visible, just not their counts or their maindeck /
sideboard partition.

**Why it may not deserve its own issue.** The leak is already closed as a side
effect of this ticket, and the residue (`cardIds`) is a deliberate trade the
schema comment records. It is written down because the CLASS is worth a policy
decision someone should make on purpose: this repo has no `returns:` validator
on any `games`/`matches` query, so "what a query publishes" is whatever the row
happens to hold, and the next fat field added to `games` will be published to
both clients with nothing failing. If that policy is wanted, it is a ticket
about returns-validator coverage, not about this one query.
