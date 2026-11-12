# Draft Table Audit — fetch lands as fixing

> **Measured at `fa46e9b21` (2026-11-12)** against base `d03e898b7`. Issue
> #9334, PRD #8772.

## What changed

The Limited card meta's `producedColors` came from
`getDefinitionProducibleColors`, the rules' "could produce". A fetch land
produces no mana, so Polluted Delta, Prismatic Vista and Fabled Passage read as
colourless. As a result the Auto-Build never counted them as sources and never
maindecked them, and the pick's Fixing Value term scored them 0.

`producedColors` now reads `limitedSourceColors`
(`convex/limited/manaSourceColors.ts`): produced ∪ fetched. "Fetched" is
derived from structure: a land's activated ability that searches the library
and moves the find onto the battlefield supplies the colours of the land
subtypes in its filter, or every colour for a basic-land filter. The in-game
authority is untouched.

## Draft Table Audit, before → after

```bash
bun run draft:audit -- --scope vintage-cube   # seeds 1..8, 64 decks
```

| Measure                      | Base `d03e898b7` | Fetch lands as sources `fa46e9b21` |
| ---------------------------- | ---------------: | ---------------------------------: |
| Mean castability             |            0.867 |                              0.873 |
| Worst deck's castability     |            0.744 |                              0.759 |
| Mean plan share              |            0.422 |                              0.438 |
| Mean Capability pairs / deck |            16.69 |                              20.44 |
| Colour count                 |     2c 17, 3c 47 |                       2c 14, 3c 50 |

On the same seeds, fetch lands in the Pools went from 0 maindecked to 59 of 62.
On 16 seeds before the change, 260 colourless-reading nonbasic lands sat in the
Pools and none was maindecked.

## Reading

- **Every Floor measure improves.** Fetch lands now fill land slots as real
  sources, so the plan's spells keep their slots and castability rises.
- **Capability pairs jump** (16.69 → 20.44): the cube's fetch lands provide
  `self-mills` (a fetch's crack-back), so a maindecked fetch now pairs with the
  graveyard cards that require it.
- **Slightly more three-colour decks** (47 → 50). The third-colour gate counts
  Pool sources, and the fetches now count among them. Whether a third colour
  pays for itself is issue #9336, measured against the colour-coherence metrics
  of issue #9335.
- **A basic-land fetch reads as every colour.** It finds a basic of whatever
  colour the deck plays, which the builder supplies. Fixing Value therefore
  prices Prismatic Vista as five-colour fixing, which overstates a deck that
  plays basics of only two colours.
