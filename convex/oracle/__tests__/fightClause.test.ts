// "<creature> fights <other>" — the keyword action fight (CR 701.14, issue
// #4572), lowered to the `fight` Op (issue #2013).
//
//  1. GOLDEN — a real Oracle card compiled whole: Triangle of War's two
//     announced combatants, in printed order, as slots 0 and 1.
//  2. REFUSALS — the neighbours the rule must not read: a combatant named by
//     an anaphor ("that creature"), the source itself, and a player.

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

    // CR 701.14a — the ability's own source is the instructed side ("This
    // creature fights …", issue #10351): `$source`, which the fight Op and its
    // CR 701.14b battlefield check already read.
    it('reads "this creature fights" — the source as the instructed combatant', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Brawler",
                manaCost: "{1}{G}",
                typeLine: "Creature — Bear",
                oracleText: "{1}{G}: This creature fights target creature.",
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "fight",
                creature: { ref: "$source" },
                other: { target: 0 },
            },
        ]);
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

    // CR 608.2c — a later sentence's "It" names the ONE creature target the
    // sentence before announced: that slot is the instructed combatant.
    it('golden — Savage Smash: "It" names the pumped target as the fighter', () => {
        const oracleText =
            "Target creature you control gets +2/+2 until end of turn. It fights target creature you don't control. (Each deals damage equal to its power to the other.)";
        const outcome = compileCard(
            oracleCard({
                oracleId: "676c0315-1cb3-4d80-b136-16d88fd612cb",
                name: "Savage Smash",
                manaCost: "{1}{R}{G}",
                typeLine: "Sorcery",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Savage Smash",
                types: ["Sorcery"],
                manaCost: { X: 1, R: 1, G: 1 },
                oracleText,
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: 2,
                        toughness: 2,
                        duration: { phase: "end-of-turn" },
                    },
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
                    { type: "Creature", count: 1, controller: "opponent" },
                ],
            })
        );
    });

    it('golden — Kapow!: "It" names the countered target as the fighter', () => {
        const oracleText =
            "Put a +1/+1 counter on target creature you control. It fights target creature an opponent controls. (Each deals damage equal to its power to the other.)";
        const outcome = compileCard(
            oracleCard({
                oracleId: "d6eabbff-cc0c-4000-8feb-4826e1b6bc66",
                name: "Kapow!",
                manaCost: "{2}{G}",
                typeLine: "Sorcery",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Kapow!",
                types: ["Sorcery"],
                manaCost: { X: 2, G: 1 },
                oracleText,
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { target: 0 },
                        count: 1,
                    },
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
                    { type: "Creature", count: 1, controller: "opponent" },
                ],
            })
        );
    });

    // CR 701.14b — the other side may be "up to one": with no second
    // creature, neither fights or deals damage.
    it('reads "It fights up to one target creature" (Bridgeworks Battle)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Bridgeworks Battle",
                manaCost: "{2}{G}",
                typeLine: "Sorcery",
                oracleText:
                    "Target creature you control gets +2/+2 until end of turn. It fights up to one target creature you don't control. (Each deals damage equal to its power to the other.)",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.effects?.[1]).toEqual({
            op: "fight",
            creature: { target: 0 },
            other: { target: 1 },
        });
        expect(outcome.definition.additionalTargetRequirements).toEqual([
            {
                type: "Creature",
                count: { min: 0, max: 1 },
                controller: "opponent",
            },
        ]);
    });

    // CR 701.14a — a fight is between creatures: "It" naming an announced
    // non-creature permanent is no combatant.
    it('refuses "It fights" when the announced target is not a creature', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Clash",
                manaCost: "{1}{G}",
                typeLine: "Sorcery",
                oracleText:
                    "Untap target artifact you control. It fights target creature you don't control.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(/single creature target/);
    });
});
