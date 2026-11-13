# Draft Table Audit — fetch lands resolved against their collection

> **Measured at `d17442927` (2026-11-13)**, on `staging` after PR #9345
> (issue #9334), PR #9506 (issue #9337) and PR #9503 (issue #9323).
> Issue #9348, PRD #8772.

## What changed

PR #9345 gave a fetch land the colours of the basic types it names (Polluted
Delta: U/B). That is a floor: Polluted Delta finds an "Island or Swamp card",
so beside a Tropical Island it reaches green too, and with enough typed duals
any fetch reaches all five colours.

The Limited card meta now carries a fetch's targets (`fetchTargetsOf`) and every
land's basic land types (`landTypesOf`). `resolveFetchSources`
(`convex/limited/manaSourceColors.ts`) widens a fetch's colours within its
collection:

- in the pick, against the Pool, so Fixing Value prices a fetch by the duals
  already drafted;
- in the Auto-Build, against the Pool;
- in the Draft Table Audit, against the Maindeck.

## Draft Table Audit

Vintage Cube. Baseline = the same tree with the six Limited source files at
`origin/staging` (named types only); the audit script is the branch's in both
columns, so both report the 5th percentile.

| Measure                 | Seeds 1..8, named types | Seeds 1..8, resolved | 64 seeds, named types | 64 seeds, resolved |
| ----------------------- | ----------------------: | -------------------: | --------------------: | -----------------: |
| Mean deck castability   |                   0.873 |                0.872 |                 0.860 |              0.864 |
| 5th percentile          |                   0.777 |                0.777 |                 0.776 |              0.785 |
| Worst deck              |                   0.733 |                0.731 |                 0.510 |              0.491 |
| Plan share              |                   0.509 |                0.486 |                 0.512 |              0.511 |
| Capability pairs / deck |                   27.45 |                29.02 |                 29.21 |              29.85 |

LEA (seeds 1..8) holds every Floor: mean castability 0.760, worst deck 0.492.
It has no fetch lands; it moves only through the picks.

## Reading

- **The distribution improves on 64 seeds**: mean castability +0.004, 5th
  percentile +0.009, Capability pairs +0.64. On seeds 1..8 mean and 5th
  percentile are flat.
- **The worst deck is one seat.** It moves by 0.002 on seeds 1..8 and by 0.019
  on 64 seeds, in the direction opposite to the 5th percentile. Valuing fetches
  differently moves the picks, and with them which seat draws the table's worst
  colour choice. Colour choice against the Pool's commitment is issue #9336.
- **Plan share on seeds 1..8 falls 0.509 → 0.486** and holds on 64 seeds
  (0.512 → 0.511): a block effect, inside the Floor (0.48).
- **The tail Floor reads the 5th percentile.** `worstDeckCastability` is one
  deck of 64 and moved four times in two days for single seats (issues #9334,
  #9369, #9323). It stays reported; the Vintage Cube Floor is now
  `p5DeckCastability ≥ 0.77` (0.777 rounded down). LEA keeps its worst-deck
  Floor.
