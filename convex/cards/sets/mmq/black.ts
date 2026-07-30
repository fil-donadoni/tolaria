// MMQ — black cards, split by colour per ADR 0043. The registry's
// `import * as mmq from "./sets/mmq"` resolves through mmq/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition, SpellContext } from "../../types";

// Snuff Out — {3}{B} Instant. "If you control a Swamp, you may pay 4 life rather
// than pay this spell's mana cost. Destroy target nonblack creature. It can't be
// regenerated." (CR 118.9 alternative pitch cost — a pay-life leg gated on a
// control condition; CR 118.4 pay life; CR 701.7 destroy; CR 701.15c
// regeneration suppression; CR 202.2 colour restriction.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// a `payLife: 4` leg with a `condition: control a Swamp`. The colour gate on the
// target rides `excludeColors` on the TargetRequirement. The "can't be
// regenerated" rider is not expressible as a declarative Op (it is a
// destroy-time flag on the primitive), so — matching the shipped Dark Banishing
// / Terror pattern (ice/black.ts, lea/black.ts) — the effect stays `resolve()`.
// protocol card: `ctx.destroy(target, { cantBeRegenerated: true })` has no
// Effect Script Op (the destroy Op carries no regeneration-suppression flag).
export const snuffOut: CardDefinition = {
    id: "18a3cca1-e50e-49b6-9e1a-f86640e3b177", // MMQ 162
    rarity: "common",
    name: "Snuff Out",
    oracleText:
        "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost.\nDestroy target nonblack creature. It can't be regenerated.",
    manaCost: { X: 3, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1, excludeColors: "B" },
    alternativeCosts: [
        {
            id: "pitch-pay-4-life",
            description: "Pay 4 life",
            life: 4,
            condition: { kind: "control", filter: { subtypes: "Swamp" } },
        },
    ],
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target) ctx.destroy(target, { cantBeRegenerated: true });
    },
};
