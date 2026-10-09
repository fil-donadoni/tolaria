// The source's own animation, and the pump that also recolours (issue #4564):
//
//   "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end
//    of turn. It's still a land."                                (CR 205.1b)
//   "Discard a card: This creature gets +1/+1 and becomes the color of your
//    choice until end of turn."                         (CR 613.4c, 613.1e)
//
// Three layers:
//  1. GOLDEN — a real corpus card compiles its animate ability to exactly the
//     `animate` Op below (`animatesSelf` set, so the Bot never pays twice).
//  2. REFUSALS — the neighbours the rule must NOT read: a quoted granted
//     ability (Spawning Pool), a target pump with a recolour, a rider that
//     restates a different type, and an animation with no rider at all.
//  3. The rider is what keeps the land type (CR 205.1b): without it the
//     sentence replaces the types, which `animate` does not express.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const EOT = { phase: "end-of-turn" };

/** The whole definition of a card, failing the test if it is refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** Where every line of a refused card stopped (reason, or path + span). */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    return outcome.gaps.map((gap) =>
        gap.attribution === undefined
            ? gap.reason
            : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`
    );
}

function land(name: string, oracleText: string, oracleId: string) {
    return oracleCard({
        oracleId,
        name,
        manaCost: "",
        typeLine: "Land",
        oracleText,
    });
}

/** The activated ability whose first effect is the animation. */
function animateAbility(card: ReturnType<typeof oracleCard>) {
    const def = compiled(card);
    return (def.activatedAbilities ?? []).find(
        (a) => a.effects?.[0]?.op === "animate"
    );
}

describe("a land animating itself (CR 205.1b, 611.1)", () => {
    it("compiles the artifact manland — Mishra's Factory", () => {
        const text =
            "{T}: Add {C}.\n{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.\n{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.";
        expect(
            sortKeys(
                animateAbility(
                    land(
                        "Mishra's Factory",
                        text,
                        "a696c5b6-f216-454d-8029-74e84bbd1428"
                    )
                )
            )
        ).toEqual(
            sortKeys({
                id: "mishras-factory-ability-2",
                oracleText:
                    "{1}: This land becomes a 2/2 Assembly-Worker artifact creature until end of turn. It's still a land.",
                cost: { mana: { X: 1 } },
                useStack: true,
                animatesSelf: true,
                effects: [
                    {
                        op: "animate",
                        target: { ref: "$source" },
                        power: 2,
                        toughness: 2,
                        subtype: "Assembly-Worker",
                        additionalTypes: ["Artifact"],
                        duration: EOT,
                    },
                ],
            })
        );
    });

    it("compiles a coloured manland with a keyword — Faerie Conclave", () => {
        const text =
            "This land enters tapped.\n{T}: Add {U}.\n{1}{U}: This land becomes a 2/1 blue Faerie creature with flying until end of turn. It's still a land.";
        expect(
            sortKeys(
                animateAbility(
                    land(
                        "Faerie Conclave",
                        text,
                        "ae3ede87-b026-4781-81ab-8652664f8e41"
                    )
                )?.effects
            )
        ).toEqual(
            sortKeys([
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 1,
                    subtype: "Faerie",
                    colors: ["U"],
                    grantedAbilities: ["flying"],
                    duration: EOT,
                },
            ])
        );
    });

    it("compiles a second keyword and colour — Treetop Village", () => {
        const text =
            "This land enters tapped.\n{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green Ape creature with trample until end of turn. It's still a land.";
        const ability = animateAbility(
            land(
                "Treetop Village",
                text,
                "02212bd8-0c0f-4e8e-99f1-a8477476c03a"
            )
        );
        expect(ability?.animatesSelf).toBe(true);
        expect(sortKeys(ability?.effects)).toEqual(
            sortKeys([
                {
                    op: "animate",
                    target: { ref: "$source" },
                    power: 3,
                    toughness: 3,
                    subtype: "Ape",
                    colors: ["G"],
                    grantedAbilities: ["trample"],
                    duration: EOT,
                },
            ])
        );
    });

    // REFUSALS — each stays under its own Grammar Gap key.
    it("refuses a quoted granted ability — Spawning Pool", () => {
        const text =
            'This land enters tapped.\n{T}: Add {B}.\n{1}{B}: This land becomes a 1/1 black Skeleton creature with "{B}: Regenerate this creature" until end of turn. It\'s still a land.';
        expect(
            refusedAt(
                land(
                    "Spawning Pool",
                    text,
                    "907b49ff-2020-4203-b93e-4b3306afc337"
                )
            ).length
        ).toBeGreaterThan(0);
    });

    it("refuses an animation with no 'still a land' rider", () => {
        const text =
            "{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green Ape creature with trample until end of turn.";
        expect(refusedAt(land("Treetop Village", text, "x"))).toEqual([
            expect.stringContaining("replaces their types"),
        ]);
    });

    it("refuses a rider that restates a different type", () => {
        const text =
            "{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green Ape creature with trample until end of turn. It's still a creature.";
        expect(refusedAt(land("Treetop Village", text, "x")).length).toBe(1);
    });

    it("refuses a subtype the CR does not list", () => {
        const text =
            "{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green Gorp creature with trample until end of turn. It's still a land.";
        expect(refusedAt(land("Treetop Village", text, "x")).length).toBe(1);
    });
});

describe("a pump that also recolours (CR 613.4c, 613.1e)", () => {
    const text =
        "Discard a card: This creature gets +1/+1 and becomes the color of your choice until end of turn.";
    const wildMongrel = (oracleText: string) =>
        oracleCard({
            oracleId: "4d5be4ab-f85a-4272-ac08-99cb0105eb11",
            name: "Wild Mongrel",
            manaCost: "{1}{G}",
            typeLine: "Creature — Dog",
            oracleText,
            power: "2",
            toughness: "2",
        });

    it("compiles the pump then the pick — Wild Mongrel", () => {
        const ops = compiled(wildMongrel(text)).activatedAbilities?.[0]
            ?.effects;
        expect(ops?.map((op) => op.op)).toEqual(["pump", "optionChoice"]);
        expect(ops?.[0]).toEqual({
            op: "pump",
            target: { ref: "$source" },
            power: 1,
            toughness: 1,
            duration: EOT,
        });
    });

    it("refuses a TARGET pump with the recolour", () => {
        const refused = refusedAt(
            wildMongrel(
                "Discard a card: Target creature gets +1/+1 and becomes the color of your choice until end of turn."
            )
        );
        expect(refused.length).toBe(1);
    });

    it("refuses a recolour carrying a different duration", () => {
        const refused = refusedAt(
            wildMongrel(
                "Discard a card: This creature gets +1/+1 and becomes the color of your choice."
            )
        );
        expect(refused.length).toBe(1);
    });
});
