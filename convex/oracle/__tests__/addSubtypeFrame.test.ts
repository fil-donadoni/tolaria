// The add-a-subtype Verb Frame (CR 205.1b + CR 613.1d, issue #7369): the clause
// the `addSubtype` Op is the lowering of.
//
//  1. FORMS — each antecedent the clause is printed on, on a card shell.
//  2. GOLDEN — Portal to Phyrexia's "It's a Phyrexian" is a row in
//     `GOLDEN_FIXTURES` (`goldenFixtures.test.ts`): a whole real card, and the
//     row that lifts the bound-ref form out of quarantine.
//  3. REFUSALS — the neighbours the frame must not read, fail-closed.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function compile(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Test Card",
            manaCost: "{1}",
            typeLine: "Creature — Vampire",
            power: "1",
            toughness: "1",
            oracleText,
        })
    );
}

function activatedEffects(oracleText: string) {
    const outcome = compile(oracleText);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    expect(outcome.opsUsed).toContain("addSubtype");
    return outcome.definition.activatedAbilities?.[0]?.effects;
}

const VAMPIRE_ON_THE_TARGET = {
    op: "addSubtype",
    target: { target: 0 },
    subtype: "Vampire",
};

describe("add a subtype indefinitely (CR 205.1b / CR 613.1d, issue #7369)", () => {
    it("the announced target becomes the subtype", () => {
        expect(
            activatedEffects(
                "{2}, {T}: Target creature becomes a Vampire in addition to its other types."
            )
        ).toEqual([VAMPIRE_ON_THE_TARGET]);
    });

    it('a later "It" names the target the sentence before announced (CR 608.2c)', () => {
        expect(
            activatedEffects(
                "{1}: Put a +1/+1 counter on target creature. It becomes a Vampire in addition to its other types."
            )
        ).toEqual([
            expect.objectContaining({
                op: "counters",
                target: { target: 0 },
            }),
            VAMPIRE_ON_THE_TARGET,
        ]);
    });

    it('"that creature" names the target the sentence before announced (CR 608.2c)', () => {
        expect(
            activatedEffects(
                "{1}: This creature deals 1 damage to target creature. That creature becomes a Vampire in addition to its other types."
            )?.at(-1)
        ).toEqual(VAMPIRE_ON_THE_TARGET);
    });

    it('"It\'s a …" behind a move names the permanent the card became (CR 400.7j)', () => {
        expect(
            activatedEffects(
                "{1}: Return target creature card from your graveyard to the battlefield. It's a Vampire in addition to its other types."
            )
        ).toEqual([
            expect.objectContaining({
                op: "moveZone",
                target: { target: 0 },
                to: "battlefield",
                bind: "$that1",
            }),
            { op: "addSubtype", target: { ref: "$that1" }, subtype: "Vampire" },
        ]);
    });

    it('"That creature is a …" behind a move reads the same (CR 400.7j)', () => {
        expect(
            activatedEffects(
                "{1}: Return target creature card from your graveyard to the battlefield. That creature is a Vampire in addition to its other types."
            )?.at(-1)
        ).toEqual({
            op: "addSubtype",
            target: { ref: "$that1" },
            subtype: "Vampire",
        });
    });
});

describe("add a subtype — the neighbours it refuses", () => {
    it.each([
        [
            "a card type, not a subtype (Memnarch)",
            "{1}{U}{U}: Target permanent becomes an artifact in addition to its other types.",
        ],
        [
            "a printed duration (Thran Forge)",
            "{2}: Until end of turn, target creature becomes a Vampire in addition to its other types.",
        ],
        [
            "a word that is no creature type",
            "{2}, {T}: Target creature becomes a banana in addition to its other types.",
        ],
        [
            "a creature type on a recipient that is no creature (CR 205.3d)",
            "{2}, {T}: Target land becomes a Vampire in addition to its other types.",
        ],
        [
            "a land type (no recipient shown)",
            "{2}, {T}: Target land becomes an Island in addition to its other types.",
        ],
        [
            'the source\'s "is a …", a static ability',
            "{2}: This creature is a Vampire in addition to its other types.",
        ],
        [
            '"It\'s a …" with no antecedent',
            "{2}: It's a Vampire in addition to its other types.",
        ],
        [
            "a noncreature card moved (CR 205.3d)",
            "{1}: Return target artifact card from your graveyard to the battlefield. It's a Vampire in addition to its other types.",
        ],
        [
            "a move a gate may not have made",
            "{1}: You may pay {1}. If you do, return target creature card from your graveyard to the battlefield. It's a Vampire in addition to its other types.",
        ],
    ])("refuses %s", (_form, text) => {
        expect(compile(text).state).toBe("unparsed");
    });
});
