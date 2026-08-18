---
title: getMatch hydrates the viewer's decklist on every execution, though only the sideboarding dialog reads it
discoveredBy: 2506
status: draft
confidence: medium
---

**What is wrong.** After the #2506 split `getMatch` still pays for one full
decklist per execution: it loads the viewer's own `matchDecks` row
unconditionally (`convex/matches.ts` `getMatch` → `loadMatchSeatDecks`). The
only client that reads `match.players[].deck` is the between-Games sideboarding
dialog, which can only be open while the Match is in `sideboarding` status —
every other execution of this live board subscription fetches ~4.7 KB nobody
looks at.

**Evidence.** The sole consumer is
`src/components/board/sideboarding-dialog.tsx:45,78-79,87-88,95,139`
(`p.deck !== undefined`, `seat.deck?.maindeck`, `seat.deck.maindeck.length`).
The other two `api.matches.getMatch` subscribers read meta only:
`src/components/board/board.tsx:152` (game-over screen) and
`src/components/board/pregame-dialog.tsx:32`. Gating the hydration on
`match.status === "sideboarding"` would leave the projection byte-identical for
every other status — `projectMatch` already publishes a seat without a `deck`
when the map has no entry, which is exactly the opponent's shape today.

**Why it may not deserve its own issue.** The saving is small in absolute terms:
a `matches` row is patched only a handful of times per Match (score, ready
flags, status), so `getMatch` re-executes far less often than `getGame`. The
split already took the row itself from ~10.6 KB to ~1.1 KB and removed the
growth term (`findActiveMatchForUser` scans the slim row). This is the last
~4.7 KB, on the coldest of the three subscriptions — plausibly a line on a
future bandwidth pass rather than a ticket. The reason it was left out of #2506
is risk, not oversight: a status-gated read is a behavioural condition, and if a
future surface reads the deck outside `sideboarding` it fails as a silently
empty deck rather than as an error.
