# Game time picks the won band's timing slice; material orders wins inside it

## Status

accepted (2026-11-17, issue #10118). Replaces the decay-factor shape of
`scoreLeaf`'s win timing (issues #3376, #9900, #10084).

## Context

A won leaf's reward lives in `[1 − terminalBand, 1]`; its height above the
band floor was the material signal (`rewardFromValue`). Issue #3376 made a
sooner win outrank a later one by multiplying that height by a decay that
shrank per step and, with a floor per turn, per turn boundary (#9900,
#10084: `WIN_TURN_DECAY` 0.7 → 0.5).

A factor on the material height makes the timing gap proportional to the
material. At the base vector (band 0.25, `outcomeEps` 0.05) a win in this
turn's combat and a win on the opponent's turn cleared `outcomeEps` only when
the win held more than 0.8 of the band. From behind on material the two tied,
and `material-tiebreak` took the later, richer win; at zero height timing was
invisible. Issue #10118 reproduced it on 5/5 seeds: the riot position with
tapped Craw Wurms on the opponent's side picks the counter over the haste
that wins now. No value of `WIN_TURN_DECAY` closes it: lowering it moves the
threshold and spends the later-win height the Brain Freeze decking entry
needs.

## Decision

The won band is cut into **timing slices**. Game time picks the slice;
material orders wins only inside it (`wonBandHeight`, `convex/gre/search.ts`).
In band units (share of `terminalBand` above the floor), with
`m = WIN_MATERIAL_SHARE` (0.05) and `gap = outcomeEps / terminalBand × 1.15`:

| Leaf's game time             | Slice                                      |
| ---------------------------- | ------------------------------------------ |
| two or more turns away       | `[0, m]`                                   |
| one turn boundary away       | `[m + gap, 2m + gap]`                      |
| the root's own turn, by step | `2m + 2gap` up to `1 − m`, `0.85` per step |

At the base vector the bottoms are 0 / 0.28 / 0.56: every turn boundary
clears `outcomeEps` by 0.0075 of reward whatever the material, and a win on
the opponent's turn sits ≈ 0.07 above a line that never wins. Inside the
root's turn, a win now against a win at combat damage (five steps) sits
0.39 × (1 − 0.85⁵) ≈ 0.22 of the band apart (≈ 0.055 of reward), up to `m`
less if the later win holds more material.

The gap is derived from `outcomeEps` and `terminalBand`, not hard-coded, so a
re-tuned vector keeps it. The guarantee holds only while the band can hold
the gaps (`gap < 1 − 2m`): past that, the one-boundary and own-turn slices
collapse onto `1 − m` — sooner still above later, never leaving the band, but
no longer `outcomeEps` apart.

The tie-break margin stays pure material. Since slices sit more than
`outcomeEps` apart, `material-tiebreak` only ever compares wins of the same
timing, which is what it was for. No root mechanism changes, so ADR 0124 §5's
identical-vector proof is not owed.

## Considered

- **A timing-aware tie-break margin for won leaves.** Rejected:
  `material-tiebreak` is a frozen root mechanism (ADR 0124 §5) and the margin
  is pure material by contract; it would fix the order only after the reward
  had already tied.
- **Keep the factor, lower `WIN_TURN_DECAY`.** Rejected: the gap stays
  proportional to material, so a win at zero height is still timing-blind.

## Consequences

- The band holds two turn boundaries, not more: wins two or more turns away
  share one slice and material orders them.
- Material moves a win's reward by at most `m × terminalBand` ≈ 0.0125. Wins
  of the same timing that tie on reward are ordered by the pure-material
  margin, as before; a mean over mixed rollouts still reads a richer win
  inside the slice (the saturation ADR 0102 measured is avoided by the slice
  heights themselves, which keep every win above the floor).
- A win now no longer scores the plain `rewardFromValue` leaf: the plain leaf
  is what `reward` returns with no `since`, which the search never scores a
  won leaf with.
- Pinned by the `must` blade entry "as-enters choice: takes the haste for
  lethal now while behind on material" and by `sourceBodyDamageConversion.bot.test.ts`.
