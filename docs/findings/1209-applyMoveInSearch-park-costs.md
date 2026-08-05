---
title: The search's activate-ability branch still pays no park cost, so a payment the bot now really makes is invisible to the evaluation that chose it
discoveredBy: 1209
status: draft
confidence: high
---

**What is wrong.** #1209 makes the live bot actually PAY every payment park
(sacrifice a creature, discard a card, tap three bodies, exile from a graveyard).
The ISMCTS search still models none of it: `applyMoveInSearch`'s
`activate-ability` case applies the tap plan and taps the source and stops. So
the position the search evaluates for "activate Survival of the Fittest" has the
same hand it started with, and the position the game reaches is a card down. The
gap widened with this issue — before it the move simply hung, which at least
could not be scored favourably.

**Evidence.** `convex/gre/search.ts:434` (`applyMoveInSearch`), the
`activate-ability` case around `search.ts:635`, versus
`convex/gre/applyMove.ts` (`applyMoveForSearch`), whose `activate-ability` case
applies `move.costPicks` in full — sacrifice victims, `tapOtherIds`,
`exileFromGraveyard`, `discardIds`. The greedy 1-ply sandbox and the search
therefore disagree about what an activation costs. `convex/gre/paymentPicks.ts`
now exists precisely so a third caller can be wired without a second opinion.

**Why it may not deserve its own issue.** It already has one — **#2155**, split
out of #1209 by the 2026-08-04 audit, and #1209's own scope note names
`applyMoveInSearch` as explicitly out of scope. This finding records that
#1209's landing did not narrow #2155 and in fact makes its payoff larger: the
picks are now real, so the mis-valuation is now a real mis-valuation rather than
a hang. If #2155 is being sequenced, this is the argument for sooner.

---

**Second, larger-than-first-thought observation, fixed in this PR rather than
left as a finding (recorded here because the CLASS matters more than the site).**
A filter evaluated against the RAW `CardInstanceState` instead of the layered
view. `matchesPermanentFilter` takes a `MatchablePermanent` and a raw instance is
STRUCTURALLY assignable to one — so it type-checks and is wrong: `colors`
(CR 202.2 / 613.1d), `power`/`toughness` (CR 613) and
`enteredThisTurn`/`controlledSinceTurnStart` (CR 400.7) are all DERIVED and
absent from the instance, so every clause over them fails CLOSED, silently, as an
empty candidate list rather than an error.

The first pass of this PR fixed ONE site (`activationCostPicks.ts`'s
`tapOtherCandidates`) and its regression test called `planActivationCostPicks`
directly — so it went green while the end-to-end path was still dead. Review
finding F2 caught that. The true count on the cost / payment / move-enumeration
path was **SEVEN raw call sites**, not the three this note originally claimed:

| Site                                     | What it gated                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `convex/gre/moves.ts` (tapOtherFilter)   | the enumerator's OWN payability pre-check — `enumerateMoves` returned ZERO activations for Hand of Justice               |
| `convex/gre/moves.ts` (sacrificeFilter)  | every colour-filtered sacrifice cost (Thelonite Monk, Homarid Spawning Bed, Freyalise Supplicant) invisible to the bot   |
| `convex/gre/moves.ts` (copySourceFilter) | a colour-filtered copy-on-ETB cast silently suppressed for the bot                                                       |
| `convex/game.ts` ×2 (sacrificeFilter)    | the SERVER's announce-time legality gates, disagreeing with `sacrificeCandidates` — the scan that then builds the picker |
| `src/lib/ai/bot-view.ts` (mayPay)        | a colour-filtered may-pay sacrifice leg always judged unaffordable                                                       |
| `src/lib/ai/selfplay/playGame.ts`        | the headless harness's pending-choice candidate pool                                                                     |

All seven now go through one helper — `effectivePermanentView`
(`convex/gre/permanentView.ts`, moved down out of `phases.ts` so the cost path
can import it) server-side, `projectedPermanentView` (`src/lib/ai/bot-view.ts`)
over the wire projection — and `scripts/__tests__/permanent-filter-view.test.ts`
fails if any call site on that path ever passes a bare instance again. The
regression tests now drive `enumerateMoves` end to end rather than the planner.
