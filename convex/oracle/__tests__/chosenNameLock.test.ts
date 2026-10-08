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
                oracleText: MEDDLING_MAGE.oracleText,
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

const CURSED_SCROLL_TEXT =
    "{3}, {T}: Choose a card name, then reveal a card at random from your hand. If that card has the chosen name, this artifact deals 2 damage to any target.";

function scroll(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Cursed Scroll",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("card name, random hand reveal, name gate — golden (CR 201.4, 701.20a)", () => {
    it("Cursed Scroll compiles to nameCard → random reveal → name-gated damage", () => {
        const outcome = scroll(CURSED_SCROLL_TEXT);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "nameCard",
                player: "controller",
                prompt: "Choose a card name.",
                bind: "$named",
            },
            {
                op: "reveal",
                player: "controller",
                zone: "hand",
                random: true,
                bind: "$revealed",
            },
            {
                op: "if",
                predicate: {
                    picksMatchFilter: { ref: "$revealed" },
                    player: "controller",
                    zone: "hand",
                    filter: { name: { ref: "$named" } },
                },
                then: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
            },
        ]);
    });
});

describe("card name, random hand reveal, name gate — refusals (fail-closed)", () => {
    it("the gate without the name + reveal sentence reads nothing", () => {
        expect(
            scroll(
                "{3}, {T}: If that card has the chosen name, this artifact deals 2 damage to any target."
            ).state
        ).toBe("unparsed");
    });
    it("a name pick nothing reads back is refused", () => {
        expect(
            scroll(
                "{3}, {T}: Choose a card name, then reveal a card at random from your hand."
            ).state
        ).toBe("unparsed");
    });
    it("a different hand-reveal tail is another form", () => {
        expect(
            scroll(
                "{3}, {T}: Choose a card name, then reveal a card at random from your library. If that card has the chosen name, this artifact deals 2 damage to any target."
            ).state
        ).toBe("unparsed");
    });
});
