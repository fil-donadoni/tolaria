// APC — colorless cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";

// Dragon Arch — {5} Artifact. "{2}, {T}: You may put a multicolored creature
// card from your hand onto the battlefield."
//
// Sneak Attack's hand → battlefield template (usg/red.ts) with the "You may"
// spelled as `count: { min: 0, max: 1 }` — declining is a legal answer, so the
// activation is never a trap — and the ONE thing this card adds over it:
// "multicolored" (CR 105.2b) as `colorCountAtLeast: 2` rather than an OR over
// the five colours, which would admit every mono-coloured card. No follow-up
// clause at all: the creature enters and STAYS (no haste grant, no delayed
// sacrifice), which is exactly what makes this card the cheap end of the
// reanimator-adjacent shell rather than a Sneak Attack variant.
//
// `moveZone(from: "hand", to: "battlefield")` is CR 400.7's zone change; the
// creature is not CAST — casting is the process that puts a spell ON THE
// STACK (CR 601.2), and this one never goes there, so no cast-triggers fire.
//
// hand-tail: "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield." (#3806)
export const dragonArch: CardDefinition = {
    id: "eec581b8-e509-420c-b142-afaa6dd06cc8", // APC 135
    name: "Dragon Arch",
    rarity: "uncommon",
    oracleText:
        "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.",
    manaCost: { X: 5 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "dragon-arch-put",
            oracleText:
                "{2}, {T}: You may put a multicolored creature card from your hand onto the battlefield.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    // CR 105.2b — "multicolored" is a COUNT of colours, never a
                    // colour: two or more of the five.
                    filter: { type: "Creature", colorCountAtLeast: 2 },
                    count: { min: 0, max: 1 },
                    prompt: "Put a multicolored creature card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};

// Brass Herald — {6} 2/2 Artifact Creature — Golem (issue #3809). Three
// abilities linked by ONE choice (CR 607.2d — "the chosen type" refers only to
// the choice its own "choose a creature type" ability made):
//
//  - "As this creature enters, choose a creature type." — the CR 614.1c /
//    614.12a replacement `entersWith.asEnters: { kind: "subtypes" }`, made
//    BEFORE it enters and stored on `CardInstanceState.chosenSubtypes`
//    (Engineered Plague's shape, `ulg/black.ts`), from CR 205.3m's own table.
//  - The ETB (CR 603.6a) is Goblin Ringleader's reveal-four template
//    (`apc/red.ts`) with the chosen type in the filter: the reserved
//    `$source.chosenSubtype` ref reads the source's stored choice — its
//    departure-time last-known record if Brass Herald left before the trigger
//    resolved (CR 608.2h) — and fails CLOSED (nothing is kept) when there is
//    none. "Creature cards of the chosen type" is BOTH conditions: `type`
//    AND `subtype`, so a Tribal/Kindred non-creature card of that type stays
//    in the bottom pile.
//  - "Creatures of the chosen type get +1/+1." — every controller's, itself
//    included when Golem is chosen; a live `pt-buff` predicate, so a creature
//    whose types change later (layer 4 before 7c) is read on the next pass.
//
// compiler-gap: As this creature enters, choose a creature type. (#2693)
// compiler-gap: When this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order. (#2693)
// compiler-gap: Creatures of the chosen type get +1/+1. (#2693)
export const brassHerald: CardDefinition = {
    id: "89bd60a7-2ba4-4fce-bf74-2ea9b8fd4dbe", // APC 133
    name: "Brass Herald",
    rarity: "uncommon",
    oracleText:
        "As this creature enters, choose a creature type.\nWhen this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.\nCreatures of the chosen type get +1/+1.",
    manaCost: { X: 6 },
    types: ["Artifact", "Creature"],
    subtypes: ["Golem"],
    power: 2,
    toughness: 2,
    entersWith: {
        asEnters: [
            { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
        ],
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "brass-herald-reveal",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    player: "controller",
                    look: 4,
                    take: 4,
                    keepTo: "hand",
                    filter: {
                        type: "Creature",
                        subtype: { ref: "$source.chosenSubtype" },
                    },
                    optional: false,
                    reveal: "window",
                    prompt: "Put all creature cards of the chosen type revealed this way into your hand; the rest go on the bottom of your library in any order.",
                },
            ],
        }),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) => {
                const chosen = source.chosenSubtypes?.[0];
                if (chosen === undefined) return false;
                return ctx.isCreature(target) && ctx.hasSubtype(target, chosen);
            },
            power: 1,
            toughness: 1,
        },
    ],
};
