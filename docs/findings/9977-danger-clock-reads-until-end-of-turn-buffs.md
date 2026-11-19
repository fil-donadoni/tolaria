---
title: The Danger Clock reads until-end-of-turn P/T as a lasting clock
discoveredBy: 9977
status: draft
confidence: high
---

**What is wrong.** `predictUnblockedThreat` (`convex/gre/dangerClock.ts`) reads
power through `getEffectivePT(state, c, { pass })`, temporary buffs included.
The clock is the STEADY-STATE race term (its own header: it ignores tapped and
summoning-sick as transient), and an "until end of turn" effect ends in cleanup
(CR 514.2), so a pump reads as a faster clock it will never be. The material
terms already exclude the buff (`includeTemporary: false`, ADR 0020 §2).

**Evidence.** Issue #9977 board, COMBAT_DAMAGE after the Jitte's host dealt
damage: spending a charge counter on "+2/+2 until end of turn" raised `danger`
from 15.8 to 31.6, so the 1-ply policy scored the useless post-damage pump at
327.5 against 313.4 for `pass`, and the rollout spent both counters on it.
With `includeTemporary: false` in that one read the pump fell to 311.7, below
`pass`.

**Why it may not deserve its own issue.** None, as far as measured: it is a
one-line fix with a clear CR basis. It was left out of the issue #9977 PR only
because that decision did not need it, and every leaf of every game reads this
term, so it owes its own blade measurement.
