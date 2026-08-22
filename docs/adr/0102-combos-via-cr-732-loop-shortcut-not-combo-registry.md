# Combos are found through a CR 732 loop shortcut the engine offers as a Move, never through a per-card combo registry

## Status

accepted (2026-08-22, bot-roadmap grilling session; map #1892)

## Context

The play Bot's knowledge comes from two sources and only two, fixed when the
first map (#1254) was charted: the ISMCTS search over the real engine, and the
DSL semantic layer (per-Op valuers, beneficence, `aiEffects`). _Per-card_
knowledge — "Damnation is bad on an empty board", "Splinter Twin + Deceiver
Exarch is a combo" — is rejected as a source because it does not scale (the
catalogue target is ~80k cards) and because a fix that names a card moves one
card while every other card of the same shape stays broken.

Two-card infinite combos put that rule under pressure, because the search
genuinely cannot see them. Stifle + Phyrexian Dreadnought is found at 100
iterations: two plies, payoff at the leaf. Splinter Twin + Deceiver Exarch is
not: activate → token ETB trigger → resolve (untap the original) → activate →
… ×20 → attack is ~40 plies of identical moves before the evaluation sees
lethal, and a 1-ply-greedy ε=0.25 rollout never walks it. The gap is the
**horizon**, not the valuation.

A per-combo boost layer was drafted on `main` (`convex/gre/ai/comboAnnotations.ts`,
2026-08-11): registered card ids with progressive stage boosts added to the
evaluation (+200 with one piece out, +500 000 once the Aura is attached).
Measured (blade entries `combo: activates Splinter Twin on enchanted Deceiver
Exarch`, 400/1200/4000 iterations, five seeds): the activation is chosen 2/5,
then 1/5, then 0/5 — more search converges _away_. The mechanism: the boost is
a function of the **state** (pieces on the board), identical before and after
the activation, and at +500 000 it saturates the material signal, so every leaf
in the subtree scores the same maximum and the pick is rollout noise. The same
saturation flattens every other decision the Bot makes while both pieces are
out. And it is one registration per combo, by UUID, by hand.

The Comprehensive Rules already name the missing concept. CR 732.2a: a player
with priority "may suggest a shortcut by describing a sequence of game choices
… a loop that repeats a specified number of times", with the official example
being Presence of Gond + Intruder Alarm ("I'll create a million tokens");
732.2b lets each other player accept or name the point where they will deviate.
The engine has no shortcut today — humans click twenty times, the Bot cannot
see the end of the loop at all.

## Decision

1. **`comboAnnotations.ts` is deleted.** No per-card or per-combo boost layer
   exists in the evaluation or the reward. The three Twin/Exarch blade entries
   stay `stretch` with cause `horizon` until the shortcut lands, then become
   `must`.
2. **Loops are an engine capability, per CR 732**: the GRE recognises a
   sequence of one player's own actions (opponent passing throughout) that
   returns the game to the same shape with strictly more of a monotone resource
   (tokens, life, mana, counters), and offers it as a Move `repeat-loop ×N`.
   Three consumers of the one primitive: the human UI (a "repeat ×N"
   affordance), the Bot's enumerator (one Move whose payoff is visible one ply
   later, so the evaluation sees twenty hasty 1/4s and enters the won band),
   and the opponent's 732.2b right to name a stopping point (for the Bot, the
   ply at which it responds).
3. **Recognition is precondition-gated, never a search over interactions.**
   The check runs only after an activation applied in the search has resolved,
   and only when (a) the same move is legal again at zero mana cost and (b) a
   monotone resource strictly increased. Otherwise it costs one fingerprint
   comparison. When it fires it _reduces_ search cost: ~40 plies collapse into
   one.
4. **Scheduling**: the shortcut is a PRD of its own, behind the structural
   strength steps (reward calibration, priors on the action space), not ahead
   of them.

## Consequences

- Kiki-Jiki, Pestermite, Zealous Conscripts, Restoration Angel loops, Presence
  of Gond + Intruder Alarm, and infinite life/mana loops are all found by the
  same primitive with zero card names. A new combo card needs no Bot work.
- The evaluation keeps a single, unsaturated scale; no decision elsewhere is
  flattened by a combo being on the board.
- Humans gain the CR 732 shortcut they were owed anyway.
- Cost: engine work (loop fingerprint, Move kind across enumerator / executor /
  UI / bot realisation) — larger than a boost table, paid once.

## Alternatives considered

- **Keep the boost layer, tune the numbers.** A state-based boost cannot
  discriminate activate from pass (both states hold the pieces), and any
  boost large enough to matter saturates the signal; below saturation it is a
  per-card eval term, rejected since #1254.
- **Deeper rollouts / higher budget for combo shapes.** Strength grows with
  log(time) (research #1894); forty plies of identical moves is outside any
  budget a browser Worker gets, and "when is it a combo shape" would itself be
  per-card knowledge.
- **A `repeatable` flag on the card definition.** Per-card again, and wrong:
  whether an action repeats depends on the board (the untapper must be there),
  not on the card.
