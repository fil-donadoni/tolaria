# Profile Census — Vintage Cube, first pass

> **Measured at `1be2f3642` (2026-11-10)**, against the base tip `39563e57b`
> the census started from (issue #8902, PRD #8772). The census changes seed data
> only: no build or pick logic moved.

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
| control    |    172 |   169 |
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
| no tag     |     53 |    80 |

## Draft Table Audit, before → after

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
```

| Measure                      |                                            `39563e57b` |                              `1be2f3642` | Floor  |
| ---------------------------- | -----------------------------------------------------: | ---------------------------------------: | ------ |
| Decks built at ≥ 40          |                                                64 / 64 |                                  64 / 64 | held   |
| Mean castability             |                                                  0.761 |                                    0.767 | held   |
| Worst deck's castability     |                                                  0.557 |                                    0.598 | held   |
| Mean plan share              |                                                  0.471 |                                **0.425** | BROKEN |
| Mean Capability pairs / deck |                                                  12.00 |                                    13.19 | held   |
| Plans (deepest Archetype)    | control 38, aggro 19, ramp 5, graveyard 1, artifacts 1 | control 50, aggro 7, artifacts 5, ramp 2 | —      |

## Reading

- **Plan share falls because the census re-wrote what it measures.** A
  deck's plan is its Pool's deepest Archetype, and its plan share is the
  fraction of its Maindeck spells that carry that tag. The Auto-Build does
  not read Archetypes yet, so this measures the tags, not the build. Six new
  rows take cards out of the old broad plans: 36 cards lose `aggro`, mostly
  to `blink`, `tokens`, `sacrifice` and `spells`, and 21 lose `combo` to
  `cheat`, `lands` and `storm`. A Pool's deepest tag is now `control` in 50
  of 64 seats, and `control` covers 0.448 of those decks.
- **Capability pairs rise from 12.00 to 13.19.** This comes from the
  registry clauses read literally, with the requirers named on both sides.
  Reanimation spells now name `discard-outlet` / `self-mills`, and free spells
  and mana artifacts now provide `value-on-cast`.
- **Castability is unchanged in kind.** Packs and picks moved with the new
  tags, and the worst deck improved.

The `meanPlanShare ≥ 0.47` Floor was set on the 8-row vocabulary. Re-baselining
it for 14 rows, or changing how a plan is defined, is the owner's call
(issue #8902).
