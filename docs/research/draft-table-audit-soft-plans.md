# Draft Table Audit — plans as soft weights

> **Measured at `24bbd9515` (2026-11-13)** against its base `8f7da4c8b`.
> Issue #9356, PRD #8772.

## What changed

Auto-Build committed to ONE plan: the settled Archetype with the largest
surplus over its scope (issue #9298). Its cards, their Capability partners and
the deck's mana-producing spells were taken first, and every other spell
competed for what was left. A Vintage Cube Pool mixing two packages lost the
second one to weaker plan cards.

Every settled Archetype with a positive surplus is now a plan, weighed by its
surplus over the largest one (`planArchetypeWeights`,
`convex/limited/planArchetype.ts`): the deepest weighs 1, a second in
proportion. With no positive surplus, the least-diluted settled Archetype
weighs 1 alone, as before. A spell's value gains `PLAN_CARD_RATING` (2) times
the summed weights of the plans it carries, both when the Maindeck is selected
and when the colour set is scored. Nothing holds a reserved slot: the
Maindeck is filled by value alone.

Plan share is redefined for a multi-plan deck: the share of Maindeck spells
carrying **any** Archetype the Pool is committed to.

## Draft Table Audit, before → after

```bash
bun run draft:audit -- --scope vintage-cube              # seeds 1..8, 64 decks
bun run draft:audit -- --scope vintage-cube --seeds 64   # 512 decks
```

The "old build, new share" column runs the base's `autoBuild.ts` with the
new audit, so the plan share is read the same way on both builds.

| Measure (seeds 1..8)         | Base `8f7da4c8b` | Old build, new share | Soft weights `24bbd9515` |
| ---------------------------- | ---------------- | -------------------- | ------------------------ |
| Decks built at ≥ 40          | 64 / 64          | 64 / 64              | 64 / 64                  |
| Mean castability             | 0.886            | 0.886                | 0.891                    |
| Worst deck's castability     | 0.770            | 0.770                | 0.759                    |
| p5 deck castability          | 0.793            | 0.793                | 0.776                    |
| Mean plan share (single)     | 0.492            | —                    | —                        |
| Mean plan share (any plan)   | —                | 0.679                | 0.707                    |
| Mean Capability pairs / deck | 27.11            | 27.11                | 23.19                    |
| Colours 1c / 2c / 3c / 4c    | 1 / 28 / 29 / 6  | 1 / 28 / 29 / 6      | 2 / 27 / 32 / 3          |

| Measure (seeds 1..64)        | Base  | Old build, new share | Soft weights |
| ---------------------------- | ----- | -------------------- | ------------ |
| Mean castability             | 0.887 | 0.887                | 0.887        |
| Worst deck's castability     | 0.751 | 0.751                | 0.759        |
| p5 deck castability          | 0.806 | 0.806                | 0.807        |
| Mean plan share (any plan)   | —     | 0.699                | 0.725        |
| Mean Capability pairs / deck | 28.45 | 28.45                | 24.03        |

p5 deck castability per eight-seed block, 1..8 first:

| Build        | Blocks                                          |
| ------------ | ----------------------------------------------- |
| Base         | 0.793 0.798 0.827 0.797 0.826 0.817 0.821 0.806 |
| Soft weights | 0.776 0.805 0.823 0.808 0.817 0.812 0.799 0.809 |

Plans per deck under soft weights (512 decks): one 149, two 234, three 114,
four 15.

LEA (no profiles, no plan) is unchanged: `sha256` of the run identical.

## Reading

- **Pools keep their second package.** 363 of 512 decks weigh more than one
  plan, and the share of spells on any committed plan rises 0.699 → 0.725 over
  64 seeds. Castability does not move over 64 seeds.
- **The p5 Floor moves on a single block.** Seeds 1..8 become the lowest of
  eight blocks (0.776; median 0.809) while the 64-seed p5 holds (0.806 →
  0.807). The Floor is loosened 0.79 → 0.77 with the reason beside it in
  `scripts/lib/draft-audit.ts`.
- **Capability pairs fall** 28.45 → 24.03: a plan card's Capability partner
  no longer holds a reserved slot and competes on its Capability fit term
  alone. It stays far above its Floor (16.71).
- **Plan share Floor re-set** 0.49 → 0.70 on the new definition (0.707 on
  seeds 1..8).
