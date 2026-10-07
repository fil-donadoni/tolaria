// Linked exile and return — issue #4526, a Grammar Cluster of eight Op-census
// gaps (ADR 0105 § 7.3). Five land here:
//
//  - `exileSelf` — "Exile {self}." on a spell (CR 608.2n);
//  - `exileOnDeath` — "If that creature would die this turn, exile it
//    instead." after ONE announced creature target (CR 614.1a, CR 608.2h);
//  - `armGraveyardRedirect` (with `grantGraveyardPlay`, its only printed
//    companion) — Yawgmoth's Will's two sentences (CR 601.3, CR 614.1a);
//  - `exileWithAttachments` + `returnExiledForSource` — "exile … until this
//    leaves the battlefield", whose return the card pass synthesizes (CR
//    610.3, `linkExile.ts`), on the new "when this leaves the battlefield"
//    head (CR 603.6c). The PRINTED pair (Journey to Nowhere, CR 607.2a) is
//    refused: it has no duration, and the bundle Op always applies CR 610.3b.
//
// Two layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form.
//  2. REFUSALS — the neighbours these rules do not read stay `unparsed`
//     (fail-closed, ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectUnparsed(oracleText: string, typeLine = "Instant") {
    const outcome = compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{U}",
            typeLine,
            oracleText,
            ...(typeLine.startsWith("Creature")
                ? { power: "1", toughness: "1" }
                : { power: undefined, toughness: undefined }),
        })
    );
    expect(outcome.state).toBe("unparsed");
}

describe("linked exile and return — golden fixtures", () => {
    it("CR 608.2n — the resolving spell exiles itself: Flood of Recollection", () => {
        const card = oracleCard({
            name: "Flood of Recollection",
            manaCost: "{U}{U}",
            typeLine: "Sorcery",
            oracleText:
                "Return target instant or sorcery card from your graveyard to your hand. Exile Flood of Recollection.",
            oracleId: "02393093-e970-40a0-848b-9cd758450cbb",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Flood of Recollection",
                types: ["Sorcery"],
                manaCost: { U: 2 },
                oracleText:
                    "Return target instant or sorcery card from your graveyard to your hand. Exile Flood of Recollection.",
                effects: [
                    { op: "moveZone", target: { target: 0 }, to: "hand" },
                    { op: "exileSelf" },
                ],
                targetRequirement: {
                    type: ["Instant", "Sorcery"],
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
            })
        );
    });

    it("CR 614.1a — that creature is exiled if it would die this turn: Puncturing Blow", () => {
        const card = oracleCard({
            name: "Puncturing Blow",
            manaCost: "{2}{R}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Puncturing Blow deals 5 damage to target creature. If that creature would die this turn, exile it instead.",
            oracleId: "1128d2ab-0b6e-4912-8735-15521bc314e6",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Puncturing Blow",
                types: ["Sorcery"],
                manaCost: { X: 2, R: 2 },
                oracleText:
                    "Puncturing Blow deals 5 damage to target creature. If that creature would die this turn, exile it instead.",
                effects: [
                    { op: "dealDamage", amount: 5, to: { target: 0 } },
                    { op: "exileOnDeath", target: { target: 0 } },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("CR 601.3 + CR 614.1a — play from your graveyard, exile what would go there: Yawgmoth's Will", () => {
        const card = oracleCard({
            name: "Yawgmoth's Will",
            manaCost: "{2}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Until end of turn, you may play lands and cast spells from your graveyard.\nIf a card would be put into your graveyard from anywhere this turn, exile that card instead.",
            oracleId: "322f0459-f394-44f0-977b-55fd0cbe0712",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Yawgmoth's Will",
                types: ["Sorcery"],
                manaCost: { X: 2, B: 1 },
                oracleText:
                    "Until end of turn, you may play lands and cast spells from your graveyard.\nIf a card would be put into your graveyard from anywhere this turn, exile that card instead.",
                effects: [
                    { op: "grantGraveyardPlay", player: "controller" },
                    { op: "armGraveyardRedirect", player: "controller" },
                ],
            })
        );
    });

    it("CR 603.6c — a leaves-the-battlefield head over any body: Thragtusk", () => {
        const card = oracleCard({
            name: "Thragtusk",
            manaCost: "{4}{G}",
            typeLine: "Creature — Beast",
            oracleText:
                "When this creature enters, you gain 5 life.\nWhen this creature leaves the battlefield, create a 3/3 green Beast creature token.",
            power: "5",
            toughness: "3",
            oracleId: "0dd0e91a-d16b-4718-8d11-1a3fcf8e0753",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Thragtusk",
                types: ["Creature"],
                subtypes: ["Beast"],
                manaCost: { X: 4, G: 1 },
                power: 5,
                toughness: 3,
                oracleText:
                    "When this creature enters, you gain 5 life.\nWhen this creature leaves the battlefield, create a 3/3 green Beast creature token.",
                compiledTriggeredAbilities: [
                    {
                        id: "thragtusk-trigger",
                        oracleText:
                            "When this creature enters, you gain 5 life.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "gainLife", player: "controller", amount: 5 },
                        ],
                    },
                    {
                        id: "thragtusk-trigger-2",
                        oracleText:
                            "When this creature leaves the battlefield, create a 3/3 green Beast creature token.",
                        head: { kind: "left", scope: "self" },
                        effects: [
                            {
                                op: "createToken",
                                token: {
                                    name: "Beast",
                                    types: ["Creature"],
                                    subtypes: ["Beast"],
                                    power: 3,
                                    toughness: 3,
                                    colors: ["G"],
                                },
                                controller: "controller",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("CR 603.6c — a targeted leaves-the-battlefield trigger: Phyrexian Bloodstock", () => {
        const card = oracleCard({
            name: "Phyrexian Bloodstock",
            manaCost: "{4}{B}",
            typeLine: "Creature — Phyrexian Zombie",
            oracleText:
                "When this creature leaves the battlefield, destroy target white creature. It can't be regenerated.",
            power: "3",
            toughness: "3",
            oracleId: "dfeaec62-ca77-46dc-8eae-f627a5e1c02a",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Phyrexian Bloodstock",
                types: ["Creature"],
                subtypes: ["Phyrexian", "Zombie"],
                manaCost: { X: 4, B: 1 },
                power: 3,
                toughness: 3,
                oracleText:
                    "When this creature leaves the battlefield, destroy target white creature. It can't be regenerated.",
                compiledTriggeredAbilities: [
                    {
                        id: "phyrexian-bloodstock-trigger",
                        oracleText:
                            "When this creature leaves the battlefield, destroy target white creature. It can't be regenerated.",
                        head: { kind: "left", scope: "self" },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            colorFilter: "W",
                        },
                        effects: [
                            {
                                op: "destroy",
                                target: { target: 0 },
                                cantBeRegenerated: true,
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("CR 610.3 — exile until this permanent leaves, the return synthesized: Banishing Light", () => {
        const card = oracleCard({
            name: "Banishing Light",
            manaCost: "{2}{W}",
            typeLine: "Enchantment",
            oracleText:
                "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
            oracleId: "f28b21a6-f7ce-437a-8c5b-0423cb55cefb",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Banishing Light",
                types: ["Enchantment"],
                manaCost: { X: 2, W: 1 },
                oracleText:
                    "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
                compiledTriggeredAbilities: [
                    {
                        id: "banishing-light-trigger",
                        oracleText:
                            "When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.",
                        head: { kind: "entered", scope: "self" },
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
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "exileWithAttachments",
                                target: { target: 0 },
                            },
                        ],
                    },
                    {
                        id: "banishing-light-trigger-2",
                        oracleText:
                            "When Banishing Light leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
                        head: { kind: "left", scope: "self" },
                        condition: { kind: "holds-exile-bundle" },
                        effects: [{ op: "returnExiledForSource" }],
                    },
                ],
            })
        );
    });
});

describe("linked exile and return — refusals", () => {
    it("exiling this card from a graveyard is not the spell exiling itself", () => {
        expectUnparsed(
            "When this creature dies, draw a card. Exile this card.",
            "Creature — Giant"
        );
    });

    it("a permanent's ability exiling the permanent is not exileSelf", () => {
        expectUnparsed("{T}: Draw a card. Exile Probe.", "Artifact");
    });

    it('"that creature or planeswalker" — the Op arms creatures only', () => {
        expectUnparsed(
            "Probe deals 3 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead."
        );
    });

    it('"a creature dealt damage this way" names no one object', () => {
        expectUnparsed(
            "Probe deals 3 damage to target creature. If a creature dealt damage this way would die this turn, exile it instead."
        );
    });

    it('"that creature" behind two announced creatures names neither', () => {
        expectUnparsed(
            "Target creature gets -2/-2 until end of turn. Target creature gets +1/+1 until end of turn. If that creature would die this turn, exile it instead."
        );
    });

    it('"that creature" behind "any target" may name a player', () => {
        expectUnparsed(
            "Probe deals 2 damage to any target. If that creature would die this turn, exile it instead."
        );
    });

    it("an opponent's graveyard is not Yawgmoth's Will's redirect", () => {
        expectUnparsed(
            "If a card would be put into an opponent's graveyard from anywhere this turn, exile that card instead.",
            "Sorcery"
        );
    });

    it("a graveyard permission for one action only is a neighbour", () => {
        expectUnparsed(
            "Until end of turn, you may cast spells from your graveyard.",
            "Sorcery"
        );
    });

    it("a return with no exile on the card names nothing (CR 607.2a)", () => {
        expectUnparsed(
            "When this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            "Enchantment"
        );
    });

    it("the printed pair is CR 607.2a with no duration, which no Op encodes: Journey to Nowhere", () => {
        // `exileWithAttachments` applies CR 610.3b: killed in response, the
        // source would exile nothing, where the printed ETB exiles for good.
        expectUnparsed(
            "When this enchantment enters, exile target creature.\nWhen this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            "Enchantment"
        );
    });

    it('"the exiled card" behind a head other than the departure is a neighbour', () => {
        expectUnparsed(
            "When this enchantment enters, exile target creature.\nAt the beginning of your upkeep, return the exiled card to the battlefield under its owner's control.",
            "Enchantment"
        );
    });

    it("returning the exiled card to its owner's hand is a neighbour", () => {
        expectUnparsed(
            "When this enchantment enters, exile target creature.\nWhen this enchantment leaves the battlefield, return the exiled card to its owner's hand.",
            "Enchantment"
        );
    });

    it("an until-exile beside a printed return names two returns", () => {
        expectUnparsed(
            "When this enchantment enters, exile target creature until this enchantment leaves the battlefield.\nWhen this enchantment leaves the battlefield, return the exiled card to the battlefield under its owner's control.",
            "Enchantment"
        );
    });

    it("a spell has no permanent to leave the battlefield (CR 610.3)", () => {
        expectUnparsed(
            "Exile target creature until Probe leaves the battlefield."
        );
    });

    it("until another permanent leaves is a neighbour", () => {
        expectUnparsed(
            "When this enchantment enters, exile target creature until enchanted creature leaves the battlefield.",
            "Enchantment"
        );
    });

    it("exiling a card from a graveyard until this leaves is a neighbour", () => {
        expectUnparsed(
            "When this creature enters, exile target creature card from a graveyard until this creature leaves the battlefield.",
            "Creature — Human"
        );
    });
});
