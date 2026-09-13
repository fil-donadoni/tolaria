---
title: The colour-coverage demand estimate makes exile-based removal score worse than destruction
discoveredBy: 3532
status: draft
confidence: high
---

**What is wrong.** `colorCoverage` (issue #3532) estimates the opponent's colour
DEMAND from live public evidence, and a permanent's evidence survives its own
death: `observedOpponentColors` weighs a battlefield permanent's effective
colour at 3 and a graveyard card's static colour at the same 3. So killing a
creature preserves the colour it evidenced, while EXILING or BOUNCING it deletes
that evidence — and deleting an UNCOVERED colour's evidence raises the
opponent's coverage ratio, which lowers the bot's margin. The bot therefore
prefers destruction to exile for a reason that has nothing to do with either
player's mana base.

**Evidence.** Measured on the shipped module (a green creature, a Swamp, a black
card in the opponent's graveyard; committed weights,
`colorCoverageWeight: 26.419658`):

| board                                      | `observedColorCoverage` |
| ------------------------------------------ | ----------------------- |
| before                                     | 0.5714                  |
| creature DESTROYED (goes to the graveyard) | 0.5714                  |
| creature EXILED                            | 1.0                     |

11.32 margin points, against exile. `convex/gre/ai/colorCoverage.ts:140`
(`observedColorCoverage`) reads the mass; `convex/gre/ai/observedColors.ts:75`
(`COMMITTED_WEIGHT`) is why a dead creature keeps its colour. The same shape
applies to bounce and to graveyard hate, and to any effect that removes evidence
of a colour the opponent cannot currently produce.

A smaller sibling, same root: the opponent's demand includes an UNTAPPED
source's producible colour, so tapping that source re-bases the ratio —
measured 0.25 → 0 (6.60 points) when a lone Plains taps, unwinding at their next
untap step. That one is documented in the module header as a deliberate cost of
sharing ONE evidence derivation with every other colour heuristic (issue #2306).

**Why it may not deserve its own issue.** It cannot stop a removal from
happening: 11.32 points against a creature's 130+ and a removal Op's ~115, so it
only ever breaks a tie between two removal spells that are otherwise identical
to the evaluator — which is real but narrow. And it is INHERENT to estimating
demand from live evidence, which is what PRD #3526 mandates: no weight fixes it,
and every alternative shape tried during issue #3532 (a capped shortfall instead
of a ratio) fixes the tap sibling and leaves this one exactly where it is. A
real fix means a demand estimate that does not shrink when evidence leaves the
game — sticky per-colour demand, or a deck-knowledge prior at `expert`
(PRD #2787) — which is a design question for the PRD, not a defect in this
slice. If that is the answer, this is a line on PRD #3526 rather than a ticket.
