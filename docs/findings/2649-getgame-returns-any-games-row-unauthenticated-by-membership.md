---
title: getGame returns any games row to any signed-in user, with no membership check
discoveredBy: 2649
status: draft
confidence: low
---

**What is wrong.** `getGame` is `ctx.db.get(args.gameId)` and nothing else — no
`getCurrentUser`, no `gameBelongsToUser`, not even an auth check. Any signed-in
client that knows (or guesses) a `games` id gets the whole row: both seats'
names, deck names and formats, the `cardIds` art manifest, the Limited event
binding, and — since #2649 — the table's `joinCode` while it is open.

**Evidence.**

- `convex/game.ts:3965-3972` — the entire handler.
- Compare `getSeatDeck` two functions below (`:3986-4008`), which gates on SEAT
  ownership and documents why: "in a 2-player game a client can no longer read
  the opponent's list at all — which `getGame` incidentally allowed before the
  split." The comment names the hole and the split narrowed it rather than
  closing it.
- `getJoinInfo` (`:4072-4098`) exists precisely because a prospective joiner
  must NOT see the host's cards — a deliberate narrow projection sitting beside
  an unnarrowed one.

**On the join code specifically.** This does not make the code a secret worth
protecting on its own: every `waiting` non-challenge table is already listed to
every lobby user by `listOpenGames`, one click from being joined. #2649 strips
`joinCode` from THAT query (a code is the host's to hand out, not a broadcast),
but a code read out of `getGame` buys an attacker nothing they could not do by
clicking the row. The finding is about the row, not the code.

**Why it may not deserve its own issue.** Game ids are Convex ids — not
enumerable, and only handed out via the invite link the host chose to share.
The practical exposure is "someone who was given a link to a game can keep
reading its row", which may be entirely intended. It is also a hot subscription
(`<Board>` re-reads it several times a turn), so a membership check here is a
real cost, not a free win. Worth a decision, possibly a documented "yes, by
design" that stops it being rediscovered.
