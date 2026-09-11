---
title: The moveZone fromZones bulk sweep is worth 0 to the Bot and emits no LIBRARY_SEARCHED
discoveredBy: 2711
status: draft
confidence: medium
---

**What is wrong.** `moveZone`'s FOURTH shape (`player` + `fromZones` + `filter`

- `to`, issue #1104) shipped in the grammar with no catalogue card using it.
  Haunting Echoes (issue #2711) is the first, and it lands on two holes the shape
  has carried since:

1. **Bot valuation is zero.** The `moveZone` valuer's first branch is
   `if (!("to" in op) || !("target" in op)) return { points: 0, tags: ["tempo"] }`
   — written for the whole-zone `player`/`from`/`to` shape, which has no victim
   to price. The `fromZones` shape also carries no `target`, so it takes the
   same branch: a five-mana sorcery that exiles an opponent's whole graveyard
   and every matching library card scores 0 latent points. Not a freeze (the
   Bot can still cast it and the search still evaluates the resulting state),
   but the script heuristic that ranks it against alternatives sees nothing.

2. **No `LIBRARY_SEARCHED` event.** CR 701.23f: "Any abilities that trigger on
   a library being searched will trigger." The only emission site is
   `emitLibrarySearchedEvent`, called from `applyPendingChoiceSubmit` when a
   `search-library` PendingChoice commits — the deterministic sweep never goes
   near it. So a card whose Oracle text says "search that player's library"
   searches no library as far as the engine is concerned.

**Evidence.** `convex/gre/ai/opValuers.ts:758` (the `!("target" in op)`
branch); `convex/gre/effects/interpreter.ts` `moveZone`'s `"fromZones" in op`
branch (calls `ctx.moveCardById` per match, nothing else);
`convex/gre/state.ts:11377` `emitLibrarySearchedEvent` and its single caller
`convex/gre/pendingChoiceSubmit.ts:1277`. `SpellContext` exposes no
search-emission primitive, so (2) needs one added alongside the interpreter
change.

**Why it may not deserve its own issue.** (2) is currently unobservable: the
only card that reads `LIBRARY_SEARCHED` is Wan Shi Tong, Librarian, which is a
commented-out stub in `convex/cards/sets/tla/blue.ts` blocked on a separate
draw-primitive gap — so nothing in a real game can tell the difference until
that ships. (1) is a heuristic ranking miss, not a reachability failure, and it
is one branch condition wide; it may be cheaper as a line on the Bot valuation
tracker than as a ticket of its own. Both would be worth one ticket TOGETHER
the moment a second `fromZones` card ships (Lobotomy, Splinter, Jester's Cap
are the obvious next ones), since each adds a card whose Oracle text promises a
search the engine does not perform.
