// ulg — white cards (ADR 0043 colour split).
import type { CardDefinition, EffectOp } from "../../types";
import { colors as ALL_COLORS } from "../../types";

const COLOR_NAMES: Record<(typeof ALL_COLORS)[number], string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
};

/** One `optionChoice` mode per grantable color, each granting
 *  "protection from <color>" to the announced target (CR 702.16, 613.1f).
 *  Shared by Mother of Runes (5 colors) and Giver of Runes (5 colors +
 *  colorless — issue #684). */
function protectionColorModes(
    codes: ReadonlyArray<(typeof ALL_COLORS)[number]>
): { id: string; label: string; effects: EffectOp[] }[] {
    return codes.map((code) => {
        const color = COLOR_NAMES[code];
        return {
            id: `protection-${color}`,
            label: `Protection from ${color}`,
            effects: [
                {
                    op: "grantAbility",
                    ability: `protection from ${color}`,
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                } satisfies EffectOp,
            ],
        };
    });
}

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
            targetRequirement: { type: "Creature", count: 1, controller: "you" },
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
