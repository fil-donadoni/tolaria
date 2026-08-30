// WOE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as woe from "./sets/woe"` resolves through woe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#2945) — Agatha's Soul Cauldron, spec + slices in
// #1324. Two clauses are still unbuilt, and NEITHER is a missing Op:
// "Creatures you control with +1/+1 counters on them have all activated
// abilities of all creature cards exiled with [this]" needs a layer-6 grant
// driven by a live-varying linked-exile set, which the materialise-once grant
// model cannot express (ADR 0082, PRD #2064); "spend mana as though it were
// mana of any color to activate abilities of creatures you control" needs a
// SCOPE on the existing `mana-substitution` static, which #2890 shipped
// unscoped (CR 609.4b). The linked-exile set itself IS built (#1319) —
// `exiledBySourceId`, read by the `{ exiledWithSource: true }` selector.
// export const agathasSoulCauldron: CardDefinition = {
//     id: "019b51b0-e5c6-4208-922b-7736686dddcd",
//     name: "Agatha's Soul Cauldron",
//     rarity: "mythic",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
// };

export {};
