---
title: joinGame will seat a real deck into a Tabletop (manual-mode) table
discoveredBy: 2649
status: draft
confidence: medium
---

**What is wrong.** The two join mutations are asymmetric about `games.mode`.
`joinManualGame` refuses a game that is not `mode: "manual"`; `joinGame` never
looks at `mode` at all. So `joinGame({ gameId: <a manual table>, deck: <a real
deck> })` passes every guard it has — the deck is not `format: "manual"`, the
game is `waiting` with one seat, there is no `limitedChallenge` — and seats a
real deck into a Tabletop game. The result is a `mode: "manual"` row whose
second seat is a GRE deck: the route mounts the manual board (ADR 0080) for a
player who chose an Arena deck, and the Match flips to `pregame` for a mode
that has no coin-toss gate.

**Evidence.**

- `convex/game.ts:4935-5012` (`joinManualGame`) — `if (game.mode !== "manual") throw`.
- `convex/game.ts` `joinWaitingGame` (the body `joinGame` now calls, post-#2649)
  — twelve guards, none of them reads `game.mode`.
- The lobby never OFFERS this: `dashboard-play-box.tsx:257-310` renders the open
  row with a "Manual Game" badge and `lobby.tsx:278-296` dispatches on
  `target.mode`, so the client always picks the right mutation. That is exactly
  what makes it invisible — the gap is only reachable by calling the mutation
  directly, and Convex mutations are public.

**Not introduced by #2649, and the new path is closed against it.**
`isCodeJoinableGame` (`convex/joinCodes.ts`) requires `game.mode === undefined`,
so a code can never resolve to a Tabletop table — and `createManualGame` never
mints one anyway. This is about the pre-existing by-id path.

**Why it may not deserve its own issue.** No UI reaches it, and the damage is
one confused game rather than corrupted state or a leak. If the project's line
is "a public mutation is an API and must be self-sufficient" (which is what
`joinGame`'s other eleven guards imply — every one of them is unreachable from
the UI too), it is a one-line fix and worth a ticket. If mutations are treated
as UI-private, it is a line on whatever tracker owns ADR 0080's edges.
