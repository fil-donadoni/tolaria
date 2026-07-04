// EXO — green cards, split by colour per ADR 0043. The registry's
// `import * as exo from "./sets/exo"` resolves through exo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Survival of the Fittest — "{G}, Discard a creature card: Search your
// library for a creature card, reveal that card, put it into your hand,
// then shuffle." Blocked: the cost "discard a creature card" needs the
// activator to CHOOSE which matching card to discard as part of paying an
// activation cost — `ActivatedAbility.cost` has `sacrificeFilter` (a chosen
// permanent matching a filter) but no discard-from-hand equivalent (only
// `discardLastDrawn` / `discardAtRandom`, neither a chosen-card cost). Not a
// `resolve()` card — a missing-capability stop-and-issue case.
// tracked-by: #901
// export const survivalOfTheFittest: CardDefinition = {
//     id: "c060c178-3c0e-493f-b6f0-ead5b1d6f191",
//     name: "Survival of the Fittest",
//     rarity: "rare",
//     manaCost: { X: 1, G: 1 },
//     types: ["Enchantment"],
// };

export {};
