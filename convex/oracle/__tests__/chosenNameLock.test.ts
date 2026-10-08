// "As this creature enters, choose a nonland card name. Spells with the chosen
// name can't be cast." (CR 614.12a / 201.4a / 601.3a, issue #4550).
//
//  1. GOLDEN — Meddling Mage compiled whole.
//  2. REFUSALS — neighbours with no engine surface or another meaning.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const MEDDLING_MAGE = oracleCard({
    name: "Meddling Mage",
    manaCost: "{W}{U}",
    typeLine: "Creature — Human Wizard",
    oracleText:
        "As this creature enters, choose a nonland card name.\nSpells with the chosen name can't be cast.",
    power: "2",
    toughness: "2",
});

function refused(text: string) {
    return compileCard(
        oracleCard({
            name: "Probe Mage",
            manaCost: "{W}{U}",
            typeLine: "Creature — Human Wizard",
            oracleText: text,
            power: "2",
            toughness: "2",
        })
    );
}

describe("chosen-name cast lock — golden (CR 614.12a, 601.3a)", () => {
    it("Meddling Mage compiles to the as-enters name choice + cast lock", () => {
        const outcome = compileCard(MEDDLING_MAGE);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Meddling Mage",
                manaCost: { W: 1, U: 1 },
                types: ["Creature"],
                subtypes: ["Human", "Wizard"],
                power: 2,
                toughness: 2,
                oracleText: MEDDLING_MAGE.oracle_text,
                entersWith: {
                    asEnters: [
                        { kind: "name", filter: { excludeType: "Land" } },
                    ],
                },
                compiledStaticEffects: [
                    {
                        kind: "cast-restriction",
                        id: "meddling-mage-name-lock",
                        oracleText:
                            "Spells with the chosen name can't be cast.",
                    },
                ],
            })
        );
    });
});

describe("chosen-name cast lock — refusals (fail-closed)", () => {
    it("a card name that admits lands is another form", () => {
        expect(
            refused("As this creature enters, choose a card name.").state
        ).toBe("unparsed");
    });
    it("the lock without the choice reads nothing", () => {
        expect(
            refused("Spells with the chosen name can't be cast.").state
        ).toBe("unparsed");
    });
    it("the activated-ability lock is a different clause", () => {
        expect(
            refused(
                "As this creature enters, choose a nonland card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities."
            ).state
        ).toBe("unparsed");
    });
});
