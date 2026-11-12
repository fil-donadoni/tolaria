# Draft Table Audit — the plan read against its scope

> **Measured at `538a391b3` (2026-11-12)**, rebased onto `d03e898b7` (the first
> Profile Census, PR #9124). Issue #9298, PRD #8772.

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

| Measure                      | Raw depth `d03e898b7`                                  | Scope-relative `538a391b3`                                                                |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Decks built at ≥ 40          | 64 / 64                                                | 64 / 64                                                                                   |
| Mean castability             | 0.867                                                  | 0.865                                                                                     |
| Worst deck's castability     | 0.744                                                  | 0.721                                                                                     |
| Mean plan share              | 0.422                                                  | 0.415                                                                                     |
| Mean Capability pairs / deck | 16.69                                                  | 16.53                                                                                     |
| Plans                        | control 40, aggro 13, artifacts 6, ramp 4, graveyard 1 | control 23, aggro 15, artifacts 10, ramp 10, graveyard 3, lands 1, reanimator 1, spells 1 |

On the seed data before the census (same code, measured during the work on the
branch), the change moved control 38 → 18 and ramp 5 → 13, with castability
0.866 / 0.772 and Capability pairs 17.63: the effect does not depend on the
census.

## Reading

- **The table is no longer one plan.** Control falls from 40 seats to 23 and
  eight plans are built. Two of the census's new Archetypes (`lands`, `spells`)
  are chosen for the first time; `blink`, `tokens`, `sacrifice` and `cheat`
  still never are — no Pool in eight seeds holds four units of them.
- **The three small losses come with a narrower plan.** A narrow plan has fewer
  tagged spells (plan share) and fewer Capability partners in the Maindeck.
  The worst castability is one deck, a GR `ramp` seat (seed 8 seat 5) at 0.721;
  the next is 0.744. The Floors are re-baselined to these values, rounded down
  to two decimals, with the reason beside them in `scripts/lib/draft-audit.ts`.
- **The pick scorer is unchanged.** Archetype commitment while drafting
  (`botDrafter.ts#archetypeCommitment`) still accumulates raw units, so a
  drafter still drifts toward broad tags; only the build reads the scope.
