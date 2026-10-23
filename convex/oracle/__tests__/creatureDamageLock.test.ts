// Creature-conditional damage lock rider (CR 615.12 + CR 614.9, issue #6408):
// "{self} deals X damage to any target. If {self} would deal damage to a
// creature, that damage can't be prevented or dealt instead to another
// permanent or player." lowers to an `if` over the live target.
//
// Layers: a GOLDEN for the real card (Lava Burst), REFUSALS for each
// neighbour (half rider, non-creature condition, other source, orphan rider).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const RIDER =
    "If Lava Burst would deal damage to a creature, that damage can't be prevented or dealt instead to another permanent or player.";
const DEAL = "Lava Burst deals X damage to any target.";

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Lava Burst",
        manaCost: "{X}{R}",
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("creature damage lock rider", () => {
    it("Lava Burst lowers to if + locked dealDamage (CR 615.12, CR 614.9)", () => {
        const outcome = compileCard(sorcery(`${DEAL} ${RIDER}`));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        const def = outcome.definition as unknown as {
            targetRequirement: unknown;
            effects: unknown;
        };
        expect(sortKeys(def.targetRequirement)).toEqual(
            sortKeys({ type: "any", count: 1 })
        );
        expect(sortKeys(def.effects)).toEqual(
            sortKeys([
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: { target: 0 },
                        filter: { type: "Creature" },
                    },
                    then: [
                        {
                            op: "dealDamage",
                            amount: { X: true },
                            to: { target: 0 },
                            unpreventable: true,
                            unredirectable: true,
                        },
                    ],
                    else: [
                        {
                            op: "dealDamage",
                            amount: { X: true },
                            to: { target: 0 },
                        },
                    ],
                },
            ])
        );
    });

    it.each([
        [
            "a half rider (can't be prevented alone)",
            `${DEAL} If Lava Burst would deal damage to a creature, that damage can't be prevented.`,
        ],
        [
            "a non-creature condition",
            `${DEAL} If Lava Burst would deal damage to a player, that damage can't be prevented or dealt instead to another permanent or player.`,
        ],
        [
            "a rider whose subject is a different source",
            `${DEAL} If a red source would deal damage to a creature, that damage can't be prevented or dealt instead to another permanent or player.`,
        ],
        ["a rider with no damage sentence before it", RIDER],
    ])("refuses %s", (_form, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});
