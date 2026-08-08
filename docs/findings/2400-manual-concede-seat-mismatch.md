---
title: manualConcedeMatch is always called with the P1 seat, wrong for a genuine 2-player manual table
discoveredBy: 2400
status: draft
confidence: medium
---

**Update (#2400 review round 2).** The instance this issue itself created is
fixed: `useScenarioTestGame.resolveBlockingActiveGame`
(`src/hooks/useScenarioTestGame.ts`) now derives the manual seat the same way
the non-manual branch already did — the solo `-p1` seat when `blocked.solo`,
the bare user id otherwise — instead of always the solo seat.

As defense in depth, `manualConcedeMatch` (`convex/game.ts`) was also changed
to end the Match via `computeForfeitMatch` (the same pure transition
`forfeitMatch` uses), which fails CLOSED — `null` when the named seat isn't
actually in the Match's `players[]` — instead of the old
`game.players.find(p => p.id !== args.playerId)`, which for an unrecognized
`playerId` silently returned the FIRST seat (i.e. could attribute the win to
the conceder themself). So this diff no longer reaches the bad outcome
described in the original write-up below.

**Update (#2400 review round 2, fixed round 3).** The other call site,
`ActiveGameNotice.handleForfeit` (`src/components/lobby/active-game-notice.tsx`),
used to call `manualConcedeMatch` with the hardcoded solo seat
unconditionally for any `mode === "manual"` active game — the same bug
pattern, in a call site #2400 originally did not touch. Once
`manualConcedeMatch` started failing closed (the round-2 change above), that
hardcoded seat turned into a hard throw for a genuine 2-player Tabletop
table, and `handleForfeit` has no `catch`, so the rejection went unhandled
and the confirm dialog stayed open forever with no message. Round 3 fixed
this in the same PR: `handleForfeit` now reuses the `playerId` already
derived a few lines above it (the same solo-gated seat), for the manual
branch too, with a component test at
`src/components/lobby/__tests__/active-game-notice.test.tsx`.

**Still open, out of scope for #2400.** `manualConcede`/`manualConcedeFn`
(`convex/manual.ts:1060`, used by the in-game concede button via
`useManualDispatch`) accepts any `playerId` string silently — it only writes
`concededBy`, with no seat-ownership check comparable to
`assertSeatOwnership` on `forfeitMatch`. Worth a human's second look before
ticketing.
