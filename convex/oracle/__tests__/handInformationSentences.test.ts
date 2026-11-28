// Hand-information sentences: a random reveal from another player's hand and
// the mana value read back off it (CR 701.20a, CR 202.3), the controller's
// own random discard (CR 701.9a), an announced player's option to draw
// (CR 608.2d), and the opponents' hands played revealed (CR 701.18c).
//
// Two layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one card per accepted form.
//  2. REFUSALS — the neighbours each rule must NOT read: another chooser,
//     another characteristic, another audience, another count.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function fixture(name: string) {
    const row = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (row === undefined) throw new Error(`no golden fixture for ${name}`);
    return row;
}

function enchantment(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{2}{W}",
        typeLine: "Enchantment",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("random hand reveal by an announced player (CR 701.20a, CR 202.3)", () => {
    it("Planeswalker's Mirth — the revealed card's mana value is summed in that hand", () => {
        const row = fixture("Planeswalker's Mirth");
        expect(sortKeys(compiled(row.card))).toEqual(sortKeys(row.expected));
    });

    it("refuses another characteristic of the revealed card", () => {
        // The snapshot an acting Op takes records power only for a creature on
        // the battlefield; a revealed hand card has none to read.
        const outcome = compileCard(
            enchantment(
                "Probe",
                "{3}{W}: Target opponent reveals a card at random from their hand. You gain life equal to that card's power."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('refuses "you" as the revealing player — "their hand" agrees with a third person', () => {
        const outcome = compileCard(
            enchantment(
                "Probe",
                "{3}{W}: You reveals a card at random from their hand. You gain life equal to that card's mana value."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("random discard by the controller (CR 701.9a)", () => {
    it("Spellgorger Barbarian — the enters trigger discards one card at random", () => {
        const card = oracleCard({
            oracleId: "9c0fd5ad-fbba-4598-80cf-6540888378cb",
            name: "Spellgorger Barbarian",
            manaCost: "{3}{R}",
            typeLine: "Creature — Human Nightmare Barbarian",
            oracleText:
                "When this creature enters, discard a card at random.\nWhen this creature leaves the battlefield, draw a card.",
            power: "3",
            toughness: "1",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Spellgorger Barbarian",
                types: ["Creature"],
                subtypes: ["Human", "Nightmare", "Barbarian"],
                manaCost: { X: 3, R: 1 },
                power: 3,
                toughness: 1,
                oracleText:
                    "When this creature enters, discard a card at random.\nWhen this creature leaves the battlefield, draw a card.",
                compiledTriggeredAbilities: [
                    {
                        id: "spellgorger-barbarian-trigger",
                        oracleText:
                            "When this creature enters, discard a card at random.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "discardAtRandom",
                                player: "controller",
                                count: 1,
                            },
                        ],
                    },
                    {
                        id: "spellgorger-barbarian-trigger-2",
                        oracleText:
                            "When this creature leaves the battlefield, draw a card.",
                        head: { kind: "left", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            })
        );
    });

    it("Ring of Renewal — the discard follows the colon, so it is the effect (CR 602.1a)", () => {
        const row = fixture("Ring of Renewal");
        expect(sortKeys(compiled(row.card))).toEqual(sortKeys(row.expected));
    });

    it("refuses a multi-card imperative random discard — only the one-card form is printed", () => {
        const outcome = compileCard(
            enchantment("Probe", "{3}: Discard two cards at random.")
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("an announced player's option to draw (CR 608.2d)", () => {
    it("Soldevi Heretic — the target opponent is asked, and the draw is theirs", () => {
        const card = oracleCard({
            oracleId: "eed353a6-757d-47f6-a118-b951ccf95600",
            name: "Soldevi Heretic",
            manaCost: "{2}{U}",
            typeLine: "Creature — Human Cleric",
            oracleText:
                "{W}, {T}: Prevent the next 2 damage that would be dealt to target creature this turn. Target opponent may draw a card.",
            power: "2",
            toughness: "2",
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Soldevi Heretic",
                types: ["Creature"],
                subtypes: ["Human", "Cleric"],
                manaCost: { X: 2, U: 1 },
                power: 2,
                toughness: 2,
                oracleText:
                    "{W}, {T}: Prevent the next 2 damage that would be dealt to target creature this turn. Target opponent may draw a card.",
                activatedAbilities: [
                    {
                        id: "soldevi-heretic-ability",
                        oracleText:
                            "{W}, {T}: Prevent the next 2 damage that would be dealt to target creature this turn. Target opponent may draw a card.",
                        cost: { mana: { W: 1 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "preventDamage",
                                mode: "next-n",
                                to: { target: 0 },
                                amount: 2,
                                duration: { phase: "end-of-turn" },
                            },
                            {
                                op: "mayPay",
                                player: { target: 1 },
                                prompt: "Draw a card?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "draw",
                                        player: { target: 1 },
                                        count: 1,
                                    },
                                ],
                            },
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                        additionalTargetRequirements: [
                            {
                                type: "player",
                                count: 1,
                                controller: "opponent",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("refuses a chooser that is not an announced player", () => {
        const outcome = compileCard(
            enchantment("Probe", "{U}: Each opponent may draw a card.")
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('refuses an "If they do" behind the announced player\'s draw', () => {
        const outcome = compileCard(
            enchantment(
                "Probe",
                "{U}: Target opponent may draw a card. If they do, you draw a card."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("opponents play with their hands revealed (CR 701.18c, CR 402.3)", () => {
    it("Telepathy — the flat revealsHand scope, read live off the battlefield", () => {
        const card = oracleCard({
            oracleId: "d2e647ac-717f-46e6-baa8-6a793e7bdc32",
            name: "Telepathy",
            manaCost: "{U}",
            typeLine: "Enchantment",
            oracleText: "Your opponents play with their hands revealed.",
            power: undefined,
            toughness: undefined,
        });
        expect(sortKeys(compiled(card))).toEqual(
            sortKeys({
                name: "Telepathy",
                types: ["Enchantment"],
                manaCost: { U: 1 },
                oracleText: "Your opponents play with their hands revealed.",
                revealsHand: "opponents",
            })
        );
    });

    it("refuses another audience — every player, or the controller's own hand", () => {
        for (const text of [
            "Players play with their hands revealed.",
            "Play with your hand revealed.",
        ])
            expect(compileCard(enchantment("Probe", text)).state).toBe(
                "unparsed"
            );
    });
});
