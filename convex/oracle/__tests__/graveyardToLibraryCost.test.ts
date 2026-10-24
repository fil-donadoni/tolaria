// "Put N cards from your graveyard on the bottom of your library" activation
// cost (CR 401.4, 118.3) and the "Activate only once each turn and only if …"
// restriction pair it ships with (CR 602.5b, 602.1b).
//
// 1. GOLDEN — the real corpus row (Battlefield Scrounger) compiled whole.
// 2. REFUSALS — neighbours the rules must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const SCROUNGER_TEXT =
    "Threshold — Put three cards from your graveyard on the bottom of your library: This creature gets +3/+3 until end of turn. Activate only once each turn and only if there are seven or more cards in your graveyard.";

function creature(oracleText: string) {
    return oracleCard({
        name: "Battlefield Scrounger",
        manaCost: "{3}{G}{G}",
        typeLine: "Creature — Centaur",
        oracleText,
        power: "3",
        toughness: "3",
    });
}

describe("Put cards from graveyard on the library bottom — golden (CR 401.4, 118.3)", () => {
    it("Battlefield Scrounger: exileFromGraveyard leg with a library-bottom destination, once per turn, threshold gate", () => {
        const outcome = compileCard(creature(SCROUNGER_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Battlefield Scrounger",
            types: ["Creature"],
            subtypes: ["Centaur"],
            manaCost: { X: 3, G: 2 },
            power: 3,
            toughness: 3,
            oracleText: SCROUNGER_TEXT,
            activatedAbilities: [
                {
                    id: "battlefield-scrounger-ability",
                    oracleText: SCROUNGER_TEXT,
                    cost: {
                        exileFromGraveyard: {
                            count: 3,
                            owner: "you",
                            destination: "library-bottom",
                        },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$source" },
                            power: 3,
                            toughness: 3,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    oncePerTurn: true,
                    activationCondition: {
                        left: {
                            count: {
                                zone: "graveyard",
                                controller: "controller",
                            },
                        },
                        op: "ge",
                        right: 7,
                    },
                },
            ],
        });
    });
});

describe("Put cards from graveyard on the library bottom — refusals", () => {
    const compiles = (text: string) => compileCard(creature(text)).state;

    it("refuses another player's graveyard", () => {
        expect(
            compiles(
                "Put three cards from target player's graveyard on the bottom of your library: This creature gets +3/+3 until end of turn."
            )
        ).toBe("unparsed");
    });

    it("refuses the top of the library", () => {
        expect(
            compiles(
                "Put three cards from your graveyard on top of your library: This creature gets +3/+3 until end of turn."
            )
        ).toBe("unparsed");
    });

    it("refuses a non-count word", () => {
        expect(
            compiles(
                "Put some cards from your graveyard on the bottom of your library: This creature gets +3/+3 until end of turn."
            )
        ).toBe("unparsed");
    });

    it("is no mana ability: CR 605.1a refuses a cost that moves a card to a library", () => {
        expect(
            compiles(
                "Put a card from your graveyard on the bottom of your library: Add {G}."
            )
        ).toBe("unparsed");
    });

    it("refuses a restriction pair whose second half is unreadable", () => {
        expect(
            compiles(
                "Put three cards from your graveyard on the bottom of your library: This creature gets +3/+3 until end of turn. Activate only once each turn and only if you control a Forest."
            )
        ).toBe("unparsed");
    });

    it("refuses a repeated restriction kind", () => {
        expect(
            compiles(
                "Put three cards from your graveyard on the bottom of your library: This creature gets +3/+3 until end of turn. Activate only once each turn and only once each turn."
            )
        ).toBe("unparsed");
    });
});
