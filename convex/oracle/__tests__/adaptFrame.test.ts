// The Adapt Verb Frame (CR 701.46a, issue #8654).
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition (`sortKeys` equality). The smoke generator cannot
//     size the `if`'s runtime counter-count operand, so the same card is
//     also the `GOLDEN_FIXTURES` row that clears the form's quarantine.
//  2. REFUSALS — the neighbours the frame does not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const AEROMUNCULUS_TEXT =
    "Flying\n{2}{G}{U}: Adapt 1. (If this creature has no +1/+1 counters on it, put a +1/+1 counter on it.)";

describe("adapt frame — golden (CR 701.46a)", () => {
    it('Aeromunculus: "{2}{G}{U}: Adapt 1." counts and adds counters on the ability\'s own source', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Aeromunculus",
                manaCost: "{1}{G}{U}",
                typeLine: "Creature — Homunculus Mutant",
                oracleText: AEROMUNCULUS_TEXT,
                power: "2",
                toughness: "3",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Aeromunculus",
                types: ["Creature"],
                subtypes: ["Homunculus", "Mutant"],
                manaCost: { X: 1, G: 1, U: 1 },
                power: 2,
                toughness: 3,
                oracleText: AEROMUNCULUS_TEXT,
                staticAbilities: ["flying"],
                activatedAbilities: [
                    {
                        id: "aeromunculus-ability",
                        oracleText: "{2}{G}{U}: Adapt 1.",
                        cost: { mana: { X: 2, G: 1, U: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "if",
                                predicate: {
                                    left: {
                                        counters: {
                                            of: { ref: "$source" },
                                            type: "+1/+1",
                                        },
                                    },
                                    op: "lt",
                                    right: 1,
                                },
                                then: [
                                    {
                                        op: "counters",
                                        action: "add",
                                        counter: "+1/+1",
                                        target: { ref: "$source" },
                                        count: 1,
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("adapt frame — refusals", () => {
    it('refuses "Adapt X" — only a printed count is read', () => {
        const outcome = compileCard(
            oracleCard({
                oracleText: "{X}{G}: Adapt X.",
                typeLine: "Creature — Hydra",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a spell's own text — only a permanent can adapt (CR 701.46a)", () => {
        const outcome = compileCard(
            oracleCard({
                oracleText: "Adapt 2.",
                typeLine: "Instant",
                manaCost: "{G}",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
