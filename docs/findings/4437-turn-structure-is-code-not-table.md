---
title: The turn structure is code, not a table — an extra step costs ~22 edit sites in 13 files
discoveredBy: 4437
status: draft
confidence: high
---

**What is wrong.** `PHASE_ORDER` is data but the behaviour is hand-written:
`performPhaseEntry` is a 12-case switch, `advancePhase` tests `state.phase ===`
13 times, and 134 phase-literal comparisons exist repo-wide. The turn order is
written out independently four times (`PHASE_ORDER`, `AUTO_PHASES`,
`COMBAT_STEPS`, `MANUAL_PHASE_ORDER`) and none is exhaustiveness-checked.

**Evidence.** `convex/gre/phases.ts` (`PHASE_ORDER` at the top, the entry
switch and the `isDamageStep()` OR-chains); 2026-09-23 audit counted the sites
an extra combat step would touch: about 22 in 13 files including `src/`.

**Why it may not deserve its own issue.** No extra step is in sight (CR 500.8
extra phases are expressed as repeats of existing ones today). A
`TURN_STRUCTURE: StepSpec[]` table typed against `Phase` would collapse the
four order lists and the 11 damage/combat OR-chains, but 58 test files import
`phases` and the payoff arrives only with the first new step. Line on the
engine-rationalisation umbrellas (PRD (c) #4437 / PRD (a) #4447), not a ticket.
