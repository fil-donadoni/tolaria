---
title: A loss by effect (CR 104.3e) records gameOver.reason "life"
discoveredBy: 8583
status: draft
confidence: high
---

**What is wrong.** `SpellContext.loseGame` (`convex/gre/state.ts`, the
`loseGame(playerId)` primitive) ends the game with `reason: "life"`, whatever
made the player lose. The `loseGame` Effect Script Op (issue #8583) reuses it,
so a player who declines a Pact's upkeep payment, or casts One with Death,
sees "<name> ran out of life" in the game-over dialog
(`src/components/board/game-over-dialog.tsx`). Lich's leaves-the-battlefield
loss, the primitive's first caller, shows the same text.

**Evidence.** `gameOver.reason` is `"life" | "decked" | "concede" | "draw" |
"poison" | "alternate-win"` (`convex/gre/state/declarations.ts`,
`src/types/game.ts`). None of these is a CR 104.3e loss ("An effect may state
that a player loses the game").

**Why it may not deserve its own issue.** The game ends correctly and the
right player loses. Only the explanatory text is wrong. Fixing it means a new
reason value on the persisted `gameOver` shape, plus its dialog line (a
dialog component, so a `check:ui` walk is owed). That is a small,
self-contained change that might belong on an existing UI-copy tracker rather
than having its own ticket.
