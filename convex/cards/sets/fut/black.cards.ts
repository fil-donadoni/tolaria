// fut — black cards (ADR 0043 colour split).
import { defineCard } from "../../types";
import { cyclingLifeAbility } from "../../abilities/cycling";

// Street Wraith — Swampwalk (CR 702.14 landwalk variant) + "Cycling—Pay 2
// life." (CR 702.29a: "[Cost], Discard this card: Draw a card", the cost here
// being life, CR 119.4). The life-cost cycling template is `cyclingLifeAbility`.
// hand-tail: Cycling—Pay 2 life. (#8634)
export const streetWraith = defineCard(() => ({
    id: "bd7867f4-4f58-49c2-9c24-a124dfdb506d",
    name: "Street Wraith",
    rarity: "common",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)\nCycling—Pay 2 life. (Pay 2 life, Discard this card: Draw a card.)",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Wraith"],
    power: 3,
    toughness: 4,
    staticAbilities: ["swampwalk"],
    activatedAbilities: [cyclingLifeAbility(2)],
}));
