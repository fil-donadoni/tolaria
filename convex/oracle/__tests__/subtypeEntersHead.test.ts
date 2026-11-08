// Land-subtype enters head (issue #8587): "whenever a Forest you control
// enters" (CR 603.6a + CR 205.3i).
//
//  1. GOLDEN — Reach of Branches, a real corpus card, compiled whole: the
//     head narrows the entering permanent by its land SUBTYPE, and the
//     "return this card from your graveyard" body puts the ability in the
//     graveyard zone.
//  2. REFUSALS — neighbours the head must NOT read: another land type, no
//     controller, an opponent's Forest, a plain "land".

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const REACH_TEXT =
    "Create a 2/5 green Treefolk Shaman creature token.\nWhenever a Forest you control enters, you may return this card from your graveyard to your hand.";

const reachOfBranches = () =>
    oracleCard({
        name: "Reach of Branches",
        manaCost: "{4}{G}",
        typeLine: "Kindred Instant — Treefolk",
        oracleText: REACH_TEXT,
    });

describe("land-subtype enters head — golden (issue #8587)", () => {
    it("Reach of Branches compiles whole, the head filtered on the Forest subtype", () => {
        const outcome = compileCard(reachOfBranches());
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Reach of Branches",
                types: ["Kindred", "Instant"],
                subtypes: ["Treefolk"],
                manaCost: { X: 4, G: 1 },
                oracleText: REACH_TEXT,
                compiledTriggeredAbilities: [
                    {
                        id: "reach-of-branches-trigger",
                        oracleText:
                            "Whenever a Forest you control enters, you may return this card from your graveyard to your hand.",
                        head: {
                            kind: "entered",
                            scope: "yours",
                            filter: { subtypes: ["Forest"] },
                        },
                        zone: "graveyard",
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Return this card from your graveyard to your hand?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "moveZone",
                                        target: { ref: "$source" },
                                        to: "hand",
                                    },
                                ],
                            },
                        ],
                    },
                ],
                effects: [
                    {
                        op: "createToken",
                        token: {
                            name: "Treefolk Shaman",
                            types: ["Creature"],
                            subtypes: ["Treefolk", "Shaman"],
                            power: 2,
                            toughness: 5,
                            colors: ["G"],
                        },
                        controller: "controller",
                    },
                ],
            })
        );
    });
});

describe("land-subtype enters head — refusals", () => {
    it.each([
        ["another land type", "Whenever an Island you control enters"],
        ["no controller", "Whenever a Forest enters"],
        [
            "an opponent's Forest",
            "Whenever a Forest an opponent controls enters",
        ],
        ["another Forest", "Whenever another Forest you control enters"],
        ["a plural subject", "Whenever one or more Forests you control enter"],
    ])("%s is not read", (_label, head) => {
        expect(
            compileCard(
                oracleCard({
                    name: "Test Treefolk",
                    manaCost: "{1}{G}",
                    typeLine: "Creature — Treefolk",
                    oracleText: `${head}, draw a card.`,
                    power: "2",
                    toughness: "2",
                })
            ).state
        ).toBe("unparsed");
    });
});
