# Draft Table Audit — baseline before the build changes

> **Measured at `762e8d57f` (2026-11-10)**, base tip before any Auto-Build change of PRD #8772 (issue #8894). The audit adds no build or pick logic; the numbers are the build as it stood on that sha.

## What was run

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
bun run draft:audit -- --scope lea            # seeds 1..8, 64 decks
```

For each seed eight Bots draft three packs of the scope through the Draft
Lab's synthetic engine (seed profile layers only, no DB) and every seat is
Auto-Built by the server's `autoBuildDeck`. Script: `scripts/draft-audit.ts`;
per-deck measures: `src/lib/limited/draftTableAudit.ts` (moved there by issue
#8899, unchanged); aggregate and Floors: `scripts/lib/draft-audit.ts`.

**Castability model** (declared, simple): a spell of mana value `mv` is cast on
the play on turn `max(1, mv)`, after `7 + turn − 1` cards seen. For each
coloured pip colour it needs that many sources among those cards, a source
being any other Maindeck card producing the colour. Colours are independent
hypergeometric draws, multiplied. Generic mana, total land drops, duals paying
one pip at a time, `{C}` pips and mulligans are not modelled. Colourless spells
are left out of every mean.

**Plan**: the Pool's deepest Archetype (most Pool cards tagged, ties by id);
plan share = Maindeck spells tagged with it / Maindeck spells.

## Aggregate

| Measure                               | Vintage Cube                                           | LEA                                     |
| ------------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| Decks built at ≥ 40                   | 64 / 64                                                | 64 / 64                                 |
| Mean castability (coloured spell)     | 0.761                                                  | 0.791                                   |
| Worst deck's mean castability         | 0.557                                                  | 0.513                                   |
| Coloured spells below 0.5             | 12.5 % (of 1,301)                                      | 9.0 % (of 1,348)                        |
| Mean plan share                       | 0.471                                                  | — (no archetype profiles)               |
| Plans (deepest Archetype)             | control 38, aggro 19, ramp 5, graveyard 1, artifacts 1 | —                                       |
| Mean Capability pairs per deck        | 12.00                                                  | 0.00                                    |
| Land count                            | 17.00 in every deck                                    | 17.00 in every deck                     |
| Colours                               | 2c 12, 3c 52                                           | 2c 64                                   |
| Mean curve, MV 1 / 2 / 3 / 4 / 5 / 6+ | 3.41 / 6.73 / 5.25 / 3.20 / 2.11 / 2.30                | 9.20 / 5.13 / 3.98 / 2.80 / 0.92 / 0.97 |
| Unreviewed share, archetypes          | 1.000                                                  | —                                       |
| Unreviewed share, capabilities        | 1.000                                                  | 1.000                                   |

Wall-clock: 8.9 s (Vintage Cube) and 10.1 s (LEA) for eight seeds on the Huawei
runner, CPU at full clock, on mains — about 1.1 to 1.3 s per table.

## Reading

- Every seat builds a legal 40, always at 17 lands: the land count does not
  follow the curve, as the PRD measured.
- In the cube 52 of 64 decks go to three colours, and one coloured spell in
  eight is castable by its own turn less than half the time.
- A Pool's deepest plan fills under half the Maindeck (0.471): the build does
  not read the Archetype the draft accumulated.

## Floors

`DRAFT_AUDIT_FLOORS` holds these numbers rounded down to two decimals:
Vintage Cube `builtShare ≥ 1`, `meanCastability ≥ 0.76`,
`worstDeckCastability ≥ 0.55`, `meanPlanShare ≥ 0.47`,
`meanCapabilityPairs ≥ 12`; LEA `builtShare ≥ 1`, `meanCastability ≥ 0.79`,
`worstDeckCastability ≥ 0.51`. A broken Floor exits 1. The margin is thin
against catalogue churn: a cube addition reshuffles every seed's packs, so the
Floors are a script verdict, not a test assertion.
