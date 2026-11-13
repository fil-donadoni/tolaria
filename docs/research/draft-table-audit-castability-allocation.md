# Draft Table Audit — castability with one pip per source

> **Measured at `015b1ea08` (2026-11-13)**, the branch of issue #9338 on top of
> base `90996ede2`. Same script, same seeds (1..8, 64 decks per scope); only the
> castability model changed.

## What changed in the model

`convex/limited/castability.ts` used to multiply one hypergeometric draw per
colour, so a dual land counted as a full source of BOTH its colours on the same
turn. Now each mana source pays ONE coloured pip of a colour it produces: the
probability is exact, a multivariate hypergeometric over the deck's source
kinds summed over the draws whose sources can be allocated to the spell's pips
(Hall's condition). A single-colour spell reads exactly as before. A one-shot
source keeps its fractional weight (`botDrafter.ts#sourceWeight`, issue #9337):
a fractional kind count reads as the multilinear interpolation between the
integer counts either side of it, the rule `hypergeometricAtLeast` already
applies to one colour. The builder
(`autoBuild.ts`) and the audit read the same function, so both moved.

## What was run

```bash
bun run draft:audit -- --scope vintage-cube --json   # before and after
bun run draft:audit -- --scope lea --json
```

Per-spell comparison over the decks the build left identical.

## Result

| Measure                            | Vintage Cube before → after | LEA before → after |
| ---------------------------------- | --------------------------- | ------------------ |
| decks rebuilt differently          | 1 of 64                     | 0 of 64            |
| coloured spells that moved         | 82 of 1,145                 | 0 of 1,410         |
| largest single-spell drop          | 0.064                       | 0                  |
| any spell rising                   | none                        | none               |
| `meanCastability` (aggregate)      | 0.8705 → 0.8696             | 0.7596 → 0.7596    |
| `worstDeckCastability` (aggregate) | 0.7313 → 0.7273             | 0.4924 → 0.4924    |
| `p5DeckCastability` (aggregate)    | 0.7686 → 0.7672             | 0.5592 → 0.5592    |

## Reading

The optimism was real per card (up to six points on a gold spell leaning on
duals) but small in aggregate: −0.0009 on the Cube's mean, nothing on LEA,
where the Auto-Built decks carry almost no multicolour spell on duals. Both
scopes' Floors still PASS (`meanCastability ≥ 0.86`, `p5DeckCastability ≥ 0.76`
on the Cube).
