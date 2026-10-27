// "copy this spell" behind a sacrificing player (CR 707.10, CR 707.10c,
// CR 701.21a, CR 118.12): the Chain of Vapor form.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const CHAIN_OF_VAPOR =
    "Return target nonland permanent to its owner's hand. Then that permanent's controller may sacrifice a land of their choice. If the player does, they may copy this spell and may choose a new target for that copy.";

function spell(oracleText: string) {
    return oracleCard({
        name: "Chain of Vapor",
        manaCost: "{U}",
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

describe("copy this spell behind a sacrifice (CR 707.10)", () => {
    it("golden: Chain of Vapor compiles to bounce + sacrifice mayPay + copy", () => {
        const outcome = compileCard(spell(CHAIN_OF_VAPOR));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(EXPECTED_DEFINITION())
        );
    });

    it("refuses 'If the player does' with no sacrifice before it", () => {
        const outcome = compileCard(
            spell(
                "Return target nonland permanent to its owner's hand. If the player does, they may copy this spell and may choose a new target for that copy."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a payoff other than the copy", () => {
        const outcome = compileCard(
            spell(
                "Return target nonland permanent to its owner's hand. Then that permanent's controller may sacrifice a land of their choice. If the player does, they draw a card."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});

function EXPECTED_DEFINITION(): unknown {
    const player = { ref: "$that1.controller" };
    return {
        effects: [
            {
                bind: "$that1",
                op: "moveZone",
                target: { target: 0 },
                to: "hand",
            },
            {
                bind: "$paid2",
                cost: {
                    permanent: {
                        action: "sacrifice",
                        count: 1,
                        filter: { types: "Land" },
                    },
                },
                op: "mayPay",
                player,
                prompt: "That permanent's controller may sacrifice a land of their choice?",
            },
            {
                op: "if",
                predicate: { binding: "$paid2" },
                then: [
                    {
                        bind: "$copy3",
                        op: "mayPay",
                        player,
                        prompt: "They may copy this spell and may choose a new target for that copy?",
                    },
                    {
                        op: "if",
                        predicate: { binding: "$copy3" },
                        then: [{ op: "copyResolvingSpell", player }],
                    },
                ],
            },
        ],
        manaCost: { U: 1 },
        name: "Chain of Vapor",
        oracleText: CHAIN_OF_VAPOR,
        targetRequirement: {
            count: 1,
            excludeTypes: ["Land"],
            type: [
                "Artifact",
                "Battle",
                "Creature",
                "Enchantment",
                "Land",
                "Planeswalker",
            ],
        },
        types: ["Instant"],
    };
}
