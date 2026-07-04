// BIG — red cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — the golem-creating ability's cost is "Sacrifice
// ANOTHER artifact" (excluding this permanent itself), but
// `ActivatedAbility.cost.sacrificeFilter` is a static `PermanentFilter` with
// no way to reference the activating permanent's own (runtime-only) instance
// id — unlike `targetRequirement`, which has a dynamic `getTargetRequirement
// (source)` escape hatch (Sorceress Queen precedent, arn/black.ts), no
// equivalent dynamic cost hook exists for activation costs. Shipping with an
// unenforced `excludeInstanceIds: []` would let the card illegally sacrifice
// itself to pay its own cost. The ETB damage half would be DSL-clean on its
// own, but shipping only half the card misrepresents it. Stop-and-issue per
// gre-development.md; tracked stub.
// export const legionExtruder: CardDefinition = {
//     id: "5a077de0-1893-40d0-a499-ee2e6e2258f1",
//     name: "Legion Extruder",
//     rarity: "mythic",
//     manaCost: { X: 1, R: 1 },
//     types: ["Artifact"],
// };

export {};
