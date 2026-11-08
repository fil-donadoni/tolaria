// "Activated abilities of sources with the chosen name can't be activated[
// unless they're mana abilities]." (CR 602.5 / 113.7 / 605.1a, issue #8585),
// read back from an as-enters card-name choice (CR 614.12a / 201.4).
//
//  1. GOLDEN — one real card per accepted form, compiled whole: Pithing Needle
//     (the mana-ability exemption + "choose a card name", every name legal)
//     and Phyrexian Revoker (no exemption + "choose a nonland card name").
//  2. REFUSALS — neighbours with another meaning or no engine surface.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const PITHING_NEEDLE = oracleCard({
    name: "Pithing Needle",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText:
        "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.",
    power: undefined,
    toughness: undefined,
});

const PHYREXIAN_REVOKER = oracleCard({
    name: "Phyrexian Revoker",
    manaCost: "{2}",
    typeLine: "Artifact Creature — Phyrexian Horror",
    oracleText:
        "As this creature enters, choose a nonland card name.\nActivated abilities of sources with the chosen name can't be activated.",
    power: "2",
    toughness: "1",
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

function refused(text: string) {
    return compileCard(
        oracleCard({
            name: "Probe Needle",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText: text,
            power: undefined,
            toughness: undefined,
        })
    ).state;
}

describe("chosen-name activation lock — golden (CR 602.5, 605.1a, 614.12a)", () => {
    it("Pithing Needle: any card name + a lock exempting mana abilities", () => {
        expect(sortKeys(compiled(PITHING_NEEDLE))).toEqual(
            sortKeys({
                name: "Pithing Needle",
                manaCost: { X: 1 },
                types: ["Artifact"],
                oracleText: PITHING_NEEDLE.oracleText,
                entersWith: { asEnters: [{ kind: "name" }] },
                compiledStaticEffects: [
                    {
                        kind: "activation-restriction",
                        id: "pithing-needle-name-activation-lock",
                        sourcesNamed: "chosen-name",
                        exemptManaAbilities: true,
                        oracleText:
                            "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.",
                    },
                ],
            })
        );
    });

    it("Phyrexian Revoker: a nonland card name + a lock on every ability", () => {
        expect(sortKeys(compiled(PHYREXIAN_REVOKER))).toEqual(
            sortKeys({
                name: "Phyrexian Revoker",
                manaCost: { X: 2 },
                types: ["Artifact", "Creature"],
                subtypes: ["Phyrexian", "Horror"],
                power: 2,
                toughness: 1,
                oracleText: PHYREXIAN_REVOKER.oracleText,
                entersWith: {
                    asEnters: [
                        { kind: "name", filter: { excludeType: "Land" } },
                    ],
                },
                compiledStaticEffects: [
                    {
                        kind: "activation-restriction",
                        id: "phyrexian-revoker-name-activation-lock",
                        sourcesNamed: "chosen-name",
                        oracleText:
                            "Activated abilities of sources with the chosen name can't be activated.",
                    },
                ],
            })
        );
    });
});

describe("chosen-name activation lock — refusals (fail-closed)", () => {
    it("the lock without the name choice reads nothing (CR 201.2a)", () => {
        expect(
            refused(
                "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities."
            )
        ).toBe("unparsed");
    });
    it("another exemption tail is another form", () => {
        expect(
            refused(
                "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're loyalty abilities."
            )
        ).toBe("unparsed");
    });
    it("a look-at-hand lead-in before the choice is another form", () => {
        expect(
            refused(
                "As this artifact enters, look at an opponent's hand, then choose any card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities."
            )
        ).toBe("unparsed");
    });
    it("a land card name (Petrified Hamlet's trigger) is another form", () => {
        expect(
            refused(
                "As this artifact enters, choose a land card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities."
            )
        ).toBe("unparsed");
    });
    it("a choice no line reads is refused, beside a line that compiles", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe Revoker",
                manaCost: "{2}",
                typeLine: "Artifact Creature — Phyrexian Horror",
                oracleText:
                    "Flying\nAs this creature enters, choose a card name.",
                power: "2",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
