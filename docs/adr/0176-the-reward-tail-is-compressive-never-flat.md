# The reward tail is a measured variant: the hard clip past ±materialFull is blind, and not the reason the Bot gifted three cards

## Status

accepted (2026-11-09, issue #8954). Records a measurement that OVERTURNS the
issue's own brief, and the design it leaves behind a knob. Amends the
reward-band design of ADR 0018 (`terminalBand` / `materialFull`,
`rewardFromValue` in `convex/gre/search.ts`); complements the rejected
calibrated logistic of issue #1929 (`docs/research/reward-calibration.md`,
ADR 0138). Evidence: `convex/gre/__tests__/rewardMapping.bot.test.ts`,
`convex/gre/ai/__tests__/rewardTail.bot.test.ts`, the four `issue #8954`
blade entries, and the traces below (base `03773bca3`, seed 1).

## Context

The search learns from `rewardFromValue(evaluate(leaf))`: the terminal
quarter bands hold wins and losses, the open middle maps the material margin
through `materialSignal`, linear at a fixed slope until it saturates at
±`materialFull` (500 points, about three vanilla creatures). Past the clip
every leaf maps to the SAME reward, so in any position a few creatures from
level the search sees nothing that does not end the game inside the horizon.

Issue #8954 reported the Bot casting the prepared copy of Ancestral Recall
(Emeritus of Ideation, CR 722.3c) at its human opponent, and its brief named
the clip as the measured root cause: both "I draw three" and "they draw
three" leaves sat past −500 and scored the band floor, while the
saturation-proof `meanMargin` tie-break (−848 against −1616) only ranks inside
`outcomeEps`. The brief offered two directions — a compressive tail, or a
selection rule for pinned candidates — and asked for the knee to be measured
against issue #1929's objection (the calibrated logistic moved the slope at
margin 0 and turned 93% of root decisions into ties).

## What was measured

All numbers: the reconstructed prod position (report state, cast undone,
priority to the Bot), 600 iterations, seed 1, mean reward / visits of the
four root candidates — the self-cast, the misdirected cast, `pass`, the
Brazen Borrower cast. The base vector's hard clip reproduces the report:
misdirected 0.237 / 157 first, self 0.210 / 140 last; at 3 000 iterations
0.233 / 814 against 0.217 / 686, the gap growing with budget.

1. **A compressive tail, read by leaves AND by the rollout default policy**
   (`selectRolloutMove` ranks by `rewardFromValue(policyValue)`): knee
   `materialLinearShare` 0.5 puts the self-cast first and the misdirected cast
   last (0.245 against 0.199; at 3 000, 0.247 / 864 against 0.218 / 566); 0.6
   the same (0.2305 against 0.1980); 0.7 leaves a third candidate first with
   the misdirected one last; 0.9 keeps the order by 0.012; 0.8 is nearly blind
   again (0.1974 against 0.1971). The `must` blade under 0.5: 8 of 540 entries
   red, all green again under the clip with either weight vector — Toxic
   Deluge paying to lethal, the poison-clock Terror target, two Triangle of
   War activations, Wan Shi Tong's X, Overlord's impending, a protection
   colour, Scarland Thrinax; 0.6 and 0.9 each leave two of them red and 0.7 /
   0.8 others. Their traces share one shape: the entry's clearance under the
   clip was a few thousandths of reward or a handful of margin points, and the
   tail moved the rollouts.
2. **Why the rollouts moved.** The policy's argmax over a CLIPPED reward is a
   coin flip for the side that is far ahead — every candidate ties — so a
   far-behind Bot was being rolled out against a random opponent. Any tail
   makes that opponent greedy again: the Bot's far-behind lines collapse
   toward the loss floor (Toxic Deluge: survivors 0.05 → 0.005, so the suicide
   cast at exactly 0.0 came back inside `outcomeEps` and the material
   tie-break took it), and far-ahead positions get their visits
   redistributed.
3. **The outcome band read in margin points** (`outcomeEps` compared through
   the inverse of `rewardFromValue`, 100 points everywhere) brought 7 of the 8
   back and broke 5 others (Tamiyo's Safekeeping, Zuran Orb, a wasteful
   attack, an end-step sacrifice engine, a Vindicate fan-out): Jensen's
   inequality on a concave tail reads a wide far-behind distribution as
   further away than its mean margin says (72 points apart by `meanMargin`,
   115 by the inverse of the mean reward), and across the open/loss seam the
   two bands' slopes differ. Rejected: a semantic change to every root rule,
   tuned by hand against the blade.
4. **The policy ranked by the raw `evaluate` value** (no band at all) does
   not fix the position (misdirected 0.1829 against self 0.1739 at knee 0.9):
   the bias is not the random opponent. **Leaves on the tail with the policy
   kept on the clip** — the one variant that leaves every rollout byte-identical
   — does not fix it either (misdirected 0.2518 against self 0.2355 at knee
   0.6, 0.2364 against 0.2274 at 0.9). So the leaf blindness is real and the
   tail removes it, but the misdirected cast is carried by the rollout policy
   itself: a greedy one-ply opponent with three more cards in hand develops
   rather than attacks, and the Bot's leaves read safer. That is a policy /
   evaluation gap, outside this change.
5. Held-out pick agreement (`bun run verdicts:pick-agreement`, n = 24): 13/24
   under the clip, 13/24 under tail 0.5 with refitted weights, 13/24 under
   tail 0.6 with the margin band — two verdicts trade one seed each. No
   signal at this n.

## Decision

- `materialSignal` gains a compressive tail behind a new `EvalWeights`
  constant, `materialLinearShare` (`FIT_BASE_EVAL_WEIGHTS`, never fitted):
  with `x = margin / materialFull` and `a` the share, `signal = x` for
  `|x| ≤ a`, else `sign(x) · (a + (1 − a) · t / (1 + t))`,
  `t = (|x| − a) / (1 − a)`. Slope 1 at the knee, decaying as `1 / (1 + t)²`,
  never reaching ±1 for a finite margin. **The base vector keeps `1`, the
  hard clip, byte-identical to before**; the ladder variant `reward-soft-tail`
  sets 0.6. The terminal bands keep the clip in every vector
  (`clippedMaterialSignal`): inside a won or lost band the margin is an
  outcome tie-break, and the clip is what keeps a certain loss with surviving
  material a full `outcomeEps` under a line that merely dies most of the time.
- The root selection is unchanged (`outcomeEps` stays a band on mean reward).
- The blade matcher resolves a prepare spell's exiled copy by the name it
  presents (`instanceIdsForName`, CR 722.3c), so the reported position is
  expressible; four `issue #8954` entries guard the shape — the reported
  position, the hand-cast draw, and a removal pair far behind — all green
  under the base vector and under the variant.
- Why issue #1929's objection does not apply to the variant: the knee sits at
  300 points, so the slope at margin 0 and the indifference band around it
  are byte-identical; only what the clip set to zero changes.

## Consequences

- Issue #8954 is NOT closed by this change: the reward tail is the measuring
  instrument, not the fix. The fix is one of (a) an outcome-aware material
  tie-break — `Edge.totalMargin` counts a terminal loss as surviving
  material today, which is how a certain loss wins a tie on material — and
  (b) the rollout default policy's one-ply myopia with a large hand (develop
  over attack), which is what rewards gifting cards. Both are design
  decisions for the owner; both are measurable with `reward-soft-tail` on.
- A blade `moves` entry obliges a refit (`bun run bot:refit` on the base,
  ADR 0157 Amendment II); the PR carries none of its artefacts.
- `REWARD_PER_MARGIN_POINT` stays the core slope; under the variant the
  decision telemetry's margin-point reading of a gap in the tail understates
  it.
