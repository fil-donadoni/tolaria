# The reward tail is compressive, never flat: the open band stays monotone past ±materialFull

## Status

accepted (2026-11-09, issue #8954). Amends the reward-band design of ADR 0018
(`terminalBand` / `materialFull`, `rewardFromValue` in `convex/gre/search.ts`)
and records why the objection that rejected the calibrated logistic (issue
#1929, `docs/research/reward-calibration.md`, ADR 0138) does not apply here.
Evidence: `convex/gre/__tests__/rewardMapping.bot.test.ts`,
`convex/gre/ai/__tests__/rewardTail.bot.test.ts`, the four `issue #8954` blade
entries.

## Context

The search learns from `rewardFromValue(evaluate(leaf))`: the terminal quarter
bands hold wins and losses, the open middle maps the material margin through
`materialSignal`, linear at a fixed slope until it saturated at
±`materialFull` (500 points, about three vanilla creatures). Linear was
deliberate — one creature's worth must move the reward by the same amount
wherever the margin sits — and the clip was its unexamined corollary.

The clip is a blindness. Every leaf more than `materialFull` behind (or ahead)
mapped to the SAME reward, so in any position a few creatures from level the
search could see nothing that did not end the game inside the horizon: card
draw, removal, development, life were all worth exactly zero. The reported
position (issue #8954, prod game `jh76x5x3991a6amscmeq1vx83h8hv3ra`) makes it
exact: the static evaluation after resolution read "the Bot draws three" at
+151 and "the opponent draws three" at −194, yet at the horizon both leaves sat
past −500, both scored the band floor, and the root's mean reward ranked the
misdirected cast first (0.237 against 0.210 at 600 iterations, 0.233 against
0.217 at 3 000 — the gap grew with budget, because what moved the mean was how
often the rollout died, not the cards). The saturation-proof `meanMargin`
tie-break (issue #138) knew better (−848 against −1616) but ranks only inside
`outcomeEps` of the best mean, and residue had pushed the right variant out of
it. Older scars of the same clip: issue #2147's chump-block entry rode a 0.015
clearance until a search-model change moved the noise (PR #3092); issue
#4878 re-cut a blade board to keep both branches inside the band.

The one alternative already measured — the calibrated logistic of issue #1929
— was rejected for moving the slope AT ZERO: it widened the indifference band
at margin 0 from 100 to 400 points and the share of root decisions reaching
the selection rules as a tie rose from 81.6% to 93.2%. The resolution near 0
is where most decisions live and must not move.

## Decision

- `materialSignal` keeps its linear core and replaces the flat tail with a
  compressive one. With `x = margin / materialFull` and
  `a = materialLinearShare` (a new `EvalWeights` constant, base vector 0.5):
  `signal = x` for `|x| ≤ a`, else `sign(x) · (a + (1 − a) · t / (1 + t))`
  with `t = (|x| − a) / (1 − a)`. The tail's slope is 1 at the knee (no kink)
  and decays as `1 / (1 + t)²`; the signal approaches ±1 for every finite
  margin and never reaches it. `materialLinearShare = 1` is the historical
  clip, byte-identical, kept as the ladder variant `reward-hard-clip`.
- The open band is therefore **strictly monotone in the leaf margin
  everywhere** (`rewardMapping.bot.test.ts`), the core — every margin within
  ±`a · materialFull` — is **byte-identical** to before, `rewardPerMarginPoint`
  is still the core slope, and the terminal bands keep the same tail for their
  surviving-material tie-break.
- Why the #1929 objection does not apply: the objection was to the slope at
  margin 0 and to the indifference band around it. Neither moves — the knee
  sits at 250 points, so every decision the calibration flattened is
  unchanged; what changes is only what the clip had set to zero.
- The knee was measured, not guessed: on the reconstructed prod position at
  600 iterations (seed 1, base `03773bca3`) `a = 0.3` and `a = 0.5` both put the
  self-cast first and the misdirected cast last (gaps 0.041 and 0.046 in mean
  reward), `a = 0.7` left a third candidate first, `a = 1` reproduced the
  report. At 3 000 iterations `a = 0.5` holds (0.247 / 864 visits against 0.218
  / 566; before: 0.233 / 814 against 0.217 / 686, the misdirected cast first).

## Consequences

- A `Edge` reward in the tail carries real information again, so a root pick
  far behind or far ahead no longer depends on a rule rescuing it inside
  `outcomeEps`; the `material-tiebreak` confirms the search instead of
  overruling it (`rewardTail.bot.test.ts`: under `reward-hard-clip` every
  root candidate of the far-behind entry scores exactly 0.25, with the tail
  they are distinct and ordered self-draw > pass > opponent-draw).
- **What the tail does not do.** The band is bounded, so the quarter of the
  half-band left for the tail is spread over every margin past the knee: at
  two `materialFull` behind the slope is about a tenth of the core's, and a
  three-card swing is worth about 0.01 reward there — inside `outcomeEps`.
  Small far-behind differences therefore still reach `selectRootMove` as
  outcome-equal contenders and are settled by `meanMargin`, which is right:
  `outcomeEps` is the rollout-residue noise floor in reward units, and a
  difference below it is not a search verdict whatever the mapping. Issue
  #8954's acceptance line "decided by a mechanism other than
  `material-tiebreak`" is unattainable under any bounded band and is replaced
  by the search-level ordering above. Making the far tail decisive would need
  a leaner residue (fewer rollouts dying by policy accident), not a steeper
  tail.
- `REWARD_PER_MARGIN_POINT` converts a reward gap into margin points at the
  CORE slope only; the decision telemetry's margin-point readings of gaps
  between far-behind candidates understate them.
- The extra-turn credit (`extraTurnRewardCredit`) maps `extraTurnValue` (350)
  through the same function and so now lands at 0.161 instead of 0.175 of
  reward; the `must` blade stays green with it.
- `materialLinearShare` lives in `FIT_BASE_EVAL_WEIGHTS`, never fitted: it
  shapes the reward the fit is read through, like `materialFull` itself.
