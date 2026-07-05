// FIN — red cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Suplex — "Choose one — • Suplex deals 3 damage to target creature. If that
// creature would die this turn, exile it instead. • Exile target artifact."
// (CR 700.2 modal.) Modes target different types (creature vs artifact),
// chosen before the target — the same cross-mode-target shape as Abrade
// (hou/red.ts), so this uses the legacy `modes` mechanism too. Mode 1's
// "exile instead of dying" is the existing `setExileOnDeath` primitive
// (Disintegrate precedent, lea/red.ts) — no new primitive.
export const suplex: CardDefinition = {
    id: "f61693a2-7042-44e0-85ba-9bf12ab94e7e",
    rarity: "common",
    name: "Suplex",
    oracleText:
        "Choose one —\n• Suplex deals 3 damage to target creature. If that creature would die this turn, exile it instead.\n• Exile target artifact.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    modes: [
        {
            id: "damage",
            label: "Suplex deals 3 damage to target creature. If that creature would die this turn, exile it instead.",
            oracleText:
                "Suplex deals 3 damage to target creature. If that creature would die this turn, exile it instead.",
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                // CR 614.1a (Disintegrate precedent) — mark first so the
                // damage's SBA death check exiles instead of destroying.
                ctx.setExileOnDeath(target);
                ctx.dealDamage(target, 3);
            },
        },
        {
            id: "exile",
            label: "Exile target artifact.",
            oracleText: "Exile target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.exile(target);
            },
        },
    ],
};
