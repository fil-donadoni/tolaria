// The Monstrosity Verb Frame (CR 701.37a, issue #3217).
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition (`sortKeys` equality). Smoke-scenario generation
//     covers the `monstrosity` Op, so no `GOLDEN_FIXTURES` row is owed.
//  2. REFUSALS — the neighbours the frame does not read stay `unparsed`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const NESSIAN_ASP_TEXT =
    "Reach\n{6}{G}: Monstrosity 4. (If this creature isn't monstrous, put four +1/+1 counters on it and it becomes monstrous.)";

describe("monstrosity frame — golden (CR 701.37a)", () => {
    it('Nessian Asp: "{6}{G}: Monstrosity 4." acts on the ability\'s own source', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Nessian Asp",
                manaCost: "{4}{G}",
                typeLine: "Creature — Snake",
                oracleText: NESSIAN_ASP_TEXT,
                power: "4",
                toughness: "5",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Nessian Asp",
                types: ["Creature"],
                subtypes: ["Snake"],
                manaCost: { X: 4, G: 1 },
                power: 4,
                toughness: 5,
                oracleText: NESSIAN_ASP_TEXT,
                staticAbilities: ["reach"],
                activatedAbilities: [
                    {
                        id: "nessian-asp-ability",
                        oracleText: "{6}{G}: Monstrosity 4.",
                        cost: { mana: { X: 6, G: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "monstrosity",
                                target: { ref: "$source" },
                                count: 4,
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("monstrosity frame — refusals", () => {
    it('refuses "Monstrosity X" (CR 701.37c — its X is read elsewhere)', () => {
        const outcome = compileCard(
            oracleCard({
                oracleText: "{X}{X}{G}: Monstrosity X.",
                typeLine: "Creature — Hydra",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a spell's own text — only permanents become monstrous (CR 701.37b)", () => {
        const outcome = compileCard(
            oracleCard({
                oracleText: "Monstrosity 2.",
                typeLine: "Instant",
                manaCost: "{G}",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
