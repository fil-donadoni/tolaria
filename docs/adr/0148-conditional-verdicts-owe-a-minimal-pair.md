# A Conditional Verdict owes a Minimal Pair; the fit never reads half an argument

## Status

accepted — grilled 2026-09-28. Builds on ADR 0124 (Verdicts → fit → report),
ADR 0128 (store, lock, promotion) and ADR 0138 (held-out split, Admission);
amends 0138's split rule for paired Verdicts only.

## Context

A Verdict says which move is right, or — as a `forbidden` answer — which move
is not. Neither says WHY. "Pass with the instant in your own main phase" is
right because the opponent's end step is the last useful window, but the
Weight Fit sees only "casting the instant ranks below passing" and can
satisfy it with a weight meaning "casting instants is bad". The Evaluation
reads static boards; the reason a move is wrong NOW lives in what would have
to change for it to be right. The registry already knew this in prose — 34
`// PAIRED WITH:` halves, timing entries such as "holds Terror in its own
main" beside "exiles the attacker in the last window before damage" — but no
Verdict, lock or fit knew that two judgements formed one argument.

## Decision

- **Minimal Pair is generalised** from "differs by one card" to "differs by
  one Discriminant": a card, the step or phase, a life total, the mana
  available, the Stack, or a move already made (`sequence`). The
  Discriminant is the WHY, named by the judge from a closed list of kinds
  plus `other` with the judge's words (a recurring `other` phrase names the
  missing kind). Exactly one per pair.
- **A judge says which wrong they mean.** Absolute Verdict: wrong whatever
  changes — owes nothing. Conditional Verdict: wrong now — owes the right-hand
  half of a Minimal Pair.
- **Incomplete means out of the fit.** A Conditional Verdict without its
  pair stays in the Verdict Store and out of the Verdict Lock; Promotion skips
  it, and a new one cannot be admitted to `must`. A registry entry classified
  conditional and unpaired stays a Test Position (the gate keeps its
  coverage) but is skipped by the fit. Existing `must` entries are not
  demoted; they are listed as debt.
- **The right-hand half is derived, never linked.** It is the anchor's
  Scenario Spec copied with only the Discriminant changed (prefilled by
  kind); for `sequence`, the anchor with the earlier move applied through
  real setup steps. A move that leaves no trace on the board yields two
  identical feature vectors and the pair is refused, like the `history` gap.
- **Anyone may write the missing half.** Each half carries its own
  Attestations; a disputed half is an ordinary Contested Position. A judge
  may defer the half at judgement time; the incomplete Verdict waits in a
  queue beside the Verdict Proposals.
- **Fit math is unchanged; the report is per pair.** Each half yields its
  Eval Pairs as today. A pair with one half satisfied means the fit settled
  on "always" or "never", and the report names the Discriminant no term
  reads.
- **Split (amends ADR 0138):** the right-hand half inherits the anchor's
  held-out side instead of hashing its own spec. Nothing already assigned
  moves. If the derived board is one already judged on the other side, the
  pair is not formed.

## Considered options

- A separate "counter-verdict" concept beside Minimal Pair — rejected: same
  mechanism, two words for one thing.
- Pair optional everywhere, a coverage report only — rejected: an unpaired
  conditional judgement actively teaches "never".
- A joint fit constraint on the difference between the two evaluations —
  rejected for now: the per-pair report gives the diagnosis without changing
  the fit.
- Linking any existing position as the right-hand half — rejected: two
  boards differing in ten things attribute the difference to the wrong term.

## Consequences

- The first Promotion after registry classification drops unpaired
  conditional Verdicts from the fit; the weights may move, and that delta is
  read as intended.
- Every registry entry gains a mandatory absolute/conditional
  classification; the 34 prose pairs convert only after a hand check that
  they differ by one Discriminant.
