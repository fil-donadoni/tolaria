---
title: getManualState accepts any viewerId string with no ownership check
discoveredBy: 2173
status: draft
confidence: medium
---

**What is wrong.** `getManualState` (`convex/game.ts:3419-3430`) takes
`viewerId: v.string()` as a bare client-supplied argument and passes it
straight into `projectManualState` (`convex/manual.ts:118`) with no check
that the calling identity (`ctx.auth`) actually owns that seat — no
`getCurrentUser`/`getCurrentUserId` call, no `seatBelongsToUser`-style gate
(that helper exists at `convex/gameLifecycle.ts:22-24` and is used
elsewhere, just not here). Any authenticated (or even unauthenticated —
`ctx.auth` is never even read) caller who knows a `gameId` and the other
player's seat id can already fetch the opponent's redacted view of a
two-player Manual Game today, unrelated to this issue's client-side seat
switch.

**Evidence.** `convex/game.ts:3419-3430`:

```ts
export const getManualState = query({
    args: { gameId: v.id("games"), viewerId: v.string() },
    handler: async (ctx, args) => {
        const latest = await getLatestManualState(ctx, args.gameId);
        if (!latest) return null;
        const state = latest.state as ManualGameState;
        return projectManualState(state, args.viewerId);
    },
});
```

**Why this issue didn't touch it.** #2173 only needed the client to be able
to pass a _different_ `viewerId` for its own two seats in solo — the query
already accepted arbitrary strings before this change, so the seat switch
adds no new capability server-side, and the subagent brief explicitly says
not to widen or narrow pre-existing behaviour while implementing an
unrelated ticket.

**Why it may not deserve its own issue.** Manual Mode games are private
1:1/solo study sessions, not ranked/competitive, and the "leak" is a
redacted projection, not raw state (hand contents are still hidden per
`ADR 0080` unless the requested `viewerId` legitimately owns them) — so the
severity is low relative to e.g. leaking a real player's hand. It is worth a
line on a general "Convex query auth sweep" tracker rather than a
standalone ticket, if one exists; if not, it is probably not yet worth one
on its own.
