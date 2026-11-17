# A win in the root's own turn is floored outcomeEps above the same win a turn later

## Status

accepted (2026-11-17, issue #10118). Amends the win-timing shape of
`scoreLeaf` (issues #3376, #9900, #10084).

## Context

A won leaf's reward lives in `[1 − terminalBand, 1]`; its height above the
band floor is the material signal (`rewardFromValue`). Issue #3376 made a
sooner win outrank a later one by multiplying that height by a decay that
shrinks per step and, with a floor per turn, per turn boundary (#9900,
#10084: the turn floor 0.5 / 0.25 / 0.125 of the height).

A factor on the material height makes the timing gap proportional to the
material. At the base vector (band 0.25, `outcomeEps` 0.05) a win in this
turn's combat and a win on the opponent's turn cleared `outcomeEps` only when
the win held more than 0.8 of the band. From behind on material the two tied,
and `material-tiebreak` took the later, richer win; at zero height timing was
invisible. Issue #10118 reproduced it on 5/5 seeds: the riot position with
tapped Craw Wurms on the opponent's side picks the counter over the haste
that wins now.

## Decision

Keep the decayed height, and FLOOR a win in the root's own turn at the
height of the same material won one turn later plus `gap`
(`wonBandHeight`, `convex/gre/search.ts`):

```
decayed   = material × max(0.5 × 0.5^turns, 0.85^steps)
own turn  = min(1, max(decayed, material × 0.25 + gap))
later     = decayed
gap       = outcomeEps / terminalBand × 1.15      (0.23 at the base vector)
```

A win in the root's own turn now outranks a win on the opponent's turn
holding the same material by more than `outcomeEps`, at any material level,
and a win on the bot's next turn by more still. The gap is derived from
`outcomeEps` and `terminalBand`, so a re-tuned vector keeps it.

## Considered

- **Timing slices (the issue's recommendation):** reserve disjoint slices of
  the band per timing, material ordering wins only inside a slice. Built and
  measured, rejected. The band (0.25 against an `outcomeEps` of 0.05) holds
  at most three slices, so the material share inside each was 0.05 of the
  band. Two consequences:
    - The `must` entry "starved target fan-out: a Vindicate cast aims at the
      opponent's Hero token (iterations 400)" went red on seed 1. Its rollouts
      mostly win turns away, and the Hero's value is the material those wins
      hold.
    - Widening the later slice (0.35) still left an own-turn offset fixed on
      every win. That doubled the premium a rollout pays for a misblocked
      attack at the material a typical win holds (0.83 against 0.76 mean
      reward), and the pick moved off the Hero.

    A floor leaves the height alone wherever the decay already separated the
    two wins. With it, that entry's root reads exactly as on the base.

- **A timing-aware tie-break margin for won leaves.** Rejected:
  `material-tiebreak` is a frozen root mechanism (ADR 0124 §5) and the margin
  is pure material by contract.
- **Lower `WIN_TURN_DECAY` further.** Rejected: the gap stays proportional to
  material, so a win at zero height is still timing-blind.

## Consequences

- The guarantee is per-material, not lexicographic. A later win holding
  substantially more material can still outrank a sooner one. "Substantially"
  means more than `(gap − outcomeEps / terminalBand) / 0.25` ≈ 0.12 of the
  band at the base vector. The riot pair differs by one +1/+1 counter.
- Only the boundary out of the root's own turn is guaranteed. Two later wins
  a turn apart are still ordered by material times the turn decay, as before.
- Inside the root's turn a sooner step still outranks a later one by the
  decay. That gap stays material-proportional, as before.
- No root mechanism changes, so ADR 0124 §5's identical-vector proof is not
  owed. The tie-break margin stays pure material.
- Pinned by the `must` blade entry "as-enters choice: takes the haste for
  lethal now while behind on material" and by `riot.bot.test.ts`.
