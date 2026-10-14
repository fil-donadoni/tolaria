// "That <noun> deals damage equal to its mana value to <recipient>" — the
// object an EARLIER sentence acted on as the damage SOURCE (CR 120.1 + CR
// 608.2h, issue #4572): `dealDamage.source` pointed at the acting Op's `bind`
// snapshot, whose mana value is the amount.
//
//  1. GOLDEN — Goblin Tinkerer, equal to its hand-written definition.
//  2. REFUSALS — "its power" (Tracker; the pattern is pinned to mana value)
//     and a noun that is not what was acted on.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const TINKERER_LINE =
    "{R}, {T}: Destroy target artifact. That artifact deals damage equal to its mana value to this creature.";

describe("acted-on damage dealer (CR 120.1 + CR 608.2h)", () => {
    it("golden — Goblin Tinkerer: the destroyed artifact deals its mana value to this creature", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "0afc2d2f-4fdb-440f-9c35-45bf103c0437",
                name: "Goblin Tinkerer",
                manaCost: "{1}{R}",
                typeLine: "Creature — Goblin Artificer",
                oracleText: TINKERER_LINE,
                power: "1",
                toughness: "2",
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Goblin Tinkerer",
                types: ["Creature"],
                subtypes: ["Goblin", "Artificer"],
                manaCost: { X: 1, R: 1 },
                power: 1,
                toughness: 2,
                oracleText: TINKERER_LINE,
                activatedAbilities: [
                    {
                        id: "goblin-tinkerer-ability",
                        oracleText: TINKERER_LINE,
                        cost: { mana: { R: 1 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "destroy",
                                target: { target: 0 },
                                bind: "$that1",
                            },
                            {
                                op: "dealDamage",
                                amount: { ref: "$that1.manaValue" },
                                to: { ref: "$source" },
                                source: { ref: "$that1" },
                            },
                        ],
                        targetRequirement: { type: "Artifact", count: 1 },
                    },
                ],
            })
        );
    });

    it('refuses "its power" — the pattern is pinned to mana value (Tracker)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Tracker",
                manaCost: "{2}{G}",
                typeLine: "Creature — Human",
                oracleText:
                    "{G}{G}, {T}: This creature deals damage equal to its power to target creature. That creature deals damage equal to its power to this creature.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a dealer noun that is not the object acted on", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Tinkerer",
                manaCost: "{1}{R}",
                typeLine: "Creature — Goblin",
                oracleText:
                    "{R}, {T}: Destroy target artifact. That creature deals damage equal to its mana value to this creature.",
                power: "1",
                toughness: "2",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(
            /is not the "Artifact" acted on/
        );
    });
});
