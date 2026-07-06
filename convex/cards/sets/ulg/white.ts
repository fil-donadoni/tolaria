// ulg — white cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";
import { protectionColorModes } from "../../abilities";

// Mother of Runes — {W} Creature — Human Cleric (issue #684, Cube FREE
// evasion/protection statics). "{T}: Target creature you control gains
// protection from the color of your choice until end of turn." (CR 702.16
// protection; CR 613.1f temporary keyword grant; CR 700.2 modal choice.)
export const motherOfRunes: CardDefinition = {
    id: "0b1a46ab-95cb-4c24-924f-fc2afd4fcac7",
    name: "Mother of Runes",
    rarity: "uncommon",
    oracleText:
        "{T}: Target creature you control gains protection from the color of your choice until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "mother-of-runes-protect",
            oracleText:
                "{T}: Target creature you control gains protection from the color of your choice until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a color",
                    modes: protectionColorModes(["W", "U", "B", "R", "G"]),
                },
            ],
        },
    ],
};
