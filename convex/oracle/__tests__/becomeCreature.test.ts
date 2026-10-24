// "it becomes a 4/4 Ape creature" — the source's permanent type-line
// replacement (CR 205.1a + CR 613.1d), behind an intervening "if this
// permanent is an enchantment" whose subject the leading "it" names
// (CR 608.2h).
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const HEAD =
    "When an opponent casts an instant spell, if this permanent is an enchantment";

const gibbons = (tail: string) =>
    compileCard(
        oracleCard({
            name: "Hidden Gibbons",
            manaCost: "{1}{G}{G}",
            typeLine: "Enchantment",
            oracleText: `${HEAD}, ${tail}`,
            power: undefined,
            toughness: undefined,
        })
    );

const effectsOf = (tail: string) => {
    const outcome = gibbons(tail);
    if (outcome.state === "unparsed") throw new Error(`unparsed: ${tail}`);
    return outcome.definition.compiledTriggeredAbilities![0]!.effects;
};

describe("become-creature (CR 205.1a, CR 613.1d)", () => {
    it("Hidden Gibbons: types, subtype and base P/T on the source", () => {
        expect(effectsOf("it becomes a 4/4 Ape creature.")).toEqual([
            {
                op: "setCardTypes",
                target: { ref: "$source" },
                types: ["Creature"],
            },
            {
                op: "setSubtype",
                target: { ref: "$source" },
                subtypes: ["Ape"],
            },
            {
                op: "setBasePT",
                target: { ref: "$source" },
                power: 4,
                toughness: 4,
            },
        ]);
    });

    it("a printed colour adds the layer-5 Op (CR 613.1e)", () => {
        expect(
            effectsOf("it becomes a 4/4 green Ape creature.").map((e) => e.op)
        ).toEqual(["setCardTypes", "setSubtype", "setColor", "setBasePT"]);
    });

    it("refuses the neighbours: a duration, a list, an unknown word, another subject", () => {
        for (const tail of [
            "it becomes a 4/4 Ape creature until end of turn.",
            "it becomes a 4/4 green and blue Ape creature.",
            "it becomes a 4/4 Ape Wizard creature.",
            "it becomes a 4/4 Gibbon creature.",
            "it becomes a 4/4 artifact Ape creature.",
            "it becomes a creature.",
            "that creature becomes a 4/4 Ape creature.",
        ])
            expect(gibbons(tail).state, tail).toBe("unparsed");
    });

    it("a different condition leaves the leading pronoun unread", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Hidden Gibbons",
                manaCost: "{1}{G}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "When an opponent casts an instant spell, if you control a creature, it becomes a 4/4 Ape creature.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
