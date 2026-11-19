# Draft Table Audit — the land drop and cost-cheat enablers

> **Measured at `6c31e1ba6` (2026-11-19)**, the branch of issue #9978 on top
> of base `0a19c21d5`. Seeds 1..8 (the Floors' seeds, 64 decks per scope);
> "base" is the same tree with `convex/limited/autoBuild.ts` reverted to the
> base's.

## What changed in the build

Castability used to read only the coloured pips (`pipCastability`). A
colourless twelve-drop read 1: Blightsteel Colossus and Worldspine Wurm were
maindecked in piles with no cheat, and Emrakul beside Exhume, which can never
return it.

Auto-Build now multiplies the pip castability by the **land drop**
(`manaValueCastability`, `convex/limited/castability.ts`). That is the chance
the deck has drawn as many mana sources (lands, and spells that make mana) as
the spell's mana value, by turn `max(mv, LAND_DROP_HORIZON = 12)`. With 17
sources in 40 cards it reads:

| MV  | 6    | 7    | 8    | 9    | 10   | 11   | 12   |
| --- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| p   | 0.92 | 0.77 | 0.54 | 0.29 | 0.12 | 0.03 | 0.01 |

The factor is waived in two cases:

- **The card reduces its own cost**: delve, convoke, improvise, or a
  `selfCostReduction` such as affinity (`convex/limited/ownCostReduction.ts`).
- **The card is cost-cheated.** Another on-colour spell's Card Profile
  requires a Capability that the card provides, and that Capability's
  registry row is flagged `cheatsManaCost`. The flagged rows are
  `reanimatable`, `cheat-target`, `value-on-etb`, `value-on-attack`,
  `value-on-death` and `big-artifact`. This means "needs an enabler" is read
  from the Profile, never from a list of card names. Exhume requires
  `reanimatable`, which Emrakul does not provide, so Exhume does not cheat
  Emrakul's cost.

The audit still reads the pip half alone (`draftTableAudit.ts`).

## Numbers

| Scope        | Metric                 | base  | branch |
| ------------ | ---------------------- | ----- | ------ |
| Vintage Cube | `meanCastability`      | 0.888 | 0.886  |
| Vintage Cube | `p5DeckCastability`    | 0.820 | 0.820  |
| Vintage Cube | `meanPlanShare`        | 0.706 | 0.707  |
| Vintage Cube | `meanCapabilityPairs`  | 24.17 | 24.72  |
| Vintage Cube | mean MV 6+ spells/deck | 1.88  | 1.75   |
| LEA          | `meanCastability`      | 0.768 | 0.769  |
| LEA          | `worstDeckCastability` | 0.589 | 0.589  |

On the Vintage Cube, the 6+ slots drop by 0.13 per deck and the Capability
pairs rise, as cheats now get maindecked beside their targets. The pip meter
moves by 0.002 because it cannot see the colourless fatties that were cut.

## The LEA Floor

LEA's `meanCastability` Floor was already broken on the base: 0.768 against
0.77. On 2026-11-13 the same seeds read 0.771. A `git bisect` names
`d6a562ac4` as the first bad commit. That `derive:sync` only refit
`convex/gre/ai/fittedEvalWeights.ts`, with no drafter or builder change. This
branch reads 0.769, so the Floor moves 0.77 → 0.76
(`scripts/lib/draft-audit.ts`). The coupling between the Bot's eval weights
and this Floor is filed in
`docs/findings/9978-eval-weight-refit-moves-draft-audit-floors.md`.
