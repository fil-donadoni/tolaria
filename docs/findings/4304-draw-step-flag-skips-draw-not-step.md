---
title: drawStepReplacement suppresses the draw but the DRAW step still runs, unlike CR 500.11
discoveredBy: 4304
status: draft
confidence: high
---

**What is wrong.** "Skip your draw step" (Necropotence, Solitary Confinement,
Yawgmoth's Bargain, Symbiotic Deployment) is encoded as
`CardDefinition.drawStepReplacement`, which only makes `drawStep` return early.
CR 500.11 / 614.10 say a skipped step does not happen at all: no priority, no
beginning-of-step triggers. Here `advancePhase` still calls `performPhaseEntry`
and `firePhaseBeginTriggers` for DRAW (it is not in `AUTO_PHASES`), so Howling
Mine, a `phaseTrigger` at DRAW, still fires under Necropotence.

**Evidence.** `convex/gre/phases.ts` `drawStep` returns on
`hasDrawSkipReplacement`; only the separate one-shot `skipDrawStepThisTurn` path
(Elfhame Sanctuary, `drawStepSkippedForActivePlayer`) bypasses the whole step.
Found by the review of the Grammar Rule that compiles the sentence; the compiled
definition matches the hand-written cards, so the rule adds no new divergence.

**Why it may not deserve its own issue.** The flag is shared with Fasting and
Island Sanctuary, whose own DRAW trigger must run, so the fix is a distinct
field (or reading the existing `skipDrawStepThisTurn` mechanism from a static),
not a tweak to the flag. Only Howling Mine-style DRAW triggers observe it, and
each such pairing is rare; if that stays true it is a line on a rules-fidelity
tracker rather than a ticket.
