// "You may pay {cost}. If you do, <effect>" (CR 118.12 + CR 608.2c) and
// "<effect> and this creature assigns no combat damage this turn" (CR 510.1c),
// issue #6205. Behavioural layer over the golden fixture: the forms this rule
// reads, and the neighbours it must keep refusing.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function creature(oracleText: string) {
    return oracleCard({
        name: "Test Raider",
        manaCost: "{R}",
        oracleText,
        typeLine: "Creature — Goblin",
    });
}

function effectsOf(oracleText: string) {
    const outcome = compileCard(creature(oracleText));
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition.compiledTriggeredAbilities![0]!;
}

describe("fixed mana payment gates its payoff (CR 118.12)", () => {
    it("lowers to a mayPay on the mana cost and an if on its bind", () => {
        const ability = effectsOf(
            "Whenever this creature attacks, you may pay {R}. If you do, draw a card."
        );
        expect(ability.effects).toHaveLength(2);
        const [pay, gate] = ability.effects;
        expect(pay).toMatchObject({ op: "mayPay", cost: { R: 1 } });
        const bind = pay!.op === "mayPay" ? pay!.bind : "";
        expect(gate).toMatchObject({
            op: "if",
            predicate: { binding: bind },
            then: [{ op: "draw" }],
        });
    });

    it("refuses a payment that feeds no 'If you do'", () => {
        const outcome = compileCard(
            creature("Whenever this creature attacks, you may pay {R}.")
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("the source's own assignment suppression (CR 510.1c)", () => {
    it("rides after the head effect, on the source", () => {
        const ability = effectsOf(
            "Whenever this creature attacks, destroy target artifact defending player controls and this creature assigns no combat damage this turn."
        );
        expect(ability.effects).toMatchObject([
            { op: "destroy", target: { target: 0 } },
            { op: "markAssignsNoCombatDamage", target: { ref: "$source" } },
        ]);
        expect(ability.targetRequirement).toMatchObject({
            type: "Artifact",
            controller: "opponent",
        });
    });

    it("refuses a subject that is not the source", () => {
        const outcome = compileCard(
            creature(
                "Whenever this creature attacks, destroy target artifact and target creature assigns no combat damage this turn."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe('"defending player controls" is read only behind the source\'s own attack (CR 508.5)', () => {
    it.each([
        "Whenever a creature you control attacks, destroy target artifact defending player controls.",
        "When this creature dies, destroy target artifact defending player controls.",
    ])("refuses %s", (text) => {
        expect(compileCard(creature(text)).state).toBe("unparsed");
    });

    it("reads it behind attacks-and-isn't-blocked", () => {
        const ability = effectsOf(
            "Whenever this creature attacks and isn't blocked, destroy target artifact defending player controls."
        );
        expect(ability.targetRequirement).toMatchObject({
            controller: "opponent",
        });
    });
});

describe("the fixed payment keeps refusing neighbouring shapes", () => {
    it.each([
        "Whenever this creature attacks, you may pay {R} to draw a card.",
    ])("refuses %s", (text) => {
        expect(compileCard(creature(text)).state).toBe("unparsed");
    });
});

describe("hybrid pips in a fixed mana payment (CR 107.4e + CR 118.12)", () => {
    it("keeps each {W/B} pip as a hybrid pair on the mayPay cost", () => {
        const ability = effectsOf(
            "Whenever this creature attacks, you may pay {W/B}{W/B}. If you do, draw a card."
        );
        expect(ability.effects[0]).toMatchObject({
            op: "mayPay",
            cost: {
                hybrid: [
                    ["W", "B"],
                    ["W", "B"],
                ],
            },
        });
    });

    it("reads generic beside hybrid (Yasova Dragonclaw's {1}{U/R}{U/R})", () => {
        const ability = effectsOf(
            "At the beginning of combat on your turn, you may pay {1}{U/R}{U/R}. If you do, draw a card."
        );
        expect(ability.effects[0]).toMatchObject({
            op: "mayPay",
            cost: {
                X: 1,
                hybrid: [
                    ["U", "R"],
                    ["U", "R"],
                ],
            },
        });
    });

    it.each([
        ["a monocolour hybrid pip", "{2/W}"],
        ["a Phyrexian pip", "{R/P}"],
        ["a three-way hybrid", "{W/U/B}"],
    ])("keeps refusing %s", (_label, pip) => {
        const outcome = compileCard(
            creature(
                `Whenever this creature attacks, you may pay ${pip}. If you do, draw a card.`
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
