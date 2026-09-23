---
title: Synchronous coin flips show neither player the results
discoveredBy: 3813
status: draft
confidence: high
---

**What is wrong.** `SpellContext.flipCoin` (`convex/gre/state.ts`, the
`flipCoin()` primitive) draws a bit and emits no event, log line or reveal.
`coinFlipSync` and the new `coinFlipSeries` (issue #3813) both use it, so on
Squee's Revenge the players never see how many flips were won. The caster only
sees "drew N cards" or nothing. CR 705.2 has the flipper call each flip, so the
result is public information.

**Evidence.** `coinFlipSync`'s own registry row records QA's complaint that
Goblin Artisans had no flip animation, and it steers new cards to the
suspending `coinFlip` (ADR 0023 reveal overlay). ADR 0144 defers a series
overlay deliberately, but it names no issue for it.

**Why it may not deserve its own issue.** Two cards use the synchronous path
today. A public summary event could be one small change to the primitive
rather than a new overlay. It may belong as a line on the ADR 0023 reveal work
instead.
