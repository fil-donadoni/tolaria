// "You may discard a card. If you do, <effect>." — the optional hand-discard
// cost gating a graveyard-functioning triggered effect (CR 608.2c, CR 701.9a,
// CR 113.6b; issue #5295). Golden: Gigapede. Refusals pin fail-closed.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const TRIGGER =
    "At the beginning of your upkeep, if this card is in your graveyard, you may discard a card. If you do, return this card to your hand.";
const gigapede = (trigger: string) =>
    oracleCard({
        oracleId: "9be31785-2975-424f-aada-25ee2a0bf6d8",
        name: "Gigapede",
        manaCost: "{3}{G}{G}",
        typeLine: "Creature — Insect",
        oracleText: `Shroud\n${trigger}`,
        power: "6",
        toughness: "1",
    });

describe("optional hand discard then (issue #5295)", () => {
    it("compiles Gigapede to a discard hand-cost mayPay gating the return", () => {
        const out = compileCard(gigapede(TRIGGER));
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Gigapede",
                types: ["Creature"],
                subtypes: ["Insect"],
                manaCost: { X: 3, G: 2 },
                power: 6,
                toughness: 1,
                oracleText: `Shroud\n${TRIGGER}`,
                staticAbilities: ["shroud"],
                compiledTriggeredAbilities: [
                    {
                        id: "gigapede-trigger",
                        oracleText: TRIGGER,
                        head: {
                            kind: "phase",
                            phase: "UPKEEP",
                            scope: "your",
                        },
                        zone: "graveyard",
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: {
                                    hand: {
                                        action: "discard",
                                        requirements: [
                                            { filter: {}, count: 1 },
                                        ],
                                    },
                                },
                                prompt: "Discard a card?",
                                bind: "$paid1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$paid1" },
                                then: [
                                    {
                                        op: "moveZone",
                                        target: { ref: "$source" },
                                        to: "hand",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("also reads the same frame on a battlefield trigger: Keldon Raider", () => {
        const out = compileCard(
            oracleCard({
                oracleId: "00000000-0000-0000-0000-0000000052ff",
                name: "Keldon Raider",
                manaCost: "{2}{R}",
                typeLine: "Creature — Human Warrior",
                oracleText:
                    "When this creature enters, you may discard a card. If you do, draw a card.",
                power: "4",
                toughness: "3",
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        const effects = JSON.stringify(
            out.definition.compiledTriggeredAbilities?.[0]?.effects
        );
        expect(effects).toContain('"action":"discard"');
        expect(effects).toContain('"op":"draw"');
    });

    it("refuses a discard with no 'If you do' behind it", () => {
        const out = compileCard(
            gigapede(
                "At the beginning of your upkeep, if this card is in your graveyard, you may discard a card."
            )
        );
        expect(out.state).toBe("unparsed");
    });

    it("refuses a discard of a different card shape", () => {
        const out = compileCard(
            gigapede(
                "At the beginning of your upkeep, if this card is in your graveyard, you may discard two cards. If you do, return this card to your hand."
            )
        );
        expect(out.state).toBe("unparsed");
    });

    it("refuses 'return this card to your hand' off the graveyard zone", () => {
        const out = compileCard(
            gigapede(
                "At the beginning of your upkeep, you may discard a card. If you do, return this card to your hand."
            )
        );
        expect(out.state).not.toBe("ready");
    });
});
