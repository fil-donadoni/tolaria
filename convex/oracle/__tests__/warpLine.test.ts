// The "Warp [cost]" keyword line (CR 702.185a, issue #8652).
//
//  1. GOLDEN fixtures — a real corpus card per accepted cost form, compiled
//     whole: the cost lands on `CardDefinition.warp`, the field
//     `getAlternativeCost` resolves, beside the `"warp"` keyword `gre/warp.ts`
//     reads. A guild-hybrid card (Pinnacle Emissary) has another gap, so its
//     form is pinned at the slot and by the gap leaving the card.
//  2. REFUSALS — the neighbours the rule must NOT read (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

const REMINDER =
    "(You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("Warp [cost] — goldens (CR 702.185a)", () => {
    it("Bygone Colossus: a generic warp cost", () => {
        const oracleText = `Warp {3} ${REMINDER}`;
        expect(
            compiled(
                oracleCard({
                    name: "Bygone Colossus",
                    manaCost: "{9}",
                    typeLine: "Artifact Creature — Robot Giant",
                    oracleText,
                    power: "9",
                    toughness: "9",
                })
            )
        ).toEqual({
            name: "Bygone Colossus",
            types: ["Artifact", "Creature"],
            subtypes: ["Robot", "Giant"],
            manaCost: { X: 9 },
            power: 9,
            toughness: 9,
            oracleText,
            staticAbilities: ["warp"],
            warp: {
                id: "warp",
                description: "Warp {3}",
                mana: { X: 3 },
            },
        });
    });

    it("Sinister Cryologist: a coloured warp cost beside a trigger", () => {
        const oracleText = `When this creature enters, target creature an opponent controls gets -3/-0 until end of turn.\nWarp {U} ${REMINDER}`;
        expect(
            compiled(
                oracleCard({
                    name: "Sinister Cryologist",
                    manaCost: "{2}{U}",
                    typeLine: "Creature — Jellyfish Wizard",
                    oracleText,
                    power: "2",
                    toughness: "3",
                })
            )
        ).toEqual({
            name: "Sinister Cryologist",
            types: ["Creature"],
            subtypes: ["Jellyfish", "Wizard"],
            manaCost: { X: 2, U: 1 },
            power: 2,
            toughness: 3,
            oracleText,
            staticAbilities: ["warp"],
            compiledTriggeredAbilities: [
                {
                    id: "sinister-cryologist-trigger",
                    oracleText:
                        "When this creature enters, target creature an opponent controls gets -3/-0 until end of turn.",
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: -3,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
            warp: {
                id: "warp",
                description: "Warp {U}",
                mana: { U: 1 },
            },
        });
    });

    it("Knight Luminary: a generic-and-coloured warp cost", () => {
        const oracleText = `When this creature enters, create a 1/1 white Human Soldier creature token.\nWarp {1}{W} ${REMINDER}`;
        expect(
            compiled(
                oracleCard({
                    name: "Knight Luminary",
                    manaCost: "{3}{W}",
                    typeLine: "Creature — Human Knight",
                    oracleText,
                    power: "3",
                    toughness: "2",
                })
            )
        ).toMatchObject({
            staticAbilities: ["warp"],
            warp: {
                id: "warp",
                description: "Warp {1}{W}",
                mana: { X: 1, W: 1 },
            },
        });
    });

    it("Pinnacle Emissary: a guild-hybrid warp cost is read, leaving only its trigger's gap", () => {
        const read = keywordLineSlot.run("Warp {U/R}", parseContext());
        expect(read.ok).toBe(true);
        if (read.ok)
            expect(read.value).toEqual({
                kind: "warp",
                cost: { hybrid: [["U", "R"]] },
                description: "Warp {U/R}",
            });
        const trigger =
            'Whenever you cast an artifact spell, create a 1/1 colorless Drone artifact creature token with flying and "This token can block only creatures with flying."';
        const outcome = compileCard(
            oracleCard({
                name: "Pinnacle Emissary",
                manaCost: "{1}{U}{R}",
                typeLine: "Artifact Creature — Robot",
                oracleText: `${trigger}\nWarp {U/R} ${REMINDER}`,
                power: "3",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps.map((g) => g.fragment)).toEqual([trigger]);
    });
});

describe("Warp [cost] — refusals (fail-closed)", () => {
    const refused = [
        // {X} on an alternative cost's mana leg: exercised by no card.
        "Warp {X}{G}",
        // A Phyrexian or a monocolour hybrid pip: printed on no warp line.
        "Warp {B/P}",
        "Warp {2/W}",
        // Ability words that start with the word (Warp Blast, Warp Vortex).
        "Warp Blast — When this creature enters, it deals X damage to any target.",
        // A non-mana cost.
        "Warp—Pay 2 life.",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(keywordLineSlot.run(line, parseContext()).ok).toBe(false);
        });
    }

    it("Broodguard Elite keeps its {X} warp line as a named gap", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Broodguard Elite",
                manaCost: "{X}{G}{G}",
                typeLine: "Creature — Insect Knight",
                oracleText: `Trample\nWarp {X}{G} ${REMINDER}`,
                power: "0",
                toughness: "0",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps.map((g) => g.fragment)).toContain(
                "Warp {X}{G}"
            );
    });

    it("a second warp line is a lowering refusal", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Bygone Colossus",
                manaCost: "{9}",
                typeLine: "Artifact Creature — Robot Giant",
                oracleText: "Warp {3}\nWarp {2}",
                power: "9",
                toughness: "9",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
