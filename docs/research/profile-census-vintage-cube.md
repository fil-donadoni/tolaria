# Profile Census — Vintage Cube, first pass

> **First measured at `1be2f3642` (2026-11-10)** against base `39563e57b`;
> **re-measured at `65b39ebaf` (2026-11-12)** after rebasing onto the
> plan-first Auto-Build (issue #8902, PRD #8772). The census changes seed data
> and the vintage-cube Floors only: no build or pick logic moved.

## What the pass wrote

- **Archetype Catalogue**: six new rows (`blink`, `cheat`, `lands`,
  `sacrifice`, `spells`, `tokens`), each with TAG WHEN / NOT, gloss and
  example. That takes the catalogue from 8 to 14 rows. `ramp` and `reanimator`
  now point their NOT clause at `cheat`.
- **Capabilities** (`data/card-profiles/capabilities.json`): one row for
  each of the 540 cube cards. Before the pass there were 343 rows and none had
  a rationale.
- **Archetypes** (`data/card-profiles/archetypes/vintage-cube.json`): one
  row for each of the 540 cube cards. Before the pass there were 517 rows and
  none had a rationale. Every row is `reviewed: false` and has a one-line
  `oracle` / `rubric` rationale.
- **Residue** (`data/card-profiles/residue/capability-catalogue.json`):
  six Capability candidates the registry lacks.

The rationale kinds are `oracle` and `rubric` only, because this pass did no
online reading. The `cube-writeup` and `popular-pick` kinds are left to a later
pass.

## Tag counts, before → after

| Archetype  | Before | After |
| ---------- | -----: | ----: |
| control    |    172 |   127 |
| aggro      |    127 |    93 |
| artifacts  |    100 |    82 |
| ramp       |     74 |    58 |
| graveyard  |     70 |    58 |
| combo      |     43 |    22 |
| storm      |     30 |    21 |
| reanimator |     29 |    27 |
| spells     |      — |    36 |
| tokens     |      — |    27 |
| lands      |      — |    24 |
| cheat      |      — |    16 |
| blink      |      — |    14 |
| sacrifice  |      — |     9 |
| no tag     |     53 |   116 |

`control` reads 169 after the census and 127 after the narrowing below.

## Draft Table Audit, before → after

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
```

Measured on the plan-first Auto-Build (PR #9187), base `cc6893e55`. "Base" is
that tip with the seed files as they were before the census; "census" adds the
six catalogue rows and the 540 rows; "control narrowed" also takes `control` off
42 cheap one-for-one cards (below).

| Measure                      | Base `cc6893e55`                                       | Census `f9e6c3eeb`                       | Control narrowed `65b39ebaf`                           | Floor now |
| ---------------------------- | ------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------ | --------- |
| Decks built at ≥ 40          | 64 / 64                                                | 64 / 64                                  | 64 / 64                                                | 1         |
| Mean castability             | 0.865                                                  | 0.858                                    | 0.867                                                  | 0.86      |
| Worst deck's castability     | 0.772                                                  | 0.743                                    | 0.744                                                  | 0.74      |
| Mean plan share              | 0.526                                                  | 0.508                                    | 0.422                                                  | 0.42      |
| Mean Capability pairs / deck | 16.72                                                  | 16.88                                    | 16.69                                                  | 16.68     |
| Plans (deepest Archetype)    | control 38, aggro 19, ramp 5, graveyard 1, artifacts 1 | control 50, aggro 7, artifacts 5, ramp 2 | control 40, aggro 13, artifacts 6, ramp 4, graveyard 1 | —         |

## Reading

- **The narrow rows left `control` as the only broad plan.** Tag counts:
  `aggro` 127 → 93, `ramp` 74 → 58, `combo` 43 → 22, `control` 172 → 169.
  The Auto-Build's plan is the Archetype with the most units in the Pool, so
  `control` became the plan of 50 seats of 64, and no new row ever became one.
- **`control` narrowed by its own clause.** Its TAG WHEN asks for a card that
  "trades for more than it costs" and for "one-for-more removal". 33 cheap
  one-for-one removal and bounce spells (Swords to Plowshares, Fatal Push,
  Cut Down, …), 3 one-for-one discard spells (Duress, Inquisition of Kozilek,
  Thoughtseize) and 6 cantrips that already carry `spells` (Brainstorm,
  Ponder, Preordain, Consider, Thought Scour, Ledger Shredder) drop it:
  `control` 169 → 127. Counterspells, sweepers, card advantage, two-for-ones,
  planeswalkers and long-game threats keep it. Aggro seats 7 → 13.
- **Plan share falls by construction.** It counts the Maindeck spells that
  carry the plan's tag, so a plan-neutral removal spell reads as off-plan. A
  narrower, more truthful vocabulary lowers it while the table gets more
  varied. The Floors are re-baselined to the last column, each rounded down to
  two decimals, with the reason beside them in `scripts/lib/draft-audit.ts`.
- **The plan choice still favours size.** Even narrowed, `control` holds 127
  of 540 cards, and the six new plans are still never chosen. Measuring an
  Archetype's depth against its share of the scope is issue #9298.
- **Capability pairs hold** (16.72 → 16.69, inside the run-to-run spread of
  packs and picks moving with the tags). Reanimation spells now name
  `discard-outlet` / `self-mills`, and free spells and mana artifacts provide
  `value-on-cast`.
