// "<creature> fights <other>" — the keyword action fight (CR 701.14, issue
// #4572), lowered to the `fight` Op (issue #2013).
//
//  1. GOLDEN — a real Oracle card compiled whole: Triangle of War's two
//     announced combatants, in printed order, as slots 0 and 1.
//  2. REFUSALS — the neighbours the rule must not read: a combatant named by
//     an anaphor ("that creature"), which no slot announces.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const TRIANGLE_OF_WAR = oracleCard({
    oracleId: "6d4daf9c-e2f4-4d0e-b2e4-ded04d644b11",
    name: "Triangle of War",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText:
        "{2}, Sacrifice this artifact: Target creature you control fights target creature an opponent controls. (Each deals damage equal to its power to the other.)",
    power: undefined,
    toughness: undefined,
});

describe("fight clause (CR 701.14a)", () => {
    it("golden — Triangle of War: two announced creatures fight", () => {
        const outcome = compileCard(TRIANGLE_OF_WAR);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Triangle of War",
                types: ["Artifact"],
                manaCost: { X: 1 },
                oracleText:
                    "{2}, Sacrifice this artifact: Target creature you control fights target creature an opponent controls. (Each deals damage equal to its power to the other.)",
                activatedAbilities: [
                    {
                        id: "triangle-of-war-ability",
                        oracleText:
                            "{2}, Sacrifice this artifact: Target creature you control fights target creature an opponent controls.",
                        cost: { mana: { X: 2 }, sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "fight",
                                creature: { target: 0 },
                                other: { target: 1 },
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "you",
                        },
                        additionalTargetRequirements: [
                            {
                                type: "Creature",
                                count: 1,
                                controller: "opponent",
                            },
                        ],
                    },
                ],
            })
        );
    });

    // Time to Feed's last sentence (its "Choose target …" head is refused
    // upstream), so nothing but the fight clause can refuse it.
    it('refuses "fights that creature" — an anaphor no slot announces (Time to Feed)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Time to Feed",
                manaCost: "{2}{G}",
                typeLine: "Sorcery",
                oracleText: "Target creature you control fights that creature.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(/single creature target/);
    });

    it("refuses a player combatant — a fight is between creatures", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Brawl",
                manaCost: "{1}{R}",
                typeLine: "Sorcery",
                oracleText: "Target creature you control fights target player.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(/single creature target/);
    });
});
