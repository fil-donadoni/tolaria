// FIN — colorless cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Starting Town — "This land enters tapped unless it's your first, second,
// or third turn of the game. {T}: Add {C}. {T}, Pay 1 life: Add one mana of
// any color." STOP-AND-ISSUE (issue #675): the two lines are separate {T}
// mana abilities with DIFFERENT costs (one free, one paying 1 life) — this
// engine's tap-mana fast path (`tapUntap` in `convex/game.ts`) resolves a
// permanent's mana ability via `getActivatedManaAbility`'s `.find()` of the
// FIRST `{T}`-cost ability only, and the non-tap `activateManaAbility`
// mutation explicitly rejects `cost.tap` abilities — so a card cannot carry
// two independently-activatable `{T}` mana abilities. Combining them into one
// `manaChoices` ability (the Mana Confluence / Talisman shape) doesn't fit
// either: `cost.life` is a flat cost applied to the WHOLE ability regardless
// of which option is chosen, but here only the coloured options should cost
// life while the colorless option stays free — a per-manaChoice-conditional
// cost, which has no existing rider (the closest, `dealsDamageToControllerOn-
// ColoredTap`, fires an unavoidable POST-hoc damage effect, not a pay-or-skip
// COST). Left as a tracked stub pending that primitive.
// export const startingTown: CardDefinition = {
//     id: "fc7d1912-7e27-49ef-bd98-375d975a42b0",
//     name: "Starting Town",
//     rarity: "rare",
//     types: ["Land"],
//     subtypes: ["Town"],
// };

export {};
