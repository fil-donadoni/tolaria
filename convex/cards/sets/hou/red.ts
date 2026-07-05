// HOU — red cards, split by colour per ADR 0043. The registry's
// `import * as hou from "./sets/hou"` resolves through hou/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Abrade — "Choose one — • Abrade deals 3 damage to target creature. •
// Destroy target artifact." (CR 700.2 modal.) Modes target different types
// (creature vs artifact), chosen before the target — the same cross-mode-
// target gap as Healing Salve (lea/white.ts); uses the legacy `modes`
// mechanism instead of the DSL `optionChoice` Op (which runs on a single
// already-announced target set).
export const abrade: CardDefinition = {
    id: "84319dfb-eaf7-4b98-8c4f-30f5e779591b",
    rarity: "uncommon",
    name: "Abrade",
    oracleText:
        "Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "damage",
            label: "Abrade deals 3 damage to target creature.",
            oracleText: "Abrade deals 3 damage to target creature.",
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.dealDamage(target, 3);
            },
        },
        {
            id: "destroy",
            label: "Destroy target artifact.",
            oracleText: "Destroy target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.destroy(target);
            },
        },
    ],
};
