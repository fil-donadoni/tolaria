// SOS (Secrets of Strixhaven) — blue cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos/index.cards"` resolves through
// sos/index.cards.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.

import { defineCard } from "../../types";

// Skycoach Conductor // All Aboard is one card (CR 722.2c): one catalogue row,
// one lockfile row, one anchor. The prepare spell printed in the inset frame
// is declared on `insetSpell` with `kind: "prepare"`; the engine-visible half
// is the twin `${id}#prepare` that `cards/insetSpell.ts` registers. CR 722.3 —
// the parent never offers it as a cast option (`INSET_SPELL_KINDS.prepare`).
// What makes it castable is the CR 722.3a designation: "This creature enters
// prepared" (`entersPrepared`) gives the permanent the `prepared` marker as it
// enters, and CR 722.3c has its controller create the castable exiled copy
// (`gre/prepare.ts`).
//
// All Aboard is the flicker — `exile` with a `bind`, then `moveZone` of that
// bound card from exile back to the battlefield, which returns under the
// OWNER's control by default (CR 400.7) — behind a "non-Pilot creature you
// control" target (CR 205.3, `excludeSubtypes`).
export const skycoachConductor = defineCard(() => ({
    id: "f9092a09-78a8-421c-868b-115175f4c252",
    rarity: "rare",
    name: "Skycoach Conductor",
    oracleText:
        "Flash\nFlying, vigilance\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird", "Pilot"],
    power: 2,
    toughness: 3,
    staticAbilities: ["flash", "flying", "vigilance"],
    entersPrepared: true,
    insetSpell: {
        kind: "prepare",
        name: "All Aboard",
        manaCost: { U: 1 },
        types: ["Instant"],
        oracleText:
            "Exile target non-Pilot creature you control, then return that card to the battlefield under its owner's control.",
        targetRequirement: {
            type: "Creature",
            count: 1,
            controller: "you",
            excludeSubtypes: ["Pilot"],
        },
        effects: [
            { op: "exile", target: { target: 0 }, bind: "$that1" },
            {
                op: "moveZone",
                target: { ref: "$that1" },
                from: "exile",
                to: "battlefield",
            },
        ],
    },
}));
