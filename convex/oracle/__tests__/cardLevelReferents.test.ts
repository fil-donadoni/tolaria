// Card-level referents (issue #10351): the sentence-to-sentence antecedents
// and recipients the lowering resolves for a whole card — "it" after an
// announced target, a target player as a damage recipient, "your library"
// and "the battlefield" as destinations for a card from your graveyard, the
// source as a fighter, the exiled card a delayed return names, and the cast X
// an enters trigger reads.
//
//  1. GOLDEN — a real corpus card compiled whole equals its Compiled
//     Definition, one per accepted form (the two card-dependent forms — a
//     graveyard card to the library top, the cast-X read — are
//     `GOLDEN_FIXTURES` rows, asserted ready here).
//  2. REFUSALS — the neighbours each rule must not read (fail-closed,
//     ADR 0105 § 2), each pinned to the reason it stays refused under.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";

function definitionOf(card: OracleCard): unknown {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} is unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return sortKeys(outcome.definition);
}

function refusalOf(card: OracleCard): readonly string[] {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps.map((g) => g.reason)
        : [];
}

describe("card-level referents — golden fixtures (issue #10351)", () => {
    it('High Stride: CR 608.2c — "it" in a later sentence names the ONE permanent target announced before it', () => {
        const card: OracleCard = {
            oracleId: "ab0aea13-1dbc-424a-ab7e-cdb303036a56",
            name: "High Stride",
            manaCost: "{G}",
            typeLine: "Instant",
            oracleText:
                "Target creature gets +1/+3 and gains reach until end of turn. Untap it.",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "High Stride",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText:
                    "Target creature gets +1/+3 and gains reach until end of turn. Untap it.",
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: 1,
                        toughness: 3,
                        duration: { phase: "end-of-turn" },
                    },
                    {
                        op: "grantAbility",
                        target: { target: 0 },
                        ability: "reach",
                        duration: { phase: "end-of-turn" },
                    },
                    { op: "tapUntap", action: "untap", target: { target: 0 } },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("Steampath Charger: CR 115.1 + CR 120.1 — damage to a target PLAYER is a `{ player: { target } }` recipient", () => {
        const card: OracleCard = {
            oracleId: "75237b2c-232b-479a-ab3a-e1566c8a9fe7",
            name: "Steampath Charger",
            manaCost: "{1}{R}",
            typeLine: "Creature — Lizard Warlock",
            oracleText:
                "Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nWhen this creature dies, it deals 1 damage to target player.",
            power: "2",
            toughness: "1",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "Steampath Charger",
                types: ["Creature"],
                subtypes: ["Lizard", "Warlock"],
                manaCost: { X: 1, R: 1 },
                power: 2,
                toughness: 1,
                oracleText:
                    "Offspring {2} (You may pay an additional {2} as you cast this spell. If you do, when this creature enters, create a 1/1 token copy of it.)\nWhen this creature dies, it deals 1 damage to target player.",
                compiledTriggeredAbilities: [
                    {
                        id: "offspring-token-copy-offspring",
                        oracleText:
                            "When Steampath Charger enters, if its offspring cost was paid, create a token that's a copy of it, except it's 1/1.",
                        head: { kind: "entered", scope: "self" },
                        condition: {
                            kind: "kicker-paid",
                            kickerId: "offspring",
                        },
                        effects: [
                            {
                                op: "if",
                                predicate: {
                                    left: { additionalCostPaid: "offspring" },
                                    op: "ge",
                                    right: 1,
                                },
                                then: [
                                    {
                                        op: "createTokenCopy",
                                        source: { ref: "$source" },
                                        controller: "controller",
                                        except: {
                                            basePower: 1,
                                            baseToughness: 1,
                                        },
                                    },
                                ],
                            },
                        ],
                        additionalCostTwin: {
                            keyword: "offspring",
                            costId: "offspring",
                        },
                    },
                    {
                        id: "steampath-charger-trigger-2",
                        oracleText:
                            "When this creature dies, it deals 1 damage to target player.",
                        head: { kind: "died", scope: "self" },
                        targetRequirement: { type: "player", count: 1 },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 1,
                                to: { player: { target: 0 } },
                            },
                        ],
                    },
                ],
                kickers: [
                    {
                        id: "offspring",
                        keyword: "offspring",
                        description: "Offspring {2}",
                        mana: { X: 2 },
                    },
                ],
            })
        );
    });

    it('Brash Taunter: CR 701.14a — "This creature fights another target creature": the source is the instructed side; and damage to target opponent', () => {
        const card: OracleCard = {
            oracleId: "3e41648f-c5a9-4b26-b97e-8176fe5e9c85",
            name: "Brash Taunter",
            manaCost: "{4}{R}",
            typeLine: "Creature — Goblin",
            oracleText:
                "Indestructible\nWhenever this creature is dealt damage, it deals that much damage to target opponent.\n{2}{R}, {T}: This creature fights another target creature.",
            power: "1",
            toughness: "1",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "Brash Taunter",
                types: ["Creature"],
                subtypes: ["Goblin"],
                manaCost: { X: 4, R: 1 },
                power: 1,
                toughness: 1,
                oracleText:
                    "Indestructible\nWhenever this creature is dealt damage, it deals that much damage to target opponent.\n{2}{R}, {T}: This creature fights another target creature.",
                staticAbilities: ["indestructible"],
                activatedAbilities: [
                    {
                        id: "brash-taunter-ability",
                        oracleText:
                            "{2}{R}, {T}: This creature fights another target creature.",
                        cost: { mana: { X: 2, R: 1 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "fight",
                                creature: { ref: "$source" },
                                other: { target: 0 },
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            excludeSource: true,
                        },
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "brash-taunter-trigger",
                        oracleText:
                            "Whenever this creature is dealt damage, it deals that much damage to target opponent.",
                        head: { kind: "damage-taken", scope: "self" },
                        targetRequirement: {
                            type: "player",
                            count: 1,
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: { ref: "$event.amount" },
                                to: { player: { target: 0 } },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Pheres-Band Brawler: CR 701.14a + CR 701.14b — "it fights up to one target creature": the head\'s "it" is the source, the other side may go unchosen', () => {
        const card: OracleCard = {
            oracleId: "01499544-6850-49f0-a66e-113df19c4340",
            name: "Pheres-Band Brawler",
            manaCost: "{4}{G}{G}",
            typeLine: "Creature — Centaur Warrior",
            oracleText:
                "When this creature enters, it fights up to one target creature you don't control. (Each deals damage equal to its power to the other.)",
            power: "4",
            toughness: "4",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "Pheres-Band Brawler",
                types: ["Creature"],
                subtypes: ["Centaur", "Warrior"],
                manaCost: { X: 4, G: 2 },
                power: 4,
                toughness: 4,
                oracleText:
                    "When this creature enters, it fights up to one target creature you don't control. (Each deals damage equal to its power to the other.)",
                compiledTriggeredAbilities: [
                    {
                        id: "pheres-band-brawler-trigger",
                        oracleText:
                            "When this creature enters, it fights up to one target creature you don't control.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: { min: 0, max: 1 },
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "fight",
                                creature: { ref: "$source" },
                                other: { target: 0 },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Barkform Harvester: CR 400.3 + CR 404.1 — "on the bottom of your library" is the owner\'s library for a card from your graveyard', () => {
        const card: OracleCard = {
            oracleId: "0339bd11-ad71-4998-9b5d-a32790f0e5e3",
            name: "Barkform Harvester",
            manaCost: "{3}",
            typeLine: "Artifact Creature — Shapeshifter",
            oracleText:
                "Changeling (This card is every creature type.)\nReach\n{2}: Put target card from your graveyard on the bottom of your library.",
            power: "2",
            toughness: "3",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "Barkform Harvester",
                types: ["Artifact", "Creature"],
                subtypes: ["Shapeshifter"],
                manaCost: { X: 3 },
                power: 2,
                toughness: 3,
                oracleText:
                    "Changeling (This card is every creature type.)\nReach\n{2}: Put target card from your graveyard on the bottom of your library.",
                staticAbilities: ["changeling", "reach"],
                activatedAbilities: [
                    {
                        id: "barkform-harvester-ability",
                        oracleText:
                            "{2}: Put target card from your graveyard on the bottom of your library.",
                        cost: { mana: { X: 2 } },
                        useStack: true,
                        effects: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "library",
                            },
                        ],
                        targetRequirement: {
                            type: "card",
                            count: 1,
                            zone: "graveyard",
                            controller: "you",
                        },
                    },
                ],
            })
        );
    });

    it('Skyskipper Duo: CR 603.7a + CR 608.2c — "Return it to the battlefield" names the card the exile made of the sole target, never the head\'s permanent', () => {
        const card: OracleCard = {
            oracleId: "a50db36c-948b-4132-a5e5-84aab1f42612",
            name: "Skyskipper Duo",
            manaCost: "{4}{U}",
            typeLine: "Creature — Bird Frog",
            oracleText:
                "Flying\nWhen this creature enters, exile up to one other target creature you control. Return it to the battlefield under its owner's control at the beginning of the next end step.",
            power: "3",
            toughness: "3",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "Skyskipper Duo",
                types: ["Creature"],
                subtypes: ["Bird", "Frog"],
                manaCost: { X: 4, U: 1 },
                power: 3,
                toughness: 3,
                oracleText:
                    "Flying\nWhen this creature enters, exile up to one other target creature you control. Return it to the battlefield under its owner's control at the beginning of the next end step.",
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "skyskipper-duo-trigger",
                        oracleText:
                            "When this creature enters, exile up to one other target creature you control. Return it to the battlefield under its owner's control at the beginning of the next end step.",
                        head: { kind: "entered", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: { min: 0, max: 1 },
                            excludeSource: true,
                            controller: "you",
                        },
                        effects: [
                            {
                                op: "exile",
                                target: { target: 0 },
                                bind: "$that1",
                            },
                            {
                                op: "delayedTrigger",
                                timing: "next-end-step",
                                oracleText:
                                    "Return that card to the battlefield under its owner's control at the beginning of the next end step.",
                                capture: { $c: { ref: "$that1" } },
                                effects: [
                                    {
                                        op: "moveZone",
                                        target: { ref: "$c" },
                                        from: "exile",
                                        to: "battlefield",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it('Obzedat\'s Aid: CR 110.4 + CR 400.7 — "target permanent card" (every permanent type, an OR) returns to the battlefield', () => {
        const card: OracleCard = {
            oracleId: "f3be91ce-e99b-4a51-a0f7-a000fd9d0e14",
            name: "Obzedat's Aid",
            manaCost: "{3}{W}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Return target permanent card from your graveyard to the battlefield.",
            layout: "normal",
        };
        expect(compileCard(card).state).toBe("ready");
        expect(definitionOf(card)).toEqual(
            sortKeys({
                name: "Obzedat's Aid",
                types: ["Sorcery"],
                manaCost: { X: 3, W: 1, B: 1 },
                oracleText:
                    "Return target permanent card from your graveyard to the battlefield.",
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "battlefield",
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
                    zone: "graveyard",
                    controller: "you",
                },
            })
        );
    });

    for (const name of [
        "Reclaim",
        "Hugs, Grisly Guardian",
        "Gadwick, the Wizened",
        "Ajani's Anguish",
        "Morlun, Devourer of Spiders",
    ])
        it(`${name}: its GOLDEN_FIXTURES row compiles to ready`, () => {
            const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name);
            expect(fixture?.rule).toBe("effect clause");
            expect(compileCard(fixture!.card).state).toBe("ready");
            expect(definitionOf(fixture!.card)).toEqual(
                sortKeys(fixture!.expected)
            );
        });
});

describe("card-level referents — refused neighbours (fail-closed)", () => {
    it('Miraculous Recovery: "it" after the target moved to the battlefield names a NEW object (CR 400.7)', () => {
        const card: OracleCard = {
            oracleId: "cea73a4b-e10a-4517-a92b-24a08321009f",
            name: "Miraculous Recovery",
            manaCost: "{4}{W}",
            typeLine: "Instant",
            oracleText:
                "Return target creature card from your graveyard to the battlefield. Put a +1/+1 counter on it.",
            layout: "normal",
        };
        expect(refusalOf(card)).toContain(
            '"it" follows an announced target, which is the nearer antecedent (CR 608.2h)'
        );
    });

    it('Sequence Engine: "it" after a token was created names the token, the nearer antecedent', () => {
        const card: OracleCard = {
            oracleId: "87c1bd51-6a85-4a14-af7b-a5b02ab69d73",
            name: "Sequence Engine",
            manaCost: "{2}{G}",
            typeLine: "Artifact",
            oracleText:
                "{X}, {T}: Exile target creature card with mana value X from a graveyard. Create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on it. Activate only as a sorcery.",
            layout: "normal",
        };
        expect(refusalOf(card)).toContain(
            '"it" follows an announced target, which is the nearer antecedent (CR 608.2h)'
        );
    });

    it("Reinforcements: several cards put on top at once need their owner's order (CR 401.4)", () => {
        const card: OracleCard = {
            oracleId: "ff27ff96-afd2-45df-b799-3046179e27c6",
            name: "Reinforcements",
            manaCost: "{W}",
            typeLine: "Instant",
            oracleText:
                "Put up to three target creature cards from your graveyard on top of your library.",
            layout: "normal",
        };
        expect(refusalOf(card)).toContain(
            '"library" is not a zone destination in grammar v0'
        );
    });

    it('Harnessed Snubhorn: "artifact or enchantment card" shares its encoding with "artifact creature card"', () => {
        const card: OracleCard = {
            oracleId: "e1dd9dca-cb5f-46b4-b16d-a61ae651d653",
            name: "Harnessed Snubhorn",
            manaCost: "{3}{W}",
            typeLine: "Creature — Dinosaur",
            oracleText:
                "Vigilance\nWhenever this creature deals combat damage to a player, return target artifact or enchantment card from your graveyard to the battlefield.",
            power: "2",
            toughness: "5",
            layout: "normal",
        };
        expect(refusalOf(card)).toContain(
            '"battlefield" is not a zone destination in grammar v0'
        );
    });

    it('The Guardian of Forever: "that card" names a card a COST sacrificed, not an announced target', () => {
        const card: OracleCard = {
            oracleId: "5144361a-0308-49b8-96e6-c948d4beae09",
            name: "The Guardian of Forever",
            manaCost: "{3}",
            typeLine: "Legendary Artifact Creature — Construct",
            oracleText:
                "Defender\n{4}, Sacrifice another nontoken creature: Return that card to the battlefield under its owner's control at the beginning of the next end step.",
            power: "0",
            toughness: "6",
            layout: "normal",
        };
        expect(refusalOf(card)).toContain(
            '"it" names no single object announced before it (CR 608.2h)'
        );
    });
});
