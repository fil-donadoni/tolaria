---
title: manualConcedeMatch is always called with the P1 seat, wrong for a genuine 2-player manual table
discoveredBy: 2400
status: draft
confidence: medium
---

**Update (#2400 review round 2).** The instance this issue itself created is
fixed: `useScenarioTestGame.resolveBlockingActiveGame`
(`src/hooks/useScenarioTestGame.ts`) now derives the manual seat the same way
the non-manual branch already did — `blocked.solo ? \`${user.\_id}-p1\` :
user.\_id`— instead of always`-p1`. As defense in depth,
`manualConcedeMatch` (`convex/game.ts`) was also changed to end the Match via
`computeForfeitMatch`(the same pure transition`forfeitMatch`uses), which
fails CLOSED —`null`when the named seat isn't actually in the Match's`players[]`— instead of the old`game.players.find(p => p.id !==
args.playerId)`, which for an unrecognized `playerId` silently returned the
FIRST seat (i.e. could attribute the win to the conceder themself). So this
diff no longer reaches the bad outcome described below.

**What remains genuinely out of scope for #2400.**
`ActiveGameNotice.handleForfeit` (`src/components/lobby/active-game-notice.tsx:80-84`)
still calls `manualConcedeMatch({ gameId, playerId: \`${userId}-p1\` })`unconditionally for any`mode === "manual"`active game, the identical bug
pattern, in a call site #2400 does not touch ("Concede/forfeit flows
elsewhere in the app" is explicitly out of scope for this issue). With the
server-side fail-closed change above, that site now THROWS instead of
mis-attributing a win for a genuine 2-player manual table — better than
before, but the "Concede Match" button would still hard-error for that user
until`ActiveGameNotice`gets the same`solo`-gated seat derivation. Also
still open: `manualConcede`/`manualConcedeFn` (`convex/manual.ts:1060`, used
by the in-game concede button via `useManualDispatch`) accepts any
`playerId`string silently (it only writes`concededBy`) — no seat-ownership
check comparable to `assertSeatOwnership`on`forfeitMatch`. Worth a human's
second look before ticketing either.
