// C21 — green cards, split by colour per ADR 0043. The registry's
// `import * as c21 from "./sets/c21"` resolves through c21/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Pest Infestation — {X}{X}{G} Sorcery (Cube FREE residue token-maker, issue
// #1304). "Destroy up to X target artifacts and/or enchantments. Create
// twice X 1/1 black and green Pest creature tokens with 'When this token
// dies, you gain 1 life.'" Blocked on THREE gaps, none of them an
// uncensused Op name: (1) "up to X target" is a genuinely OPTIONAL variable
// target count (CR 601.2c) — `TargetRequirement.count: "X"` resolves to an
// EXACT `chosenX` mandatory count (`resolveTargetCount`, `convex/game.ts`),
// and the `{ min, max }` object form's `max` is a plain `number`, not
// dynamically tied to X; no `getTargetRequirement`-style per-cast hook
// exists for a spell (only `ActivatedAbility` has one). (2) "twice X" tokens
// needs arithmetic composition on the `X` `EffectValue` member, which ADR
// 0045's frozen grammar explicitly does not support ("nothing else composes
// it") — distinct from `EffectCountSpec.times`, which scales a COUNTED SET's
// cardinality, not a bare X. (3) the Pest token's own "When this token dies,
// you gain 1 life" is a TRIGGERED ability the token carries — `TokenSpec` /
// `EffectTokenSpec` (`convex/cards/types.ts`) have no `triggeredAbilities`
// field at all, and `createTokenPermanents` (`convex/gre/state.ts`) never
// registers one even for a `resolve()` card. Stop-and-issue per
// gre-development.md — shipping any subset would misrepresent the card (the
// X target/count bounds ARE the card, and the Pest token's defining ability
// can't be dropped silently). tracked-by: #1357
// export const pestInfestation: CardDefinition = {
//     id: "4720b4f2-e6af-4223-9250-a0ed21ed5693",
//     name: "Pest Infestation",
//     rarity: "rare",
//     manaCost: { X: "X", xFactor: 2, G: 1 },
//     types: ["Sorcery"],
// };

export {};
