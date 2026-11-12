# Draft Table Audit — the plan read against its scope

> **Measured at `d3a4b6c33` (2026-11-12)**, rebased onto `668f4beb7` (the
> revert of the first Profile Census, PR #9343: the Vintage Cube reads its seed
> profiles again). Issue #9298, PRD #8772.

## What changed

The Auto-Build's plan was the Archetype with the most units in the Pool. It is
now the settled Archetype with the largest **surplus**: the Pool's units minus
the units a Pool of the same size drawn from the scope would hold
(`convex/limited/planArchetype.ts`). The settle bar (`ARCHETYPE_SETTLE_UNITS`,
4 units) still reads raw units. The Draft Table Audit reads its plan through the
same function, so plan share measures the plan the build chose.

A surplus rather than a ratio: a ratio explodes on an Archetype tagged on one or
two cards of a small scope, while a surplus needs real cards behind it.

## Draft Table Audit, before → after

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
```

The seed profiles tag 517 cards: control 172, aggro 127, artifacts 100,
ramp 74, graveyard 70, combo 43, storm 30, reanimator 29.

| Measure                      | Raw depth `668f4beb7`                                  | Scope-relative `d3a4b6c33`                                            |
| ---------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Decks built at ≥ 40          | 64 / 64                                                | 64 / 64                                                               |
| Mean castability             | 0.865                                                  | 0.866                                                                 |
| Worst deck's castability     | 0.772                                                  | 0.772                                                                 |
| Mean plan share              | 0.526                                                  | 0.505                                                                 |
| Mean Capability pairs / deck | 16.72                                                  | 17.63                                                                 |
| Plans                        | control 38, aggro 19, ramp 5, graveyard 1, artifacts 1 | aggro 21, control 18, ramp 13, artifacts 9, graveyard 2, reanimator 1 |

An earlier measurement on the census profiles (PR #9124, since reverted) moved
control 40 → 23 and built eight plans, `lands` and `spells` among them: the
effect does not depend on the census.

## Reading

- **The table is no longer one plan.** Control falls from 38 seats to 18 and
  six plans are built; `artifacts` goes from 1 seat to 9 and `ramp` from 5
  to 13. `combo` and `storm` are still never chosen: no Pool in eight seeds
  holds four units of them.
- **Plan share falls by construction.** It counts the spells carrying the
  plan's tag, so a narrower plan reads a plan-neutral card (cheap removal) as
  off-plan. The Floor is loosened 0.52 → 0.50 with the reason beside it in
  `scripts/lib/draft-audit.ts`. Castability holds (the worst deck is the same
  seat, now built as `ramp`) and Capability pairs rise.
- **The pick scorer is unchanged.** Archetype commitment while drafting
  (`botDrafter.ts#archetypeCommitment`) still accumulates raw units, so a
  drafter still drifts toward broad tags; only the build reads the scope.
