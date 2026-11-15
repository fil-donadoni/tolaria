// mir (Mirage) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import { defineCard } from "../../types";

// Cursed Totem — "Activated abilities of creatures can't be activated."
// CR 602.5: a player can't begin to activate a prohibited ability. Declared as
// an `activation-restriction` static over every creature on the battlefield
// (CR 109.2), read live by `activationRestrictionViolation`. No mana-ability
// exemption: a mana ability is an activated ability (CR 605.1a), so a Llanowar
// Elves can't tap for mana while the Totem is out.
export const cursedTotem = defineCard(() => ({
    id: "cc99ee76-45b6-4f1d-b0b0-7da8775ca90c",
    rarity: "rare",
    name: "Cursed Totem",
    oracleText: "Activated abilities of creatures can't be activated.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "activation-restriction",
            id: "cursed-totem-creature-activation-lock",
            filter: { types: "Creature" },
            oracleText: "Activated abilities of creatures can't be activated.",
        },
    ],
}));
