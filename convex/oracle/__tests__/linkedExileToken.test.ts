// The linked exile read back as last-known information (CR 607.2a,
// CR 608.2h): "the exiled card's owner creates an X/X … creature token, where
// X is the mana value of the exiled card." The card pass binds the card's one
// `exile` instruction and hands the snapshot to the source (`captureBinding`);
// the leaves trigger restores it (`recallCapturedBinding`).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const ENTERS =
    "When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.";
const TOKEN =
    "When this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.";
const SKYCLAVE_TEXT = `${ENTERS}\n${TOKEN}`;

function skyclave(oracleText: string) {
    return compileCard(
        oracleCard({
            oracleId: "d90af00a-d322-4265-9954-7b1e80702e18",
            name: "Skyclave Apparition",
            manaCost: "{1}{W}{W}",
            typeLine: "Creature — Kor Spirit",
            oracleText,
            power: "2",
            toughness: "2",
        })
    );
}

describe("linked exile token (CR 607.2a, CR 608.2h)", () => {
    it("golden: Skyclave Apparition captures its exile and its owner gets the X/X", () => {
        const outcome = skyclave(SKYCLAVE_TEXT);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Skyclave Apparition",
                types: ["Creature"],
                subtypes: ["Kor", "Spirit"],
                manaCost: { X: 1, W: 2 },
                power: 2,
                toughness: 2,
                oracleText: SKYCLAVE_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "skyclave-apparition-trigger",
                        oracleText: ENTERS,
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
                            count: { min: 0, max: 1 },
                            excludeTypes: ["Land"],
                            mvFilter: { max: 4 },
                            isToken: false,
                            controller: "opponent",
                        },
                        effects: [
                            {
                                op: "exile",
                                target: { target: 0 },
                                bind: "$exiled",
                            },
                            { op: "captureBinding", ref: "$exiled" },
                        ],
                    },
                    {
                        id: "skyclave-apparition-trigger-2",
                        oracleText: TOKEN,
                        head: { kind: "left", scope: "self" },
                        effects: [
                            { op: "recallCapturedBinding", bind: "$exiled" },
                            {
                                op: "createToken",
                                token: {
                                    name: "Illusion",
                                    types: ["Creature"],
                                    subtypes: ["Illusion"],
                                    power: { ref: "$exiled.manaValue" },
                                    toughness: { ref: "$exiled.manaValue" },
                                    colors: ["U"],
                                },
                                controller: { ref: "$exiled.owner" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("refuses the token on a card that prints no exile", () => {
        expect(skyclave(TOKEN).state).toBe("unparsed");
    });

    it("refuses the token when a second exile instruction leaves the link unread", () => {
        const second = "{2}, {T}: Exile target creature.";
        expect(skyclave(`${SKYCLAVE_TEXT}\n${second}`).state).toBe("unparsed");
    });

    it("refuses the token beside a zone-move exile on another ability", () => {
        const graveyard = "{2}{B}: Exile target card from a graveyard.";
        expect(skyclave(`${SKYCLAVE_TEXT}\n${graveyard}`).state).toBe(
            "unparsed"
        );
    });

    it("refuses an exile of more than one target", () => {
        const two = ENTERS.replace("up to one target", "up to two target")
            .replace("permanent", "permanents")
            .replace(
                "you don't control with mana value 4 or less",
                "you don't control"
            );
        expect(skyclave(`${two}\n${TOKEN}`).state).toBe("unparsed");
    });

    it("refuses a hand exile (a moveZone, not the battlefield exile)", () => {
        const hand =
            "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.";
        expect(skyclave(`${hand}\n${TOKEN}`).state).toBe("unparsed");
    });

    it("refuses an X read off another characteristic", () => {
        const power = TOKEN.replace(
            "the mana value of the exiled card",
            "the power of the exiled card"
        );
        expect(skyclave(`${ENTERS}\n${power}`).state).toBe("unparsed");
    });

    it("refuses the token behind a head that names no linked exile", () => {
        const upkeep = TOKEN.replace(
            "When this creature leaves the battlefield",
            "At the beginning of your upkeep"
        );
        expect(skyclave(`${ENTERS}\n${upkeep}`).state).toBe("unparsed");
    });

    it("refuses an artifact token", () => {
        const artifact = TOKEN.replace(
            "blue Illusion creature",
            "colorless Construct artifact creature"
        );
        expect(skyclave(`${ENTERS}\n${artifact}`).state).toBe("unparsed");
    });
});
