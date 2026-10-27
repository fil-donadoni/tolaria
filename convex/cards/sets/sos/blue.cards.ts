// SOS (Secrets of Strixhaven) — blue cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos/index.cards"` resolves through
// sos/index.cards.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.

import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { FRACTAL_TOKEN } from "../../sharedTokens";
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

// Jadzi, Steward of Fate // Oracle's Gift is one card (CR 722.2c), the
// Skycoach Conductor shape: `entersPrepared` + a prepare `insetSpell`.
//
// Oracle's Gift is {X}{X}{U} (`xFactor: 2`, CR 107.3): X tokens, then X +1/+1
// counters on EACH Fractal its controller controls — pre-existing ones
// included, hence a `forEach` over the battlefield rather than the new tokens'
// bind. Both halves are one resolution, so the 0/0 tokens carry their counters
// before state-based actions are checked (CR 704.3). X = 0 creates nothing and
// puts no counters; the cast still unprepares Jadzi (CR 601.2i).
// hand-tail: "Create X 0/0 green and blue Fractal creature tokens, then put X +1/+1 counters on each Fractal you control." (#3690)
export const jadziStewardOfFate = defineCard(() => ({
    id: "a95b6baf-01e6-49c3-9a26-394b127d53c3",
    rarity: "rare",
    name: "Jadzi, Steward of Fate",
    oracleText:
        "Jadzi enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\nWhen Jadzi enters, draw two cards, then discard two cards.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 4,
    entersPrepared: true,
    triggeredAbilities: [
        enteredTrigger({
            id: "jadzi-steward-of-fate-loot",
            oracleText:
                "When Jadzi enters, draw two cards, then discard two cards.",
            scope: "self",
            effects: [
                { op: "draw", player: "controller", count: 2 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: 2,
                    prompt: "Discard two cards.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: "controller",
                    cards: { ref: "$discard" },
                },
            ],
        }),
    ],
    insetSpell: {
        kind: "prepare",
        name: "Oracle's Gift",
        manaCost: { X: "X", xFactor: 2, U: 1 },
        types: ["Sorcery"],
        oracleText:
            "Create X 0/0 green and blue Fractal creature tokens, then put X +1/+1 counters on each Fractal you control.",
        effects: [
            {
                op: "createToken",
                token: FRACTAL_TOKEN,
                controller: "controller",
                count: { X: true },
            },
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    controller: "controller",
                    filter: { subtype: "Fractal" },
                },
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { ref: "$each" },
                        count: { X: true },
                    },
                ],
            },
        ],
    },
}));
