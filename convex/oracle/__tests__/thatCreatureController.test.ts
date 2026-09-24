// "{self} deals N damage to that creature's controller" — the damage recipient
// that names the controller of the ONE creature an earlier sentence targeted
// (CR 109.5 + CR 608.2h), issue #4313.
//
// Two layers:
//
//  1. GOLDENS — the four real cards whose only unread clause it was, one per
//     shape of the sentence before it: a counter (Blur of Blades) and a pump
//     (Fodder Launch) and a tap (Sonic Assault) leave the creature on the
//     battlefield, so the controller is read live (`controllerOf`); a destroy
//     (Consign to the Pit) removes it first, so the controller is read off the
//     `bind` snapshot (CR 608.2h last-known information).
//  2. REFUSALS — the neighbours the rule must NOT read: two announced targets
//     ("that creature" is ambiguous), a target that is not a creature, and the
//     phrase under a verb no fixture pins.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const BLUR_OF_BLADES: OracleCard = {
    oracleId: "65410f7a-c749-4b23-ad61-8a7136efcad2",
    name: "Blur of Blades",
    manaCost: "{1}{R}",
    typeLine: "Instant",
    oracleText:
        "Put a -1/-1 counter on target creature. Blur of Blades deals 2 damage to that creature's controller.",
    layout: "normal",
};

const CONSIGN_TO_THE_PIT: OracleCard = {
    oracleId: "b0c50079-5376-47ff-82c5-d52dbf49afdf",
    name: "Consign to the Pit",
    manaCost: "{5}{B}",
    typeLine: "Sorcery",
    oracleText:
        "Destroy target creature. Consign to the Pit deals 2 damage to that creature's controller.",
    layout: "normal",
};

const FODDER_LAUNCH: OracleCard = {
    oracleId: "bec0127a-ab3c-4923-93c2-c43ba8998091",
    name: "Fodder Launch",
    manaCost: "{3}{B}",
    typeLine: "Kindred Sorcery — Goblin",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a Goblin.\nTarget creature gets -5/-5 until end of turn. Fodder Launch deals 5 damage to that creature's controller.",
    layout: "normal",
};

const SONIC_ASSAULT: OracleCard = {
    oracleId: "dfe9e485-c070-4efd-8c35-69d4eb3f58e4",
    name: "Sonic Assault",
    manaCost: "{1}{U}{R}",
    typeLine: "Instant",
    oracleText:
        "Tap target creature. Sonic Assault deals 2 damage to that creature's controller.\nJump-start (You may cast this card from your graveyard by discarding a card in addition to paying its other costs. Then exile this card.)",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const ONE_CREATURE = { type: "Creature", count: 1 };
const LIVE_CONTROLLER = { player: { controllerOf: { target: 0 } } };

describe("that creature's controller as a damage recipient (CR 109.5, issue #4313)", () => {
    it("Blur of Blades: a counter leaves the creature, so its controller is read live", () => {
        expect(sortKeys(compiled(BLUR_OF_BLADES))).toEqual(
            sortKeys({
                name: "Blur of Blades",
                types: ["Instant"],
                manaCost: { X: 1, R: 1 },
                oracleText: BLUR_OF_BLADES.oracleText,
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "-1/-1",
                        target: { target: 0 },
                        count: 1,
                    },
                    { op: "dealDamage", amount: 2, to: LIVE_CONTROLLER },
                ],
                targetRequirement: ONE_CREATURE,
            })
        );
    });

    it("Consign to the Pit: a destroy removes the creature, so its controller is the snapshot's", () => {
        expect(sortKeys(compiled(CONSIGN_TO_THE_PIT))).toEqual(
            sortKeys({
                name: "Consign to the Pit",
                types: ["Sorcery"],
                manaCost: { X: 5, B: 1 },
                oracleText: CONSIGN_TO_THE_PIT.oracleText,
                effects: [
                    { op: "destroy", target: { target: 0 }, bind: "$that1" },
                    {
                        op: "dealDamage",
                        amount: 2,
                        to: { player: { ref: "$that1.controller" } },
                    },
                ],
                targetRequirement: ONE_CREATURE,
            })
        );
    });

    it("Fodder Launch: a pump leaves the creature, so its controller is read live", () => {
        expect(sortKeys(compiled(FODDER_LAUNCH))).toEqual(
            sortKeys({
                name: "Fodder Launch",
                types: ["Kindred", "Sorcery"],
                subtypes: ["Goblin"],
                manaCost: { X: 3, B: 1 },
                oracleText: FODDER_LAUNCH.oracleText,
                effects: [
                    {
                        op: "pump",
                        target: { target: 0 },
                        power: -5,
                        toughness: -5,
                        duration: { phase: "end-of-turn" },
                    },
                    { op: "dealDamage", amount: 5, to: LIVE_CONTROLLER },
                ],
                targetRequirement: ONE_CREATURE,
                additionalCosts: {
                    sacrificeFilter: { subtypes: ["Goblin"] },
                },
            })
        );
    });

    it("Sonic Assault: a tap leaves the creature, so its controller is read live", () => {
        expect(sortKeys(compiled(SONIC_ASSAULT))).toEqual(
            sortKeys({
                name: "Sonic Assault",
                types: ["Instant"],
                manaCost: { X: 1, U: 1, R: 1 },
                oracleText: SONIC_ASSAULT.oracleText,
                staticAbilities: ["jump-start"],
                effects: [
                    {
                        op: "tapUntap",
                        action: "tap",
                        target: { target: 0 },
                    },
                    { op: "dealDamage", amount: 2, to: LIVE_CONTROLLER },
                ],
                targetRequirement: ONE_CREATURE,
            })
        );
    });

    describe("refused neighbours", () => {
        const refused = (oracleText: string) =>
            compileCard(oracleCard({ typeLine: "Sorcery", oracleText }));

        it("two announced targets: 'that creature' could name either", () => {
            expect(
                refused(
                    "Destroy target creature. Destroy target land. {self} deals 2 damage to that creature's controller."
                ).state
            ).toBe("unparsed");
        });

        it("a target that is not a creature", () => {
            expect(
                refused(
                    "Destroy target artifact. {self} deals 2 damage to that creature's controller."
                ).state
            ).toBe("unparsed");
        });

        it("no earlier target at all", () => {
            expect(
                refused("{self} deals 2 damage to that creature's controller.")
                    .state
            ).toBe("unparsed");
        });

        it("another verb under the same phrase is not read", () => {
            expect(
                refused(
                    "Destroy target creature. That creature's controller loses 2 life."
                ).state
            ).toBe("unparsed");
        });
    });
});
