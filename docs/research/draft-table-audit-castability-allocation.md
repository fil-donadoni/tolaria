# Draft Table Audit — castability with one pip per source

> **Measured at `5acdd4b27` (2026-11-13)**, the branch of issue #9338 on top of
> base `f7b8896f4`. Same script, same seeds (1..8, 64 decks per scope); only the
> castability model changed.

## What changed in the model

`convex/limited/castability.ts` used to multiply one hypergeometric draw per
colour, so a dual land counted as a full source of BOTH its colours on the same
turn. Now each mana source pays ONE coloured pip of a colour it produces: the
probability is exact, a multivariate hypergeometric over the deck's source
kinds summed over the draws whose sources can be allocated to the spell's pips
(Hall's condition). A single-colour spell reads exactly as before. The builder
(`autoBuild.ts`) and the audit read the same function, so both moved.

## What was run

```bash
bun run draft:audit -- --scope vintage-cube --json   # before and after
bun run draft:audit -- --scope lea --json
```

Per-spell comparison over the decks the build left identical.

## Result

| Measure                       | Vintage Cube before → after | LEA before → after |
| ----------------------------- | --------------------------- | ------------------ |
| decks rebuilt differently     | 3 of 64                     | 0 of 64            |
| coloured spells that moved    | 88 of 1,111                 | 0 of 1,409         |
| largest single-spell drop     | 0.099                       | 0                  |
| any spell rising              | none                        | none               |
| `meanCastability` (aggregate) | 0.8690 → 0.8684             | 0.7612 → 0.7612    |
| `worstDeckCastability`        | 0.7620 → 0.7620             | 0.4924 → 0.4924    |

## Reading

The optimism was real per card (up to ten points on a gold spell leaning on
duals) but small in aggregate: −0.0006 on the Cube's mean, nothing on LEA,
where the Auto-Built decks carry almost no multicolour spell on duals. No Floor
moves: the Cube's `worstDeckCastability` and `meanPlanShare` were already below
their Floors on the base tip (0.762 < 0.77, 0.482 < 0.5) before this change, and
are unchanged by it.
