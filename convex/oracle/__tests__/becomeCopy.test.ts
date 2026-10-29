// The `becomeCopy` Verb Frame (issue #7370, CR 707.2, CR 611.2a, CR 115.3):
// "<this permanent|target X> becomes a copy of <target Y>[ until end of turn]".
//
//  1. GOLDEN — one real corpus card per accepted form: the source as
//     recipient behind an activation cost with a duration (Mirage Mirror), and
//     two announced targets, the second "another", indefinite (True Polymorph).
//  2. REFUSALS — the neighbours the frame must not read: the CR 707.9 "except"
//     clause, a card in a graveyard as the copied object, a pronoun recipient.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function definitionOf(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const MIRAGE =
    "{2}: This artifact becomes a copy of target artifact, creature, enchantment, or land until end of turn.";

describe("becomeCopy frame", () => {
    it("Mirage Mirror — the source becomes a copy of a target until end of turn", () => {
        const definition = definitionOf(
            oracleCard({
                name: "Mirage Mirror",
                manaCost: "{3}",
                typeLine: "Artifact",
                oracleText: MIRAGE,
            })
        );
        expect(sortKeys(definition.activatedAbilities![0]!.effects)).toEqual(
            sortKeys([
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ])
        );
    });

    it("True Polymorph — two announced targets, the copied one 'another' (CR 115.3)", () => {
        const definition = definitionOf(
            oracleCard({
                name: "True Polymorph",
                manaCost: "{3}{U}",
                typeLine: "Sorcery",
                oracleText:
                    "Target artifact or creature becomes a copy of another target artifact or creature.",
            })
        );
        expect(sortKeys(definition.effects)).toEqual(
            sortKeys([
                {
                    op: "becomeCopy",
                    target: { target: 0 },
                    source: { target: 1 },
                },
            ])
        );
        expect(definition.additionalTargetRequirements).toEqual([
            {
                type: ["Artifact", "Creature"],
                count: 1,
                excludePriorTargets: true,
            },
        ]);
    });

    const refused = (text: string, typeLine = "Artifact") =>
        compileCard(
            oracleCard({
                name: "Refused Card",
                manaCost: "{3}",
                typeLine,
                oracleText: text,
            })
        ).state;

    it("refuses the CR 707.9 'except' clause", () => {
        expect(
            refused(
                "{1}{U}{R}: This artifact becomes a copy of target artifact, except it has this ability."
            )
        ).toBe("unparsed");
    });

    it("refuses a card in a graveyard as the copied object", () => {
        expect(
            refused(
                "{2}: This artifact becomes a copy of target permanent card in your graveyard until end of turn."
            )
        ).toBe("unparsed");
    });

    it("refuses a pronoun recipient", () => {
        expect(
            refused(
                "{2}: That creature becomes a copy of target creature until end of turn."
            )
        ).toBe("unparsed");
    });
});
