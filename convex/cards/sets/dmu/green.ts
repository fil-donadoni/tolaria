// DMU — green cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu"` resolves through dmu/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Tear Asunder — "Kicker {1}{B}. Exile target artifact or enchantment. If this
// spell was kicked, exile target nonland permanent instead." (CR 702.33 Kicker,
// CR 701.13 exile.) The kick WIDENS the target set (artifact/enchantment → any
// nonland permanent), so the effect is a plain exile and the kicked target set
// is expressed with `kickedTargetRequirement`. "Nonland permanent" is the four
// nonland permanent card types (Creature, Artifact, Enchantment, Planeswalker;
// Battle unused in this cube era). Card colour is green ({1}{G}); the kicker's
// {B} does not change the card's colour. Vintage Cube Kicker cluster (#692).
export const tearAsunder: CardDefinition = {
    id: "629aa907-9533-4681-9bf2-9e56450a4cc2",
    rarity: "uncommon",
    name: "Tear Asunder",
    oracleText:
        "Kicker {1}{B} (You may pay an additional {1}{B} as you cast this spell.)\nExile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 1, B: 1 } },
    // Unkicked: target artifact or enchantment.
    targetRequirement: {
        type: ["Artifact", "Enchantment"],
        count: 1,
    },
    // Kicked: target nonland permanent.
    kickedTargetRequirement: {
        type: ["Creature", "Artifact", "Enchantment", "Planeswalker"],
        count: 1,
    },
    effects: [{ op: "exile", target: { target: 0 } }],
};
