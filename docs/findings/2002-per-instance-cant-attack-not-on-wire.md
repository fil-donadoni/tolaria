---
title: CardInstanceState.cantAttackThisTurn (per-instance) never reaches the client
discoveredBy: 2002
status: draft
confidence: high
---

**What is wrong.** `CardInstanceState.cantAttackThisTurn` (the per-object flag
`setCantAttackThisTurn`/`restrictCombat`'s `"cant-attack"` mode sets — Fight or
Flight's unchosen pile) is not on the wire at all: it is absent from
`src/types/game.ts`'s `CardInstance` and from whatever `slimCard`
(`convex/gameProjections.ts`) forwards. `src/lib/attacker-eligibility.ts`'s
`isEligibleAttacker` — the client's sole "can this creature attack" authority,
feeding both the board's gray-out and the "Attack with all" button — has no
field to read even if it wanted to.

**Evidence.** `grep -n "cantAttackThisTurn" src/types/game.ts
convex/gameProjections.ts` returns nothing. Compare the GAME-scoped sibling
this issue's own PR added (`GameState.cantAttackThisTurn`), which reaches the
client for free through the `...state` spread in `projectPublicState` and is
now read in `isEligibleAttacker` — the per-instance flag has no equivalent
path.

**Consequence.** After Fight or Flight resolves, the creature on the unchosen
pile still reads as attack-eligible client-side: the board doesn't gray it
out, and clicking it to attack round-trips to the server before the player
learns the move is illegal.

**Why it may not deserve its own issue.** It might just be a line on whatever
tracker already covers Fight or Flight's client-side polish, if one exists —
worth checking before filing fresh. The fix shape is small (thread the flag
through the projection + `CardInstance` type + `isEligibleAttacker`'s existing
per-object checks) but touches a different layer (wire projection) than a pure
`GameState`-level forward, so it wasn't folded into #2002's diff.
