// Pawprint modal spells (CR 700.2i / 107.18): "Choose up to five {P} worth of
// modes. You may choose the same mode more than once." — a {P} BUDGET over
// modes printed with one to three pawprints, lowered onto
// `ModeSelection.pawprintBudget` and `ModeOption.pawprints`.
//
//  1. GOLDEN — Season of the Burrow compiled whole, which also exhibits the two
//     mode bodies this cluster reads: "Its controller draws a card" (CR 109.4 +
//     CR 608.2h) and the graveyard return "with an indestructible counter on
//     it" (CR 122.6 + CR 122.1b).
//  2. REFUSALS — the printed neighbours the rules must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const SEASON_OF_THE_BURROW_TEXT =
    "Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — Create a 1/1 white Rabbit creature token.\n{P}{P} — Exile target nonland permanent. Its controller draws a card.\n{P}{P}{P} — Return target permanent card with mana value 3 or less from your graveyard to the battlefield with an indestructible counter on it.";

const PAWPRINT_HEAD =
    "Choose up to five {P} worth of modes. You may choose the same mode more than once.";

function sorcery(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{3}{W}{W}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("pawprint modal spells (CR 700.2i) — golden", () => {
    it("Season of the Burrow: a five-{P} budget over 1/2/3-{P} modes", () => {
        const outcome = compileCard(
            sorcery("Season of the Burrow", SEASON_OF_THE_BURROW_TEXT)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Season of the Burrow",
                types: ["Sorcery"],
                manaCost: {
                    X: 3,
                    W: 2,
                },
                oracleText: SEASON_OF_THE_BURROW_TEXT,
                modes: [
                    {
                        id: "season-of-the-burrow-mode-1",
                        label: "Create a 1/1 white Rabbit creature token",
                        oracleText: "Create a 1/1 white Rabbit creature token.",
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Rabbit",
                                    types: ["Creature"],
                                    subtypes: ["Rabbit"],
                                    power: 1,
                                    toughness: 1,
                                    colors: ["W"],
                                },
                                controller: "controller",
                            },
                        ],
                        pawprints: 1,
                    },
                    {
                        id: "season-of-the-burrow-mode-2",
                        label: "Exile target nonland permanent. Its controller draws a card",
                        oracleText:
                            "Exile target nonland permanent. Its controller draws a card.",
                        effects: [
                            {
                                op: "exile",
                                target: {
                                    target: 0,
                                },
                                bind: "$that1",
                            },
                            {
                                op: "draw",
                                player: {
                                    ref: "$that1.controller",
                                },
                                count: 1,
                            },
                        ],
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: 1,
                            excludeTypes: ["Land"],
                        },
                        pawprints: 2,
                    },
                    {
                        id: "season-of-the-burrow-mode-3",
                        label: "Return target permanent card with mana value 3 or less from your graveyard to the battlefield with an indestructible counter on it",
                        oracleText:
                            "Return target permanent card with mana value 3 or less from your graveyard to the battlefield with an indestructible counter on it.",
                        effects: [
                            {
                                op: "moveZone",
                                target: {
                                    target: 0,
                                },
                                to: "battlefield",
                                entersWithCounters: {
                                    indestructible: 1,
                                },
                            },
                        ],
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: 1,
                            mvFilter: {
                                max: 3,
                            },
                            zone: "graveyard",
                            controller: "you",
                        },
                        pawprints: 3,
                    },
                ],
                modeSelection: {
                    min: 1,
                    max: 5,
                    repeats: true,
                    pawprintBudget: 5,
                },
            })
        );
    });
});

describe("pawprint modal spells (CR 700.2i) — refusals", () => {
    const refused = (text: string) => compileCard(sorcery("Probe", text)).state;

    it("a pawprint head over bullet modes is not read", () => {
        expect(
            refused(
                `${PAWPRINT_HEAD}\n• Draw a card.\n• Create a 1/1 white Rabbit creature token.`
            )
        ).toBe("unparsed");
    });
    it("a bullet head over pawprint modes is not read", () => {
        expect(
            refused(
                "Choose one —\n{P} — Draw a card.\n{P}{P} — Create a 1/1 white Rabbit creature token."
            )
        ).toBe("unparsed");
    });
    it("a budget head without the repeat sentence is not read", () => {
        expect(
            refused(
                "Choose up to five {P} worth of modes.\n{P} — Draw a card.\n{P}{P} — Create a 1/1 white Rabbit creature token."
            )
        ).toBe("unparsed");
    });
    it('"Its controller draws a card" with no acted-on target is not read', () => {
        expect(refused("Its controller draws a card.")).toBe("unparsed");
    });
    it("an entry counter on a return from any graveyard is not read", () => {
        expect(
            refused(
                "Return target creature card from a graveyard to the battlefield with an indestructible counter on it."
            )
        ).toBe("unparsed");
    });
    it("an entry counter on a bounce is not read", () => {
        expect(
            refused(
                "Return target creature to its owner's hand with an indestructible counter on it."
            )
        ).toBe("unparsed");
    });
    it("a +1/+1 entry counter on a reanimation stays refused", () => {
        expect(
            refused(
                "Return target creature card from your graveyard to the battlefield with a +1/+1 counter on it."
            )
        ).toBe("unparsed");
    });
});
