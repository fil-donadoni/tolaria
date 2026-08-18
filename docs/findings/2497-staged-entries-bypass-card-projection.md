---
title: stagedEntries crosses the wire un-slimmed and un-hidden, bypassing projectBattlefieldCard
discoveredBy: 2497
status: draft
confidence: medium
---

**What is wrong.** `projectPublicState` reshapes every zone that can hold a card
— `players[].battlefield` through `projectBattlefieldCard`, `stack` and
`pendingTriggerBatch` and `phasedOut` through `slimCard` — but
`state.stagedEntries` (ADR 0100's as-enters park) reaches the client only via the
raw `...state` spread. Two consequences, both of the shape the projection's own
comments say it exists to prevent:

1. **Fat definitions on the wire.** `slimCard` strips `card.card` → `{ id }`.
   A staged entry's `card` keeps whatever the instance carries, so an as-enters
   permanent is the one card object on the wire that is not slimmed. The
   `phasedOut` branch two lines below carries a comment saying exactly this
   ("the raw `...state` spread would leak the fat card defs") and was projected
   for that reason; `stagedEntries` was not.
2. **Face-down hiding is skipped.** `projectBattlefieldCard`
   (`convex/gameProjections.ts:379-391`) is what replaces a face-down
   permanent's identity with the sentinel and deletes `faceDownOf` for
   non-controllers. A card parked in `stagedEntries` never passes through it, so
   `card.faceDownOf` — the true identity — reaches BOTH seats for as long as the
   entry is parked.

**Evidence.**

- `convex/gameProjections.ts:1136-1155` — the return of `projectPublicState`:
  `{ ...state, seq, players, stack: state.stack.map(slimCard), pendingTriggerBatch: …map(slimCard), phasedOut: …map(projectBattlefieldCard) }`.
  No `stagedEntries` key, so the spread's value stands.
- `convex/gameProjections.ts:244` — `PublicGameState = Omit<GameState, "players" | "stack" | "phasedOut" | "pendingTriggerBatch"> & {…}`: `stagedEntries` keeps its full `GameState` type, which is the type-level tell.
- `convex/gre/state.ts:10758-10768` — `StagedEntry` holds the whole
  `CardInstanceState` (`entry.card`), plus `consultedDefIds` / `tokenEntry`.
- `convex/gameProjections.ts:383-391` — the face-down branch that is skipped.

**Why it may not deserve its own issue.** Window 2 is currently unreachable: no
shipped card populates the as-enters union at all
(`convex/cards/__tests__/asEntersUnion.test.ts` guards that), and reaching the
face-down case additionally needs a face-down permanent that owes an as-enters
choice — a combination nothing in the catalogue produces. Window 1 is a handful
of bytes on a rare, short-lived field. It may be better folded into #2467 (the
first card that parks an as-enters entry) than ticketed on its own.

**One constraint on any fix.** The un-slimmed spread is now load-bearing:
#2497's fix has the client-side Brain read the as-enters `name` filter off
`stagedEntries[].owed`, through the same `findStagedEntry` /
`asEntersNameFilter` the server uses, precisely so picker and check cannot
drift. A projection that slims `entry.card` is fine; one that drops `owed`
would re-open the freeze this issue closed.
