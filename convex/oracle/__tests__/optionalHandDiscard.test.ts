// "You may discard a card. If you do, <effect>." — the optional hand-discard
// cost gating a graveyard-functioning triggered effect (CR 608.2c, CR 701.9a,
// CR 113.6b), and the capitalised spelling a spell's or a loyalty ability's
// full stop introduces. Goldens: Gigapede, then one real card per spell form.
// Refusals pin fail-closed.
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

/** The form's lowering, whatever the sentences around it. */
const discardToDraw = (count: number) => [
    {
        op: "mayPay",
        player: "controller",
        cost: {
            hand: {
                action: "discard",
                requirements: [{ filter: {}, count: 1 }],
            },
        },
        prompt: "Discard a card?",
        bind: "$paid1",
    },
    {
        op: "if",
        predicate: { binding: "$paid1" },
        then: [{ op: "draw", player: "controller", count }],
    },
];

describe("optional hand discard at the spell site (issue #7222)", () => {
    it("is the whole spell: Abandon Attachments", () => {
        const oracleText = "You may discard a card. If you do, draw two cards.";
        const out = compileCard(
            oracleCard({
                oracleId: "82333385-631f-4abf-b159-bb367f1c6fd9",
                name: "Abandon Attachments",
                manaCost: "{1}{U/R}",
                typeLine: "Instant — Lesson",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Abandon Attachments",
                types: ["Instant"],
                subtypes: ["Lesson"],
                manaCost: { X: 1, hybrid: [["U", "R"]] },
                oracleText,
                effects: discardToDraw(2),
            })
        );
    });

    it("follows an effect sentence on its line: Tweeze", () => {
        const oracleText =
            "Tweeze deals 3 damage to any target. You may discard a card. If you do, draw a card.";
        const out = compileCard(
            oracleCard({
                oracleId: "9a294cbd-df18-4ee0-acaa-e31390a7f508",
                name: "Tweeze",
                manaCost: "{2}{R}",
                typeLine: "Instant",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Tweeze",
                types: ["Instant"],
                manaCost: { X: 2, R: 1 },
                oracleText,
                effects: [
                    { op: "dealDamage", amount: 3, to: { target: 0 } },
                    ...discardToDraw(1),
                ],
                targetRequirement: { type: "any", count: 1 },
            })
        );
    });

    it("is a line of its own after the effect's: Incinerating Blast", () => {
        const oracleText =
            "Incinerating Blast deals 6 damage to target creature.\nYou may discard a card. If you do, draw a card.";
        const out = compileCard(
            oracleCard({
                oracleId: "49f0da4a-e046-4220-b90e-e105a5f2ef00",
                name: "Incinerating Blast",
                manaCost: "{4}{R}",
                typeLine: "Sorcery",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Incinerating Blast",
                types: ["Sorcery"],
                manaCost: { X: 4, R: 1 },
                oracleText,
                effects: [
                    { op: "dealDamage", amount: 6, to: { target: 0 } },
                    ...discardToDraw(1),
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("is a prepare inset's spell: Pompous Battlemage // Improvised Act", () => {
        const creatureText =
            "Prowess\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)";
        const spellText = "You may discard a card. If you do, draw a card.";
        const out = compileCard(
            oracleCard({
                oracleId: "33e3793c-098f-4897-88f3-9f9ce9081e0f",
                name: "Pompous Battlemage // Improvised Act",
                manaCost: "{R} // {R}",
                typeLine: "Creature — Goblin Sorcerer // Sorcery",
                layout: "prepare",
                power: "1",
                toughness: "1",
                faces: [
                    {
                        name: "Pompous Battlemage",
                        manaCost: "{R}",
                        typeLine: "Creature — Goblin Sorcerer",
                        oracleText: creatureText,
                        power: "1",
                        toughness: "1",
                    },
                    {
                        name: "Improvised Act",
                        manaCost: "{R}",
                        typeLine: "Sorcery",
                        oracleText: spellText,
                    },
                ],
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(sortKeys(out.definition)).toEqual(
            sortKeys({
                name: "Pompous Battlemage",
                types: ["Creature"],
                subtypes: ["Goblin", "Sorcerer"],
                manaCost: { R: 1 },
                power: 1,
                toughness: 1,
                oracleText: creatureText,
                staticAbilities: ["prowess"],
                entersPrepared: true,
                insetSpell: {
                    kind: "prepare",
                    name: "Improvised Act",
                    manaCost: { R: 1 },
                    types: ["Sorcery"],
                    oracleText: spellText,
                    effects: discardToDraw(1),
                },
            })
        );
    });

    it("is an adventure inset's spell, its reminder read: Merchant of the Vale // Haggle", () => {
        const spellText =
            "You may discard a card. If you do, draw a card. (Then exile this card. You may cast the creature later from exile.)";
        const out = compileCard(
            oracleCard({
                oracleId: "f88a096e-7497-4297-ab65-f18769b1cc47",
                name: "Merchant of the Vale // Haggle",
                manaCost: "{2}{R} // {R}",
                typeLine: "Creature — Human Peasant // Instant — Adventure",
                layout: "adventure",
                power: "2",
                toughness: "3",
                faces: [
                    {
                        name: "Merchant of the Vale",
                        manaCost: "{2}{R}",
                        typeLine: "Creature — Human Peasant",
                        oracleText: "{2}{R}, Discard a card: Draw a card.",
                        power: "2",
                        toughness: "3",
                    },
                    {
                        name: "Haggle",
                        manaCost: "{R}",
                        typeLine: "Instant — Adventure",
                        oracleText: spellText,
                    },
                ],
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(out.definition.insetSpell).toEqual({
            kind: "adventure",
            name: "Haggle",
            manaCost: { R: 1 },
            types: ["Instant"],
            subtypes: ["Adventure"],
            oracleText: spellText,
            effects: discardToDraw(1),
        });
    });

    const sorcery = (oracleText: string) =>
        oracleCard({
            name: "Neighbour",
            manaCost: "{1}{R}",
            typeLine: "Sorcery",
            oracleText,
            power: undefined,
            toughness: undefined,
        });

    it.each([
        ["no 'If you do' behind it", "You may discard a card."],
        [
            "a last sentence that gates nothing behind an effect",
            "Draw a card. You may discard a card.",
        ],
        ["a plain sentence behind it", "You may discard a card. Draw a card."],
        [
            "a reflexive 'When you do' behind it",
            "You may discard a card. When you do, draw a card.",
        ],
        [
            "a different number of cards",
            "You may discard two cards. If you do, draw a card.",
        ],
        [
            "a random discard",
            "You may discard a card at random. If you do, draw a card.",
        ],
        [
            "a rider on the discarded card",
            "You may discard a card. If you do, draw a card. If a creature card was discarded this way, draw two cards instead.",
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});

describe("optional hand discard at the loyalty site (issue #7222)", () => {
    it("reads the line Sarkhan, Fireblood and Nahiri, the Harbinger print", () => {
        const out = compileCard(
            oracleCard({
                name: "Loyalty Fixture",
                manaCost: "{1}{R}{R}",
                typeLine: "Legendary Planeswalker — Sarkhan",
                oracleText:
                    "+1: You may discard a card. If you do, draw a card.",
                power: undefined,
                toughness: undefined,
                loyalty: "2",
            })
        );
        expect(out.state).toBe("ready");
        if (out.state !== "ready") return;
        expect(out.definition.activatedAbilities?.[0]?.effects).toEqual(
            discardToDraw(1)
        );
    });
});
