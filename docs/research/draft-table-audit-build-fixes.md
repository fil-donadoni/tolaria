# Draft Table Audit — after the Auto-Build fixes

> **Measured at `fcc21a6b9` (2026-11-11)**, the branch of issue #8897 on top of
> base `9e20a5b0c`. Compared with the baseline at `762e8d57f`
> (`draft-table-audit-baseline.md`). Same script, same seeds, same model.

## What changed in the build

1. A spell's base value is the layered Pick Rating the pick read (DB → seed),
   falling back to the quality heuristic on the rating scale, as an unrated
   pick does.
2. A gold card is on-colour only when every coloured pip is a colour of the
   deck.
3. A castability term: each candidate's pips against the provisional deck's
   sources, using the audit's own model (`convex/limited/castability.ts`).
   A spell under 0.5 competes only after every castable on-colour spell.
4. The land count follows the provisional spells' average mana value,
   `11 + 2 × avg`, rounded and clamped to 16–18.

## What was run

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
bun run draft:audit -- --scope lea            # seeds 1..8, 64 decks
```

## Aggregate

| Measure                               | Vintage Cube before → after                                                       | LEA before → after                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Decks built at ≥ 40                   | 64 / 64 → 64 / 64                                                                 | 64 / 64 → 64 / 64                                                                  |
| Mean castability (coloured spell)     | 0.761 → **0.855**                                                                 | 0.791 → 0.761                                                                      |
| Worst deck's mean castability         | 0.557 → **0.749**                                                                 | 0.513 → 0.492                                                                      |
| Mean plan share                       | 0.471 → 0.427                                                                     | —                                                                                  |
| Mean Capability pairs per deck        | 12.00 → **13.83**                                                                 | 0.00 → 0.00                                                                        |
| Mean land count                       | 17.00 → 16.73                                                                     | 17.00 → 16.03                                                                      |
| Colours                               | 2c 12, 3c 52 → unchanged                                                          | 2c 64 → unchanged                                                                  |
| Mean curve, MV 1 / 2 / 3 / 4 / 5 / 6+ | 3.41 / 6.73 / 5.25 / 3.20 / 2.11 / 2.30 → 5.84 / 6.09 / 4.94 / 2.72 / 1.73 / 1.94 | 9.20 / 5.13 / 3.98 / 2.80 / 0.92 / 0.97 → 10.17 / 5.17 / 3.94 / 2.84 / 0.91 / 0.94 |

## Reading, from ablations on the same seeds

Each fix was switched off in turn (temporary knobs, not shipped):

- **Every-pip gold** carries most of the cube's castability gain: with no
  castability term and lands fixed at 17, the cube reads 0.840 (worst 0.695).
  The same rule takes plan-tagged gold cards out of the Maindeck: plan share
  0.458 with Pick Rating off, 0.432 with it on.
- **Pick Rating** moves the curve down (the seed ratings favour cheap spells)
  and costs plan share; the plan-first build (issue #8898) is the slice that
  reads the plan.
- **Land count** is what lowers LEA. With lands fixed at 17 LEA reads 0.799
  (worst 0.531), above its baseline; at 16 it reads 0.761, at a 15 floor
  0.742. The castability model counts sources, not land drops, so a land
  fewer always reads lower and the spell it buys never shows. The band's
  floor is 16 rather than 15 for that reason.
- **Castability weight** barely moves LEA: tripling it (with a 0.6 floor)
  reads 0.764 against 0.761.

## Floors

`DRAFT_AUDIT_FLOORS` re-declared from these numbers, rounded down to two
decimals: Vintage Cube `meanCastability ≥ 0.85`, `worstDeckCastability ≥
0.74`, `meanCapabilityPairs ≥ 13.82` (tightened), `meanPlanShare ≥ 0.42`
(loosened, reason above); LEA `meanCastability ≥ 0.76`,
`worstDeckCastability ≥ 0.49` (loosened, reason above). `builtShare ≥ 1` on
both.
