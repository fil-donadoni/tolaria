// "Sacrifice another <permanent>" activation cost (CR 109.2, 602.1a).
//
// 1. GOLDEN — real Oracle rows compiled whole: Hungry Ghoul (one card type)
//    and Thraxodemon (a type pair beside {T}). "another" is "an other": one
//    permanent, the source excluded through `PermanentFilter.excludeSource`.
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

const GHOUL_TEXT =
    "{1}, Sacrifice another creature: Put a +1/+1 counter on this creature.";
const THRAXODEMON_TEXT =
    "{3}, {T}, Sacrifice another creature or artifact: Draw a card.";

function creature(name: string, typeLine: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{1}{B}",
        typeLine,
        power: "2",
        toughness: "2",
        oracleText,
    });
}

describe("Sacrifice-another cost — golden (CR 109.2)", () => {
    it("Hungry Ghoul: sacrificeFilter excluding the source", () => {
        const outcome = compileCard(
            creature("Hungry Ghoul", "Creature — Zombie", GHOUL_TEXT)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Hungry Ghoul",
            types: ["Creature"],
            subtypes: ["Zombie"],
            manaCost: { X: 1, B: 1 },
            power: 2,
            toughness: 2,
            oracleText: GHOUL_TEXT,
            activatedAbilities: [
                {
                    id: "hungry-ghoul-ability",
                    oracleText: GHOUL_TEXT,
                    cost: {
                        mana: { X: 1 },
                        sacrificeFilter: {
                            types: ["Creature"],
                            excludeSource: true,
                        },
                    },
                    useStack: true,
                    effects: [
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
        });
    });

    it("Thraxodemon: a two-type filter beside {T}", () => {
        const outcome = compileCard(
            creature("Thraxodemon", "Creature — Demon", THRAXODEMON_TEXT)
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Thraxodemon",
            types: ["Creature"],
            subtypes: ["Demon"],
            manaCost: { X: 1, B: 1 },
            power: 2,
            toughness: 2,
            oracleText: THRAXODEMON_TEXT,
            activatedAbilities: [
                {
                    id: "thraxodemon-ability",
                    oracleText: THRAXODEMON_TEXT,
                    cost: {
                        mana: { X: 3 },
                        tap: true,
                        sacrificeFilter: {
                            types: ["Creature", "Artifact"],
                            excludeSource: true,
                        },
                    },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        });
    });
});

describe("Sacrifice-another cost — refusals", () => {
    it.each([
        // "another" is ONE permanent: a count beside it is a misread line.
        "Sacrifice another two creatures",
        // A token kind beside the type is its own gap key.
        "Sacrifice another creature or a Treasure",
        "Sacrifice another",
    ])("refuses %s", (span) => {
        expect(
            activationCostRule.run(
                span,
                parseContext(creature("Hungry Ghoul", "Creature — Zombie", ""))
            ).ok
        ).toBe(false);
    });

    it("refuses another creature as a spell's additional cost (excludeSource has no cast-path pick)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Probe",
                manaCost: "{B}",
                typeLine: "Sorcery",
                oracleText:
                    "As an additional cost to cast this spell, sacrifice another creature.\nDraw two cards.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
