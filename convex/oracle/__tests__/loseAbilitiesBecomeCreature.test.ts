// "up to one other target creature loses all abilities and becomes a green
// Lizard creature with base power and toughness 4/4." — the indefinite ability
// strip (CR 613.1f) with the type-line replacement (CR 205.1a) and base P/T
// (CR 613.4b) on one announced target; the emitting rule of `loseAllAbilities`.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const HEAD = "When Lizard, Connors's Curse enters, ";
const LIZARD =
    "up to one other target creature loses all abilities and becomes a green Lizard creature with base power and toughness 4/4.";

const outcomeOf = (tail: string) =>
    compileCard(
        oracleCard({
            name: "Lizard, Connors's Curse",
            manaCost: "{2}{G}{G}",
            typeLine: "Legendary Creature — Lizard Villain",
            oracleText: `Trample\nLizard Formula \u2014 ${HEAD}${tail}`,
            power: "5",
            toughness: "5",
        })
    );

const effectsOf = (tail: string) => {
    const outcome = outcomeOf(tail);
    if (outcome.state === "unparsed") throw new Error(`unparsed: ${tail}`);
    return outcome.definition.compiledTriggeredAbilities![0]!.effects;
};

describe("loses all abilities and becomes a creature (CR 613.1f, CR 205.1a)", () => {
    it("Lizard, Connors's Curse: the five Ops on the announced target", () => {
        const target = { target: 0 };
        expect(effectsOf(LIZARD)).toEqual([
            { op: "loseAllAbilities", target },
            { op: "setCardTypes", target, types: ["Creature"] },
            { op: "setSubtype", target, subtypes: ["Lizard"] },
            { op: "setColor", target, colors: ["G"] },
            { op: "setBasePT", target, power: 4, toughness: 4 },
        ]);
    });

    it("keeps a label that does not head a trigger fail-closed", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Lizard, Connors's Curse",
                manaCost: "{2}{G}{G}",
                typeLine: "Legendary Creature — Lizard Villain",
                oracleText: `Lizard Formula \u2014 Draw a card, ${LIZARD}`,
                power: "5",
                toughness: "5",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses the neighbours: a duration, a list, an unknown word, a sweep", () => {
        for (const tail of [
            LIZARD.replace(/\.$/, " until end of turn."),
            LIZARD.replace("green Lizard", "green Lizard Wizard"),
            LIZARD.replace("green Lizard", "green Zorp"),
            "each creature target player controls loses all abilities and becomes a green Lizard creature with base power and toughness 4/4.",
        ]) {
            expect(outcomeOf(tail).state, tail).toBe("unparsed");
        }
    });
});
