# Draft Table Audit — colour-coherence baseline

> **Measured at `12243eb41` (2026-11-13)** against base `05a3d24cc`. Issue
> #9335, PRD #8772. The change adds measures only: no build or pick logic
> moves, so every number below is the build as it stood on the base.

## What was added

Three per-deck measures in `DeckAudit` (`src/lib/limited/draftTableAudit.ts`),
their aggregate in `scripts/lib/draft-audit.ts`, and their rows in the Draft
Lab's Built deck view. They are a report only; no Floor reads them.

- **Early castability**: the castability of the coloured Maindeck spells of
  mana value ≤ 2 (`EARLY_MANA_VALUE`). Per deck: count, mean, and how many are
  below 0.8 (`EARLY_CASTABILITY_THRESHOLD`). The aggregate pools every early
  spell of the run and splits the share below 0.8 by colour count.
- **Splash discipline**: in a deck of three colours, the Maindeck cards with a
  pip in the third colour (`colors[2]`, the one Auto-Build adds last). Of
  those, the **strained** ones have a double pip in that colour or mana value
  ≤ 2. A two-colour deck reads `null`.
- **Off-colour duals**: Maindeck lands that produce a colour outside the
  deck's (`producedColors`, so a fetch land counts its fetched colours). A land
  that produces all five colours is any-colour fixing and never counts: City of
  Brass, or a basic-land fetch, which `limitedSourceColors` reads as every
  colour.

## What was run

```bash
bun run draft:audit -- --scope vintage-cube [--seeds 16|64]
bun run draft:audit -- --scope lea [--seeds 64]
```

## Baseline

| Measure                         |  Cube 1..8 (64) | Cube 1..16 (128) |  Cube 1..64 (512) |   LEA 1..8 (64) |   LEA 1..64 (512) |
| ------------------------------- | --------------: | ---------------: | ----------------: | --------------: | ----------------: |
| Colour count                    |     2c 8, 3c 56 |    2c 20, 3c 108 |     2c 84, 3c 428 |           2c 64 |     2c 501, 3c 11 |
| Early castability (mean)        |           0.871 |            0.870 |             0.867 |           0.776 |             0.772 |
| Early spells below 0.8          | 0.201 (126/626) |            0.203 | 0.206 (1025/4987) | 0.366 (337/922) | 0.351 (2635/7501) |
| … in two-colour decks           |           0.130 |            0.194 |             0.167 |           0.366 |             0.356 |
| … in three-colour decks         |           0.210 |            0.205 |             0.213 |               — |             0.152 |
| Splash cards per splashing deck |            3.46 |             3.23 |              3.14 |               — |              0.82 |
| Strained share of splash cards  | 0.608 (118/194) |            0.573 |  0.584 (784/1342) |               — |       0.667 (6/9) |
| Off-colour duals per deck       |            2.95 |             3.02 |              3.17 |            0.22 |              0.16 |

On the 64-seed cube run, off-colour duals average 3.07 per three-colour deck
and 3.67 per two-colour deck.

## Reading

- **Three-colour decks stumble more early.** On 512 cube decks, 21.3 % of
  their early spells are below 0.8, against 16.7 % in two-colour decks. The
  1..8 split (0.130 for 2c) rests on eight two-colour decks and is noise. The
  16-seed figures (0.205 vs 0.194) differ from the issue's 2026-11-12 numbers
  (0.203 vs 0.149) because the base moved in between. The 64-seed run is the
  one to compare against.
- **Most splash cards are the hard kind.** Almost 60 % of the cards a
  three-colour cube deck plays in its third colour are double-pipped in it or
  cost two or less. A splash is meant to be a few late, single-pip cards. This
  is the measure issue #9336 (does a third colour pay for itself) moves.
- **A third colour can carry no spell.** 11 of 428 three-colour cube decks
  and 6 of 11 LEA ones play no card with a pip in their third colour. The
  third-colour gate counts the Pool's sources and pip demand, but the spell
  pass can then leave every third-colour spell out.
- **Off-colour duals are about three lands a deck in the cube.** Most are
  triomes, shocks and original duals. With 16.7 lands a deck, close to one land
  in five puts part of its fixing into a colour the deck does not play. The castability model counts them as full sources of
  their on-colour half, so it cannot see the cost.
