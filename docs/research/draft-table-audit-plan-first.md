# Draft Table Audit — after the plan-first build

> **Measured at `37d55c294` (2026-11-11)**, the branch of issue #8898 on top
> of base `dd239405f`. Compared with the Auto-Build fixes
> (`draft-table-audit-build-fixes.md`), re-measured on that base. Same
> script, same seeds, same model.

## What changed in the build

1. **The plan.** The Archetype the Pool is deepest in, by the pick scorer's
   accumulator (`archetypeCommitment`: copies count, an unreviewed Archetype
   layer at half weight). Below 4 weighted units (the pick scorer's
   settled depth) there is no plan.
2. **Colours.** The plan's colour signature over the Pool (the Archetype
   Catalogue's `colourSignature`) ranks first; a colour holding under 0.3 of
   the plan's cards ranks by Colour Commitment like any other. The third
   colour still needs the Pool's non-basic sources to pay its deficit.
3. **Spells.** The plan's castable core is taken first: its own cards, their
   Capability partners (a match with a plan card in the provisional deck)
   and every spell producing a deck colour. The curve fill and the rated,
   castability- and Capability-scored rest follow.

## What was run

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
bun run draft:audit -- --scope lea            # seeds 1..8, 64 decks
```

## Aggregate, Vintage Cube

| Measure                               | before → after                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Decks built at ≥ 40                   | 64 / 64 → 64 / 64                                                                 |
| Mean plan share                       | 0.427 → **0.526**                                                                 |
| Mean castability (coloured spell)     | 0.855 → **0.865**                                                                 |
| Worst deck's mean castability         | 0.749 → **0.772**                                                                 |
| Mean Capability pairs per deck        | 13.83 → **16.72**                                                                 |
| Mean land count                       | 16.73 → 16.53                                                                     |
| Colours                               | 2c 12, 3c 52 → 2c 13, 3c 51                                                       |
| Mean curve, MV 1 / 2 / 3 / 4 / 5 / 6+ | 5.84 / 6.09 / 4.94 / 2.72 / 1.73 / 1.94 → 6.27 / 6.39 / 4.94 / 2.59 / 1.63 / 1.66 |

LEA has no profiles, so no plan: its audit JSON is identical to the base's,
deck for deck.

## Reading, from ablations on the same seeds

Each part was switched off or varied in turn (temporary knobs, not shipped):

- **The plan's cards alone first** (colours unchanged) reads plan share
  0.525 but Capability pairs 12.39 and worst deck 0.734: plan cards displace
  the enablers they need and the deck's mana-producing spells (Moxen, Lotus
  Petal, mana creatures), which the castability model counts as sources.
- **Adding the plan's Capability partners** to the core lifts pairs to
  16.45; partners of ANY deck card (not only plan cards) read 18.39 but pin
  splash cards and keep the worst deck at 0.667.
- **Adding on-colour mana sources** to the core lifts the worst deck from
  0.716 to 0.772.
- **The signature bar.** At 0.2, a plan spread over five colours (cube
  `control`, shares 0.2 / 0.35 / 0.2 / 0.1 / 0.15) drops the Pool's strongest
  colour and the worst deck reads 0.667. At 0.25 plan share is 0.533 with
  the worst deck at 0.754; 0.3, 0.333 and 0.4 all read 0.526 / 0.772. With no
  signature step at all: 0.522 / 0.772.
- **A castability bar on the core** (0.7 or 0.8 instead of the 0.5 floor)
  trades plan share (0.503, 0.489) for no gain on the worst deck.

## Floors

`DRAFT_AUDIT_FLOORS` for the Vintage Cube re-declared from these numbers,
rounded down to two decimals, all tightened: `meanPlanShare ≥ 0.52`,
`meanCastability ≥ 0.86`, `worstDeckCastability ≥ 0.77`,
`meanCapabilityPairs ≥ 16.71`, `builtShare ≥ 1`. LEA unchanged.
