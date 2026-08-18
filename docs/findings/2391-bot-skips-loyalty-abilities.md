---
title: The bot enumerates no loyalty ability of any planeswalker, catalogue-wide
discoveredBy: 2391
status: draft
confidence: high
---

**What is wrong.** `enumerateActivatedAbilityMoves` (`convex/gre/moves.ts`) drops
every ability whose cost carries a `loyalty` leg, so the bot has never played a
planeswalker ability — not Teferi's, not Sorin's, not Minsc & Boo's, not
Grist's. Planeswalkers are therefore cast (they are ordinary permanents to the
cast planner) and then sit at their starting loyalty forever, while the search
still pays their mana. Every planeswalker in the pool is affected identically;
nothing about issue #2391's card is special here.

**Evidence.** `convex/gre/moves.ts:1097-1103`:

```ts
// CR 606 — a loyalty ability (planeswalker) has a signed `cost.loyalty`
// and sorcery-speed / one-per-turn / not-below-0 gates the move planner
// doesn't yet cost or fund. Bot planeswalker play is a follow-up to the
// loyalty FRAMEWORK slice (issue #700, ADR 0058); skip these for now so
// the bot never enumerates an unpayable/mis-costed loyalty move. The
// server (`assertLoyaltyActivationLegal`) rejects them regardless.
if (ability.cost.loyalty !== undefined) continue;
```

The server-side rules it defers to are all present and shipped:
`assertLoyaltyActivationLegal` / `payLoyaltyCost` (`convex/game.ts:5640-5688`)
already enforce CR 606.3 sorcery timing, the once-per-turn lock
(`CardInstanceState.loyaltyActivatedThisTurn`) and the CR 606.6 "can't go below
0" rule. What is missing is the MOVE side: enumeration gated on those same three
predicates, plus a valuation that prices a loyalty change (the `aiEffects` /
`effects` walk already prices the ability's EFFECT, but not the counter swing or
the board presence a planeswalker defends).

**Why it may not deserve its own issue.** It may already be exactly what issue
#700 / ADR 0058 tracks as the "bot planeswalker play" follow-up, in which case
this is a line on that issue rather than a new one. It is also genuinely a
`/bot-slice` job — enumeration, funding, valuation and a deterministic blade
scenario — not a patch, so cutting it as a ticket only helps if someone intends
to run that slice. Worth checking #700's current scope before filing.
