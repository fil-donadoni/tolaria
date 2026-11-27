// "Its controller loses N life" after a removal of the one announced target
// (CR 109.4, CR 608.2h): the loser is the controller read off the snapshot the
// removal took (`$that1.controller`). Golden fixture: Hideous End
// (`GOLDEN_FIXTURES`, clears the `loseLife` ref-player smoke form).
//
//  1. GOLDENS — a bounce (Vapor Snag) and a destroy with a drain tail
//     (Certain Death); the destroy alone is Hideous End's fixture.
//  2. REFUSALS — a COUNTERED spell (Undermine): `counter` binds no snapshot,
//     so there is no controller to read once the spell has left the stack;
//     and the gain, which no corpus card prints after a printed number.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";

describe("acted-on controller loses life — goldens (CR 109.4)", () => {
    it("Vapor Snag — a bounce snapshots the controller", () => {
        const outcome = compileCard({
            oracleId: "a1408bae-ed5f-4837-a1a7-438dc30a2786",
            name: "Vapor Snag",
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText:
                "Return target creature to its owner's hand. Its controller loses 1 life.",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Vapor Snag",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText:
                    "Return target creature to its owner's hand. Its controller loses 1 life.",
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "hand",
                        bind: "$that1",
                    },
                    {
                        op: "loseLife",
                        player: { ref: "$that1.controller" },
                        amount: 1,
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
    it("Certain Death — a destroy, then a drain tail", () => {
        const outcome = compileCard({
            oracleId: "1d4b8a31-6500-4e3d-bcaf-f6f184d7743e",
            name: "Certain Death",
            manaCost: "{5}{B}",
            typeLine: "Sorcery",
            oracleText:
                "Destroy target creature. Its controller loses 2 life and you gain 2 life.",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Certain Death",
                types: ["Sorcery"],
                manaCost: { X: 5, B: 1 },
                oracleText:
                    "Destroy target creature. Its controller loses 2 life and you gain 2 life.",
                effects: [
                    { op: "destroy", target: { target: 0 }, bind: "$that1" },
                    {
                        op: "loseLife",
                        player: { ref: "$that1.controller" },
                        amount: 2,
                    },
                    { op: "gainLife", player: "controller", amount: 2 },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
});

describe("acted-on controller loses life — refused neighbours", () => {
    it("Undermine: a countered spell leaves no snapshot to read", () => {
        const outcome = compileCard({
            oracleId: "6bcfe240-c165-49f2-a90a-be05c05498a1",
            name: "Undermine",
            manaCost: "{U}{U}{B}",
            typeLine: "Instant",
            oracleText: "Counter target spell. Its controller loses 3 life.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(
                /names no single object announced and acted on/
            )
        );
    });
    it("a printed gain is not read", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Instant",
            oracleText: "Destroy target creature. Its controller gains 2 life.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/no slot consumed/)
        );
    });
});
