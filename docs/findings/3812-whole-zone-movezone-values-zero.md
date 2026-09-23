---
title: A whole-zone moveZone of an OPPONENT's hand values at zero for the Bot
discoveredBy: 3812
status: draft
confidence: medium
---

**What is wrong.** `OP_VALUERS.moveZone` returns `{ points: 0 }` for every shape
without a `target` (`convex/gre/ai/opValuers.ts`, the `!("target" in op)` early
return). That is right for the shapes it was written for — a player shuffling
their OWN hand into their library (Timetwister, Winds of Change) — but the same
shape now also exiles the TARGET player's whole hand face down (Suppress,
issue #3812), which is hand disruption: the Bot's script valuation sees nothing
to gain from casting it at an opponent.

**Evidence.** `suppress` (`convex/cards/sets/apc/black.ts`) — its only effect Op
is `moveZone { player: { target: 0 }, from: "hand", to: "exile", faceDown }`,
priced 0; the delayed return is priced by the same valuer at 0 too.
`OP_BENEFICENCE.moveZone` is `"neutral"` by design (its comment explains why no
single sign fits the Op), so the sign cannot carry it either.

**Why not fixed here.** A valuation change is a Bot behaviour change: it owes
`/bot-slice` and a discriminating `must` blade pair
(`.claude/rules/bot-development.md`), and the fix is a CLASS decision (every
whole-zone move whose `player` is not the controller), not a Suppress one. The
search still reaches the cast through `enumerateMoves` and evaluates the
resulting position, so the card is playable, only unmotivated by its script
value.
