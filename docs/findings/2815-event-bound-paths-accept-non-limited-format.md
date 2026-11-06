---
title: An event-bound game mutation accepts a payload whose format is not limited, so a round can be played with an unconstrained list
discoveredBy: 2815
status: draft
confidence: medium
---

**What is wrong.** `format` on the inline deck is client-supplied, and nothing on
the event-bound paths requires it to be `limited`. A payload with
`format: "freeform"`, the event's `limitedEventId` and the caller's own
`limitedSeatId` passes `assertSameEventDeck` and `assertLimitedSeatOwnership`,
then skips the Pool: `loadLimitedPoolResolver` returns `undefined` for a
non-`limited` deck and Freeform's validator is permissive.

**Evidence.** `startPairingMatch` and `challengeLimitedSeat` in `convex/game.ts`
call `assertDeckAdmitted` nowhere; `createGame` and `createSoloGame` do. The
result of a `startPairingMatch` Match lands in the standings, so the list is not
just a playtest. Read from the code, not reproduced through a client.

The hole predates issue #2815: seat ownership passes for the caller's own seat
either way, and the old resolver also ignored the Pool once `format` was not
`limited`.

**Why it may not deserve its own issue.** It needs a hand-crafted client, the
project is not commercial, and Limited Events are played among known players. The
fix is small, though: require `format === "limited"` next to
`assertSameEventDeck` on those paths, or admit against a `limited` Match Format.
