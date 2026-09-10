# The evaluation's weights are fitted from player Verdicts by a deterministic Weight Fit, never hand-picked and never tuned on the Ladder

## Status

accepted (2026-09-10, "Grill sul game bot" session; map #1892, issue #3393)

## Context

The play Bot's leaf evaluation (`convex/gre/evaluate.ts`, weights in
`convex/gre/ai/evalWeights.ts`) is a hand-weighted sum: `W_LIFE = 8`,
`W_MANA = 12`, a permanent 5, a vanilla 2/2 ≈ 170 (Forge scale), a card in
hand its Effect Script value with `DESTROY_VALUE = 160` for any removal.
Every constant was picked once (issue #149 and after) and none was ever
fitted; map #1892 recorded that as evidence 5 in July and it was still true
in September. The consequences were measured, not argued:

- the margin barely predicts the winner — log-loss 0.665 against a 0.693
  coin flip, and nothing at all before turn 8 (`docs/research/reward-calibration.md`);
- 66% of real root picks fall to the material tie-break and 14% to a named
  rule; the search's own reward decides 17–20% (issue #1893);
- the 1-ply greedy policy alone holds 71% of the blade `must` floor; of the
  35 positions only the search gets right, 17 are "pass instead of act"
  (`docs/research/greedy-vs-search.md`, issue #3393);
- Stone Rain with idle mana against three Forests: announcing it costs 205
  margin points (the spell's latent 160 leaves the hand, the land it will
  destroy is worth 17 on the board), so greedy and search both pass, every
  seed (issue #3322 reproduced). A removal spell's latent worth is one
  constant whatever it could hit; the board it hits is priced in another
  currency.

Two roads to fitted weights were on the table. The roadmap's step 5 fits a
linear evaluation on the **Ladder corpus** (self-play outcomes): it needs
hours of gate-mutex machine time per corpus, the games are played by the
weak bot being fitted, and the outcome label carries almost no information
about a single decision (the log-loss above is that fact). The alternative
fits on **player judgement**: a human says, for one position the Bot faced,
which of the enumerated candidate moves is right.

## Decision

1. **Verdicts are the training data.** A Verdict is a position (as a
   `ScenarioSpec`, the projection the Bot itself saw), the candidate moves
   `enumerateMoves` offered there, and the right one. Kept as position and
   answer, never as feature numbers, so it survives every change to the
   evaluation's terms. Sources, in order: the blade registry's `moves`
   expectations (verdicts already), verdicts given **in play** by a tester
   judging the Bot's move against the candidate list, and the reported
   blunders that today would have become a root rule.
2. **Eval Pairs are the evaluation's own correctness metric**, beside the
   blade suite (the search's): the board after the right move must outscore
   the board after every other candidate under the evaluation alone, no
   search, microseconds. A blunder becomes an Eval Pair before it becomes a
   blade entry.
3. **The Weight Fit is deterministic and regularised.** Each Eval Pair is a
   constraint `w · (x(right) − x(other)) ≥ δ` over the unweighted term vector
   `x` read from the 1-ply settled state (`policyValue`'s probe); the fit
   minimises a hinge loss plus `λ‖w − w0‖²` toward the current vector, under
   sign constraints and a fixed numeraire (life), by a fixed number of
   gradient steps. Same verdicts, same weights, to the bit. The fitted
   vector lands as code; a guard re-runs the fit and demands the committed
   vector; the pairs the fit could not satisfy are reported, never dropped —
   they name a missing term.
4. **Latent script value is per feature-basis dimension and board-aware.**
   `DESTROY_VALUE`-style constants become one fittable weight per
   `FEATURE_BASIS` dimension, and a targeted Op's latent worth is that weight
   times the realised board loss of its best legal target on the current
   board — Llanowar Elves and Shivan Dragon, a creature and an enchantment,
   priced by what they are worth where they stand. Card-agnostic (ADR 0102).
5. **Moratorium on root rules.** A blunder yields Verdicts, then a fit; a
   new `RootDecisionMechanism` is added only with the proof that the two
   candidates share one feature vector under any term (timing, hidden
   information), recorded in an allowlist a guard test enforces. The eleven
   existing rules stay until proven inert by two deterministic measures: zero
   `flipped` picks in the decision-telemetry corpus, and the `must` suite
   green with the rule disabled through a `SearchVariant` knob.
6. **The Ladder is not a tuning loop.** It stays the strength metric for
   changes that shift every decision a little (ADR 0070 §1); no weight fit
   owes a ladder run.

First slice: the fit over the registry's verdicts plus the latent weights,
no intake surface, proven by the greedy blade pass-rate and a green `must`
suite; the in-game intake follows. The policy-first question (whether the
search should decide at the root at all, issue #3393's corpus half) is a
separate decision and is not settled here.

## Consequences

- Blunder reports stop producing code by default. The 11-rule chain stops
  growing; the evaluation stops being a pile of one-position constants.
- A tester who cannot read ISMCTS can still train the Bot, by answering
  "which move here?" — the owner's stated need (issue #3393 grill).
- A Verdict that no weight vector can satisfy is a finding about a missing
  term, surfaced by the fit's report instead of by the next blunder.
- What the fit cannot do: invent a term, see past one ply, or resolve hidden
  information. Timing and bluff stay where the search and the (frozen) root
  rules are.
- The blade `must` suite remains the gate; a refit that reds a `must` entry
  does not land until the conflict is understood (a wrong verdict, or a
  preference the search encodes and the evaluation cannot).
- Supersedes map #1892's step 5 (fit on the ladder corpus). Extends ADR 0070
  (metrics) and ADR 0102 (no per-card knowledge).
