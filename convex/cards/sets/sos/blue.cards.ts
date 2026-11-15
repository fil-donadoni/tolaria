// SOS (Secrets of Strixhaven) — blue cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos/index.cards"` resolves through
// sos/index.cards.ts. Cards are classified by the colour identity of their mana
// cost (CR 202.2): lands and colourless artifacts (no coloured cost) live in
// colorless.ts.

import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { FRACTAL_TOKEN } from "../../sharedTokens";
import { defineCard } from "../../types";

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
