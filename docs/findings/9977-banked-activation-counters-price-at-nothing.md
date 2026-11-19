---
title: Counters that pay a permanent's own activated ability price at nothing in evaluate
discoveredBy: 9977
status: draft
confidence: high
---

**What is wrong.** A non-creature permanent on the battlefield is valued off its
definition (`nonCreatureBodyValue` → `cardValue`), and the standing reading of an
ability whose whole cost is removing counters (`counterBudget`,
`convex/gre/ai/cardScriptValue.ts`) reads only the counters the card is PRINTED
to enter with. The live counters are never read, so an Umezawa's Jitte with zero
charge counters and one with four score the same.

**Evidence.** Measured on the issue #9977 board (`evaluate` from the Jitte
controller's seat, PRECOMBAT_MAIN, Jitte on a Flying Men): 0, 1, 2 and 4 charge
counters all give 45.89. The combat-damage trigger that adds two counters is
therefore invisible to every leaf. A prototype term pricing each banked
activation at `counterFuelledActivationValue` (the ability's best mode at
`ABILITY_SCRIPT_DISCOUNT`, about 17.7 per Jitte counter) made the counters
visible, but it did not change the issue #9977 decision on its own: the tree's
misdirected-variant drag decided it, and that is what the PR fixed.

**Why it may not deserve its own issue.** It is the same class as issue #8294
(a standing resource spent for less than it is worth), whose Jitte `stretch`
entry ("standing resource: Umezawa's Jitte keeps its counter when the combat is
already won") is still `stretch`. It may be a line on that issue's successor
rather than a new ticket. A new term also owes an `EvalTerms` decision (a key of
its own or a share of `permanents`) and a refit.
