// "Sacrifice this enchantment" — the source's own sacrifice (CR 701.21a), with
// the optional "If you do" gate behind it (CR 608.2c).
//
//  1. GOLDEN forms — one real corpus card per accepted form, compiled whole:
//     the bare imperative (Dress Down) and the gated pair (Standstill), whose
//     opponents-of-the-caster draw reads the spell-cast head's player.
//  2. REFUSALS — printed neighbours the rule must NOT read as the source: an
//     edict over a chosen permanent (the controller's pick, since the
//     `sacrifice` Verb Frame of issue #6630), and an "If you do" with no
//     sacrifice before it.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function enchantment(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{1}{U}",
        typeLine: "Enchantment",
        oracleText,
    });
}

function triggers(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.compiledTriggeredAbilities;
}

describe("sacrifice the source (CR 701.21a)", () => {
    it("reads the bare imperative behind a step head (Dress Down)", () => {
        const oracle =
            "At the beginning of the end step, sacrifice this enchantment.";
        expect(triggers(enchantment("Dress Down", oracle))).toEqual([
            {
                id: "dress-down-trigger",
                oracleText: oracle,
                head: { kind: "phase", phase: "END_STEP", scope: "each" },
                effects: [{ op: "sacrifice", target: { ref: "$source" } }],
            },
        ]);
    });

    it('gates the follow-up on "If you do" (CR 608.2c, Standstill)', () => {
        const oracle =
            "When a player casts a spell, sacrifice this enchantment. If you do, each of that player's opponents draws three cards.";
        expect(triggers(enchantment("Standstill", oracle))).toEqual([
            {
                id: "standstill-trigger",
                oracleText: oracle,
                head: { kind: "spell-cast", scope: "any" },
                effects: [
                    {
                        op: "sacrifice",
                        target: { ref: "$source" },
                        bind: "$sacrificed1",
                    },
                    {
                        op: "if",
                        predicate: {
                            boundMatchesFilter: { ref: "$sacrificed1" },
                            filter: {},
                        },
                        then: [
                            {
                                op: "draw",
                                player: {
                                    opponentOf: { ref: "$event.caster" },
                                },
                                count: 3,
                            },
                        ],
                    },
                ],
            },
        ]);
    });
});

describe("sacrifice the source — refusals", () => {
    it("a chosen permanent is not the source: the imperative edict is the `sacrifice` frame's own form (issue #6630), the controller's pick", () => {
        const abilities = triggers(
            enchantment(
                "Edict",
                "At the beginning of the end step, sacrifice a creature."
            )
        );
        expect(abilities?.[0]?.effects).toEqual([
            {
                op: "choice",
                kind: "sacrifice-permanents",
                player: "controller",
                zone: "battlefield",
                filter: { type: "Creature" },
                count: 1,
                prompt: "Sacrifice a creature.",
                bind: "$sacrifice1",
            },
            { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
        ]);
    });

    it('refuses an "If you do" that follows no sacrifice', () => {
        const outcome = compileCard(
            enchantment(
                "Orphan",
                "At the beginning of the end step, draw a card. If you do, each opponent draws a card."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('refuses "that player\'s opponents" behind a head naming no player', () => {
        const outcome = compileCard(
            enchantment(
                "Nameless",
                "At the beginning of your upkeep, each of that player's opponents draws a card."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
