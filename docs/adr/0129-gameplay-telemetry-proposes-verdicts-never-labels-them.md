# Gameplay telemetry PROPOSES verdicts; only a judgement the player confirmed ever trains the evaluation

## Status

accepted (2026-09-14, "formato verdicts" grill session; extends ADR 0124,
builds on the corpus measurement of issue #3588)

## Context

The Verdict corpus is collected by hand: a tester judges a Bot decision in the
quiz and the judgement is stored. After months it holds 174 verdicts / 492
pairs, and the census in `docs/research/verdict-corpus-coverage.md` says what
that buys — 50 addressable pairs, 10.2%, no judgement given with a non-empty
stack, no targeting, no mulligan, combat at 21 pairs.

The obvious way to multiply it is to stop asking. A player is already thinking
hard about every decision; record the move they chose and the corpus grows by
itself, at no cost in attention. That is the proposal this ADR answers.

It has a defect that volume cannot fix. **A chosen move is not a right move.**
Two good moves in one position are normal, a hurried move is common, and a
player already winning plays sloppily on purpose. Worse, the subset where the
evaluation and the player DISAGREE — the only subset worth recording, since an
agreeing pair is a constraint already satisfied — is enriched in both directions
at once: it holds the positions where the evaluation is wrong AND the positions
where the player was careless, and nothing in the data separates them. Game
outcome cannot separate them either: ADR 0124 measured the margin's log-loss at
0.665 against a 0.693 coin flip.

Two further facts bound the design. First, harvesting without quotas makes
coverage WORSE as the corpus grows, because land drops and priority passes are
the overwhelming majority of decision points and are already the saturated
classes. Second, the corpus's problem is coverage, not volume: ten thousand
more land-drop judgements move nothing, while a hundred blocking judgements
would open a class that today states nothing.

## Decision

1. **Telemetry proposes; the player confirms.** A decision harvested from play
   is a PROPOSAL, never a label. At the end of the game the player is shown the
   proposals and confirms or rejects each with one tap. A confirmed proposal
   becomes an ordinary explicit Verdict under every ADR 0128 rule — content
   addressed, attested, conflict-quarantined. **An unconfirmed proposal is
   never a label**: it is kept, if at all, as an unjudged POSITION — useful
   material for cold judging, carrying no answer.
2. **What is proposed**: a decision with at least two materially distinct
   candidates, where the evaluation's own 1-ply preference differs from the
   move the player made by more than a margin of the fit's own order (`δ`).
   Plus a small random sample of AGREEING decisions, so the queue is not made
   only of boundary cases — a corpus of disagreements tells the fit where to
   move and never where to stop.
3. **Materially distinct is measured on the settled state, not the move.**
   Which Forest is tapped to cast the same creature is one option to the
   evaluation and several to the enumerator; candidates whose settled feature
   vectors coincide are one candidate here (issue #3593 removes the duplicate
   at the enumerator, which is the same fact one layer down).
4. **Disagreement is a margin, not an argmax.** A preferred candidate ahead by
   ε is a tie, and recording ties teaches noise.
5. **Capped and stratified.** Around ten proposals per game, ranked by
   violation margin, under per-class quotas derived from the census — without
   quotas the classes that are already saturated consume the whole cap.
6. **Harvested from games against the Bot and from solo mode only**, where the
   Brain already runs client-side and the position is already lowered for the
   trace ring. Human-versus-human waits: it adds a consent surface and an
   opponent-side question before the funnel's yield is even known.
7. **The source taxonomy keeps an explicit/implicit axis from the start**, even
   though nothing implicit trains today. ADR 0128 §6's contradiction quarantine
   applies to EXPLICIT judgements only: two players choosing differently in one
   position is not a contradiction to resolve, it is two reasonable lines.
8. **Measure the funnel before building it.** Instrument a few real games and
   count: decision points, survivors of the material filter, violations above
   the margin. The design assumes roughly ten a game; if it is three the
   confirmation step is free, and if it is sixty the whole shape needs
   rethinking. Nothing here is built before that number exists.

## Consequences

- The corpus grows at roughly ten judgements per game instead of a handful per
  session, and every one of them is a judgement somebody made deliberately.
- The confirmation step is the cost: a game ends with a short queue instead of
  nothing. It is also the only thing standing between the fit and a corpus of
  hurried moves.
- Cold judging and conflict resolution (PRD #3574) are the same surface as the
  proposal queue. Three needs, one screen.
- What telemetry does NOT fix: the classes the corpus cannot speak for. A
  harvested game produces the decisions that game offered, and no game offers
  many blocking decisions. Those positions are AUTHORED — the census names
  them, and issue #3588 lists them in priority order.
- Keeping unconfirmed proposals out of the corpus means the "free data" is not
  free and not data. That is deliberate, and reversible: if the measured funnel
  turns out to be small and clean, aggregation with a reduced trust weight can
  be added later, with the numbers to calibrate it.
