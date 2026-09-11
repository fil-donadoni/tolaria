---
title: A once-per-turn ability tallied while its card is in the graveyard is never cleared
discoveredBy: 3448
status: draft
confidence: medium
---

**What is wrong.** The turn-boundary reset of `activationsThisTurn` sweeps
`p.battlefield` only, while the graveyard and exile deliberately PRESERVE the
tally (it is cleared on the way back in, CR 400.7). So a `oncePerTurn` ability
activated from the GRAVEYARD (`ActivatedAbility.activateFromGraveyard`) records
a tally that nothing ever clears while the card stays there — the ability is
blocked for the rest of the game rather than for the rest of the turn.

**Evidence.** `convex/gre/phases.ts:3449` iterates `p.battlefield` and no other
zone. The `oncePerTurn` gate that reads the tally is zone-blind on both the
mutation side (`convex/game.ts`, `assertActivationTimingLegal`) and the bot side
(`convex/gre/moves.ts`), so it applies to a graveyard activation exactly as it
does to a battlefield one. `resetBattlefieldTransientState`
(`convex/gre/state.ts`) is the only thing that clears the tally off the
battlefield, and it runs on ENTRY, not on the turn boundary.

**Why it may not deserve its own issue.** Latent: no shipped card carries both
`activateFromGraveyard` and `oncePerTurn` (grepped across
`convex/cards/sets/**`), so nothing reaches the path today. It becomes real the
first time a card does — Eternalize/Ashen Ghoul-shaped designs are one printing
away from it. Either a line on whatever tracker owns per-turn tallies, or a
one-line widening of the phase reset to every zone when a card first needs it.
