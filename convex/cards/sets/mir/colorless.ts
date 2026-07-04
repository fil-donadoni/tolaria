// mir (Mirage) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { ActivatedAbilityContext, CardDefinition } from "../../types";

// Lion's Eye Diamond — "Discard your hand, Sacrifice this artifact: Add
// three mana of any one color. Activate only as an instant." (CR 605.1a mana
// ability, `useStack: false`.) "Discard your hand" is expressed via the
// existing `discardAtRandom` cost primitive with a count comfortably above
// any reachable hand size — the primitive clamps to the actual hand size
// (CR 118.3), so every card is discarded regardless of hand size and the
// random-order detail is moot once every card is discarded. "Activate only
// as an instant" needs no extra modelling: mana abilities are already
// activatable at instant speed (CR 605.3b — any time the player has
// priority), which is the full content of that clause here. Vintage Cube
// free tranche (issue #675, ADR 0041).
export const lionsEyeDiamond: CardDefinition = {
    id: "63bacc32-d6ba-420c-9b49-299c08e5fb39",
    rarity: "rare",
    name: "Lion's Eye Diamond",
    oracleText:
        "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "lions-eye-diamond-mana",
            oracleText:
                "Discard your hand, Sacrifice this artifact: Add three mana of any one color.",
            cost: { sacrifice: true, discardAtRandom: 99 },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 3 });
            },
            manaChoices: [{ W: 3 }, { U: 3 }, { B: 3 }, { R: 3 }, { G: 3 }],
        },
    ],
};
