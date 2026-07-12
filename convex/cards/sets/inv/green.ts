// Invasion (INV) — green cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition, Color, SpellContext } from "../../types";

// Blurred Mongoose — "This spell can't be countered. Shroud (This creature
// can't be the target of spells or abilities.)" (CR 701.5c can't-be-countered
// flag, issue #1065; CR 702.18 Shroud.)
//
// The registry's `staticAbilities: ["shroud"]` string is decorative on its
// own (`mechanicsRegistry.ts` — "shroud" is registry status "planned": no
// engine path derives real target-illegality from the bare keyword string
// generically). The established per-card pattern for a printed Shroud/self-
// guard clause (Lurker `drk/green.ts`, Spectral Cloak `leg/blue.ts`) is an
// explicit `permanent-guard` static effect scoped to the permanent itself
// (`target.id === source.id`) — unconditional and unfiltered here (unlike
// Lurker's combat-gated version), matching CR 702.18's unqualified "can't be
// the target of spells or abilities."
export const blurredMongoose: CardDefinition = {
    id: "4b073e3f-6a6f-495a-ab16-39d906b660f1",
    rarity: "uncommon",
    name: "Blurred Mongoose",
    oracleText:
        "This spell can't be countered.\nShroud (This creature can't be the target of spells or abilities.)",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Mongoose"],
    power: 2,
    toughness: 1,
    cantBeCountered: true,
    staticAbilities: ["shroud"],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "blurred-mongoose-shroud",
            cantBeTargeted: true,
            applies: (target, source) => target.id === source.id,
        },
    ],
};

// The five basic colours a "becomes the color of your choice" effect may
// pick, mirroring Shyft's mono-colour reading of "color or colors of your
// choice"-style effects (`ice/blue.ts` SHYFT_COLOR_OPTIONS) — Kavu
// Chameleon's oracle text is already single-colour ("the color", not "color
// or colors"), so no simplification is needed here.
const KAVU_CHAMELEON_COLOR_OPTIONS: { id: Color; label: string }[] = [
    { id: "W", label: "White" },
    { id: "U", label: "Blue" },
    { id: "B", label: "Black" },
    { id: "R", label: "Red" },
    { id: "G", label: "Green" },
];

// Kavu Chameleon — "This spell can't be countered. {G}: This creature
// becomes the color of your choice until end of turn." (CR 701.5c can't-be-
// countered flag, issue #1065; CR 305.7 / 613.1d layer-5 colour change.)
//
// The activated ability is a `resolve()` closure, not DSL: the DSL Op that
// would skin this ("setColor") is registry status "planned"
// (`mechanicsRegistry.ts`) — not yet implemented — so per the DSL-first
// stop-and-issue rule it is NOT invented here. Instead this reuses the
// EXISTING `SpellContext.setColorOverride` primitive directly (the same
// primitive ~7 other resolve()-based cards already call — Alchor's Tomb,
// Dream Coat, Shyft, the LEG/LEA lace instants), generalized with an
// optional `duration` parameter (issue #1065) so a "until end of turn"
// change reverts at CLEANUP instead of lasting indefinitely like those. The
// colour CHOICE reuses the same `requestOptionChoice` mono-colour picker
// Shyft uses (`ice/blue.ts`).
export const kavuChameleon: CardDefinition = {
    id: "f726437b-a41a-4ee9-b0ee-e09327508615",
    rarity: "uncommon",
    name: "Kavu Chameleon",
    oracleText:
        "This spell can't be countered.\n{G}: This creature becomes the color of your choice until end of turn.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 4,
    toughness: 4,
    cantBeCountered: true,
    activatedAbilities: [
        {
            id: "kavu-chameleon-color",
            oracleText:
                "{G}: This creature becomes the color of your choice until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const chosen = ctx.requestOptionChoice({
                    playerId: ctx.controller,
                    choiceId: "kavu-chameleon-color",
                    options: KAVU_CHAMELEON_COLOR_OPTIONS,
                    prompt: "Choose a color for Kavu Chameleon.",
                });
                if (chosen === undefined) return; // suspended
                ctx.setColorOverride(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    [chosen as Color],
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};
