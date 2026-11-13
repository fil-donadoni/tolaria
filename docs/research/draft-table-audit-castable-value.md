# Draft Table Audit — colour set by castable value

> **Measured on the branch of issue #9336 (2026-11-13)**, on top of base
> `e7274cdab`. Same script, seeds 1..16 (128 decks per scope) unless a line
> says 1..8 (the Floors' seeds); only the Auto-Build's colour choice changed.

## What changed in the build

The Auto-Build used to choose its colours by rule: the plan's colour signature
first, Colour Commitment second, a third colour only when
`manaBaseSupportsThirdColor` found enough sources in the Pool, never more than
`MAX_DECK_COLORS = 3`. Both are gone (`convex/limited/autoBuild.ts`).

Now every candidate colour set — each non-empty subset of the colours the Pool
holds a spell pip in, one to five colours — is built, and scored by its
**castable value**: the sum, over its Maindeck spells, of each spell's value
times its castability against that deck's own mana base (`castability.ts`, the
audit's model). A spell's value is its base rating, plus its Capability fit
against the built Maindeck, plus `PLAN_CARD_RATING` (2) when it carries the
plan. A spell outside the set (a filler the set's spells could not cover)
reads zero, so a set never borrows the value of a colour it does not name
through a dual that happens to produce it. The colour count is a consequence:
nothing writes down "two" or "a splash".

The order of `colors` is the built Maindeck's pip demand, heaviest first, so
`colors[2..]` still reads as the splash in `splashDiscipline`.

The audit gains `offColourSpells` per deck (Maindeck spells with a pip outside
the deck's colours) and its distribution in the aggregate.

## What was run

```bash
bun run draft:audit -- --scope lea --seeds 16            # before and after
bun run draft:audit -- --scope vintage-cube --seeds 16
bun run draft:audit -- --scope <scope> --json            # Floors, seeds 1..8
```

"Before" is base `e7274cdab`'s `autoBuild.ts` under this branch's audit (so
the new metric reads on both).

## Result, seeds 1..16

| Measure                    | LEA before → after                                       | Vintage Cube before → after                    |
| -------------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `meanCastability`          | 0.766 → 0.777                                            | 0.869 → 0.886                                  |
| `worstDeckCastability`     | 0.461 → 0.557                                            | 0.727 → 0.751                                  |
| `p5DeckCastability`        | 0.574 → 0.642                                            | 0.778 → 0.798                                  |
| `meanPlanShare`            | —                                                        | 0.495 → 0.505                                  |
| colours                    | 2c 124, 3c 4 → 1c 2, 2c 72, 3c 51, 4c 3                  | 2c 24, 3c 104 → 1c 2, 2c 53, 3c 62, 4c 11      |
| decks by off-colour spells | 0: 53, 1: 22, 2: 12, 3+: 41 → 0: 100, 1: 20, 2: 5, 3+: 3 | 0: 115, 1: 3, 2: 6, 3+: 4 → 0: 125, 1: 2, 2: 1 |
| `meanOffColourSpells`      | 1.80 → 0.32                                              | 0.27 → 0.03                                    |
| `earlyBelowShare`          | 0.371 → 0.425                                            | 0.210 → 0.181                                  |
| `splashStrainedShare`      | — → 0.648                                                | 0.603 → 0.587                                  |

**The off-colour spells are the defect, and they are gone.** On the base, 41 of
128 LEA decks maindecked three or more spells their colours could not pay —
LEA Pools are often too thin in two colours to fill 24 spell slots, and the
two-colour rule shipped the gap as dead cards. The castable-value build names
the colour those cards need and splashes it instead (51 three-colour LEA decks,
about four splash cards each). The Vintage Cube is down to three decks with
any off-colour spell.

**Colour counts.** LEA stays a two-colours-plus-a-splash format: 72 two-colour
decks, 51 splashing a third, three four-colour decks from Pools too shallow in
any pair (their castability 0.60–0.70, still above the base's worst deck), and
two mono-colour decks deep enough in one colour. The cube moves the other way
from the base (3c 104 → 62): more decks are two-colour when the Pool is deep
enough, and eleven play four colours on the fixing they drafted. No five-colour
deck was built on these seeds: the castability model prices a fifth colour
above what the cards it unlocks are worth.

**One cost.** LEA's early stumble share rises (0.371 → 0.425): a splash card
at mana value ≤ 2 is a stumble by construction, and the castability model
discounts it by its own probability only. The model cannot see the turn a
stumble costs; that is the castability model's limit, not the build's.

## `PLAN_CARD_RATING`, one point against two

| Vintage Cube, seeds 1..16 | +1    | +2    |
| ------------------------- | ----- | ----- |
| `meanCastability`         | 0.893 | 0.886 |
| `p5DeckCastability`       | 0.811 | 0.798 |
| `meanPlanShare`           | 0.487 | 0.505 |

One point fails the Build Invariant (`autoBuild.bot.test.ts`, "the deepest
plan survives the build against a higher-rated rival plan with fewer cards":
a rival plan rated two points higher takes the colours). Two points hold it,
and trade 0.007 of mean castability for 0.018 of plan share.

## Finalists

A colour set's build costs about 1 ms of CPU on a 45-card cube Pool, and a
cube Pool has 31 candidate sets; a 90-card cube Sealed Pool costs more per set.
Every set is first scored on its provisional deck (the build's first pass,
valued like a finished one), and only the best `COLOUR_SET_FINALISTS` (6) are
finished. Against finishing all 31, seeds 1..16:

| Finalists | LEA decks differing | Cube decks differing | Cube `meanCastability` | Cube `meanPlanShare` |
| --------- | ------------------- | -------------------- | ---------------------- | -------------------- |
| 4         | 3                   | 16                   | 0.8852                 | 0.507                |
| 6         | 1                   | 6                    | 0.8864                 | 0.505                |
| 8         | 1                   | 3                    | 0.8859                 | 0.505                |
| 31 (all)  | 0                   | 0                    | 0.8862                 | 0.505                |

CPU per seat (`process.cpuUsage`, on a loaded machine, so ratios only): base
2.5 ms on a 45-card cube Pool and 12 ms on a 90-card one; all 31 finished,
34 ms and 130 ms; six finalists, 22 ms and 80 ms.
`freezeAutoBuiltDecks` builds every Bot seat in one mutation, so a 90-card cube
Sealed event with seven Bots spends about half a second there.

## Floors (seeds 1..8)

| Floor                              | Before | After | Floor        |
| ---------------------------------- | ------ | ----- | ------------ |
| LEA `meanCastability`              | 0.760  | 0.770 | 0.75 → 0.77  |
| LEA `worstDeckCastability`         | 0.492  | 0.576 | 0.49 → 0.57  |
| Vintage Cube `meanCastability`     | 0.870  | 0.886 | 0.86 → 0.88  |
| Vintage Cube `p5DeckCastability`   | 0.767  | 0.793 | 0.76 → 0.79  |
| Vintage Cube `meanPlanShare`       | 0.478  | 0.492 | 0.47 → 0.49  |
| Vintage Cube `meanCapabilityPairs` | 27.55  | 27.11 | 16.71 (kept) |

No Floor broke; each castability and plan Floor tightened to the new value
rounded down.
