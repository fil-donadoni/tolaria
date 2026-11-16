// The trailing-gate Composition Rule (CR 608.2c): "<effect> if an opponent
// has cast a <colour>[ or <colour>] spell this turn." gates the sentence it
// ends on an `if` over the `spellsCastThisTurn` value (CR 601.2i / 202.2).
//
//  1. GOLDEN — a real corpus card compiled whole: Veil of Summer, whose line
//     also carries the counter-immunity frame (CR 611.2c / 101.2) and the
//     "You and permanents you control" grant (CR 611.2c / 702.11f).
//  2. FORMS — one colour; the gate around a sentence with a target.
//  3. REFUSALS — the neighbours the gate does not read: another tense, a
//     condition on "you", a spell type instead of a colour, a head nothing
//     reads.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const VEIL_OF_SUMMER_TEXT =
    "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn. (You and they can't be the targets of blue or black spells or abilities your opponents control.)";

function instant(oracleText: string) {
    return oracleCard({
        name: "Test Instant",
        manaCost: "{G}",
        typeLine: "Instant",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

function compiledEffects(oracleText: string) {
    const outcome = compileCard(instant(oracleText));
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition.effects;
}

const gateOn = (colors: string[]) => ({
    left: { spellsCastThisTurn: { of: "opponent", colors } },
    op: "ge",
    right: 1,
});

describe("trailing gate — golden (CR 608.2c)", () => {
    it("spell slot: Veil of Summer", () => {
        const card = oracleCard({
            oracleId: "002965be-a36f-4a09-9ce0-c6535bca1703",
            name: "Veil of Summer",
            manaCost: "{G}",
            typeLine: "Instant",
            oracleText: VEIL_OF_SUMMER_TEXT,
            power: undefined,
            toughness: undefined,
        });
        const outcome = compileCard(card);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Veil of Summer",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText: VEIL_OF_SUMMER_TEXT,
                effects: [
                    {
                        op: "if",
                        predicate: gateOn(["U", "B"]),
                        then: [{ op: "draw", player: "controller", count: 1 }],
                    },
                    { op: "grantSpellCounterImmunity", player: "controller" },
                    {
                        op: "grantPlayerKeyword",
                        player: "controller",
                        keyword: "hexproof from blue",
                    },
                    {
                        op: "grantPlayerKeyword",
                        player: "controller",
                        keyword: "hexproof from black",
                    },
                    {
                        op: "forEach",
                        select: {
                            set: "permanents",
                            zone: "battlefield",
                            controller: "controller",
                        },
                        effects: [
                            {
                                op: "grantAbility",
                                target: { ref: "$each" },
                                ability: "hexproof from blue",
                                duration: { phase: "end-of-turn" },
                            },
                            {
                                op: "grantAbility",
                                target: { ref: "$each" },
                                ability: "hexproof from black",
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
        // The `GOLDEN_FIXTURES` row clears both smoke skips the line exhibits.
        expect(outcome.state).toBe("ready");
    });
});

describe("trailing gate — forms (CR 601.2i / 202.2)", () => {
    it("reads one colour", () => {
        expect(
            compiledEffects(
                "Draw a card if an opponent has cast a red spell this turn."
            )
        ).toEqual([
            {
                op: "if",
                predicate: gateOn(["R"]),
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
    });

    it("keeps the gated sentence's target announced (CR 601.2c)", () => {
        const outcome = compileCard(
            instant(
                "Destroy target creature if an opponent has cast a green spell this turn."
            )
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        expect(outcome.definition.effects).toEqual([
            {
                op: "if",
                predicate: gateOn(["G"]),
                then: [{ op: "destroy", target: { target: 0 } }],
            },
        ]);
    });
});

describe("trailing gate — refusals", () => {
    const refused = (text: string) =>
        expect(compileCard(instant(text)).state).toBe("unparsed");

    it('refuses the simple past "cast" (a different condition spelling)', () => {
        refused("Draw a card if an opponent cast a blue spell this turn.");
    });

    it('refuses a condition on "you"', () => {
        refused("Draw a card if you have cast a blue spell this turn.");
    });

    it("refuses a spell type in place of a colour", () => {
        refused(
            "Draw a card if an opponent has cast a creature spell this turn."
        );
    });

    it("refuses three colours", () => {
        refused(
            "Draw a card if an opponent has cast a white, blue or black spell this turn."
        );
    });

    it("refuses a head no sentence reads", () => {
        refused(
            "Gnaw on a card if an opponent has cast a blue spell this turn."
        );
    });
});
