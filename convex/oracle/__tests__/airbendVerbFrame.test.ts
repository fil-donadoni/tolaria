// The airbend Verb Frame (CR 701.65a, issue #3551): "Airbend <announced
// permanents>" lowers to one `airbend` Op per announced slot, and every
// neighbouring form stays refused under its own gap.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const REMINDER =
    "(Exile it. While it's exiled, its owner may cast it for {2} rather than its mana cost.)";

function instant(oracleText: string) {
    return oracleCard({
        name: "Probe",
        manaCost: "{1}{W}",
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

function effects(oracleText: string) {
    const outcome = compileCard(instant(oracleText));
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    return outcome.definition;
}

describe("airbend Verb Frame (CR 701.65a)", () => {
    it("one target reads one slot, under its reminder text", () => {
        const def = effects(`Airbend target nonland permanent. ${REMINDER}`);
        expect(def.effects).toEqual([{ op: "airbend", target: { target: 0 } }]);
        expect(def.targetRequirement).toMatchObject({
            count: 1,
            excludeTypes: ["Land"],
        });
    });

    it('"up to one target" announces zero or one (CR 601.2c)', () => {
        const def = effects("Airbend up to one target creature.");
        expect(def.effects).toEqual([{ op: "airbend", target: { target: 0 } }]);
        expect(def.targetRequirement).toMatchObject({
            type: "Creature",
            count: { min: 0, max: 1 },
        });
    });

    it('"up to two target" reads one Op per slot', () => {
        const def = effects("Airbend up to two target creatures.");
        expect(def.effects).toEqual([
            { op: "airbend", target: { target: 0 } },
            { op: "airbend", target: { target: 1 } },
        ]);
    });

    it.each([
        ["a stack object", "Airbend target spell."],
        ["the mixed stack phrase", "Airbend target creature or spell."],
        ["a sweep", "Airbend all creatures."],
        ["a card in a graveyard", "Airbend target card in a graveyard."],
        ["no object", "Airbend."],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(instant(text)).state).toBe("unparsed");
    });
});
