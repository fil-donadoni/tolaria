# The rollout probes the decline and the best two, never every candidate

## Status

accepted (2026-11-22, owner ruling on issue #10134, recorded in
`docs/research/rollout-policy-cost.md` § 6; implemented by issue #10473,
PRD issue #10017). Amends [ADR 0021](0021-stronger-opponent-model-and-temporal-flexibility.md)
§ 2: its greedy 1-ply default policy stands, but it no longer probes every
candidate of a rollout ply. [ADR 0015](0015-rollout-terminates-at-turn-boundary.md)'s
horizon is untouched.

## Context

At every rollout ply with a real choice, the default policy of ADR 0021
(`selectRolloutMove`) cloned the state, applied, settled and evaluated
**every** candidate before playing one. On four late-game production boards
those probes were 62–73% of a search: 7–12 probing plies per rollout, 5–8
candidates each (`rollout-policy-cost.md` § 1, `f98284f5b`, 2026-11-22). The
note measured cheaper policies against it: probing `pass` plus the best K − 1
by a static per-move-kind rank (`topk:K`) made an iteration 1.6–2.4× faster on
those boards at K = 3 and flipped none of the 574 searched `must` entries at
their declared budgets; K = 2 lost a tested decision in every arm, K = 4 was
slower and kept no more (§§ 2–3). The owner ruled for K = 3 (§ 6).

## Decision

1. **Inside a rollout, a ply with more than `ROLLOUT_PROBE_CAP` = 3
   candidates probes three**: the ply's decline and the best two of the rest
   (`rolloutProbeCandidates`, `convex/gre/rolloutProbeCut.ts`). A ply with
   three or fewer is probed whole, as before.
2. **The decline is never cut.** It is `pass`, or, on a declaration ply,
   which offers no `pass`, the empty attack or block declaration. The note's
   bench ranked the empty declaration just above `pass` but let it fall to
   the cut; kept, a mover that has three attacks or blocks on offer can still
   decline them in a playout (the owner's ruling of 2026-11-22, attended
   session of issue #10473).
3. **"Best" is three keys, in order.**
    - **A repeat last**: a candidate `collapseInterchangeableMoves` (issue
      #3593) folds into another, the same play on another copy of the same
      card, ranks after every candidate that does something else. Its probe
      would tell the pick nothing the representative's did not.
    - **The move-kind rank the note measured**: land > cast > activation /
      attack / block > turn face up / foretell / plot / companion > other.
      What kind of move it is, never a card (ADR 0102).
    - **By lot** between equal kinds, one draw per candidate from the
      rollout's own stream. The kind rank cannot tell two candidates of one
      kind apart, and enumeration order drops the same one, the last target or
      the last attacker, in every rollout. The owner's ruling of 2026-11-22
      (attended session of issue #10473).
4. **Only the rollout's use.** The greedy pick's other readers probe every
   candidate as before: `greedyRootPick` (the blade's greedy leg), the
   greedy-concordance key in `searchWithTrace`, and `controlledSeatPick`
   (CR 723.5, ADR 0181).
5. **Determinism as before**: fixed iterations, the lot drawn from the
   search's seeded stream, never the clock.

## Consequences

- **Speed.** At `d629e2b3d9`, on the MacBook (Apple M1 Pro), on the field
  board `jh71n516` of the note, the shipped cut runs an iteration in 0.44 of
  the time every-candidate probing takes over a search's first 20 iterations
  and 0.56 over 60. The note's `topk:3` reads 0.45 and 0.53 in the same run:
  the repeat rule and the lot cost 0–4% of what the cut buys.
- **Every rollout's random stream moves.** The lot draws on every cut ply, so
  entries pinned by the dice move the way the note's `reseed` arm does. The
  census of issue #10473 lists them.
- **The residual blindness.** The rank reads a move's kind, never what it
  does: among distinct candidates of one kind the lot keeps two at random, so
  the one a line needs is probed in only some playouts. The blade's stretch
  entry "rollout probe cut: holds Emperor of Bones' Adapt in main 1 with two
  identical pump activations enumerated before it" reads it: every candidate
  probed passes 12 of 14 seeds, the kind rank with enumeration ties 4, ties
  by lot 12, the shipped cut 10, on a board noisy for every policy. A rank
  that reads what a move does (the tree's priors, `computeActionPriors`) is
  the next lever, and its cost is what it must buy back.
- **Guarded by** `convex/gre/__tests__/rolloutProbeCut.bot.test.ts`: the
  repeat rule, the kept decline and the lot, each proven to fail without its
  mechanism.
- **The field reading** (`probesPerIteration.p50`, `msPerProbe.p50` in the
  per-game `bot search` report, issue #10321) is a follow-up under PRD issue
  #10017, after a release.
