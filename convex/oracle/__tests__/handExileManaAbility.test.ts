// "Exile this card from your hand: Add {G}." — a mana ability that functions
// only in the hand (CR 113.6m, CR 605.1a; issue #5326).
//
//  1. GOLDEN fixtures — the two corpus Spirit Guides compile whole to a
//     stackless `activateFromHand` ability whose cost is `exileThis` and whose
//     output is a fixed `manaProduced`.
//  2. REFUSALS — the neighbours the rule must not read: the Masked Bandits
//     cycle (a stack ability activated from the hand), a hand cost beside a
//     tap, a chosen colour from the hand, and a battlefield self-exile on the
//     no-tap mana route.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function creature(name: string, manaCost: string, oracleText: string) {
    return oracleCard({ name, manaCost, oracleText, typeLine: "Creature" });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("hand-exile mana ability — golden fixtures (CR 113.6m / 605.1a)", () => {
    it.each([
        ["Elvish Spirit Guide", "{2}{G}", "Elf Spirit", "elvish", "G"],
        ["Simian Spirit Guide", "{2}{R}", "Ape Spirit", "simian", "R"],
    ] as const)("%s", (name, manaCost, subtypes, slug, color) => {
        const oracleText = `Exile this card from your hand: Add {${color}}.`;
        const definition = compiled(
            oracleCard({
                name,
                manaCost,
                typeLine: `Creature — ${subtypes}`,
                oracleText,
                power: "2",
                toughness: "2",
            })
        );
        expect(sortKeys(definition)).toEqual(
            sortKeys({
                name,
                types: ["Creature"],
                subtypes: subtypes.split(" "),
                manaCost: { X: 2, [color]: 1 },
                power: 2,
                toughness: 2,
                oracleText,
                activatedAbilities: [
                    {
                        id: `${slug}-spirit-guide-mana`,
                        oracleText,
                        cost: { exileThis: true },
                        useStack: false,
                        activateFromHand: true,
                        manaProduced: { [color]: 1 },
                    },
                ],
            })
        );
    });
});

describe("hand-exile mana ability — refusals (fail-closed)", () => {
    it.each([
        [
            "a stack ability activated from the hand (Masked Bandits — the granted land ability and cast-from-exile permission)",
            '{2}, Exile this card from your hand: Target land gains "{T}: Add {B}, {R}, or {G}" until this card is cast from exile. You may cast this card for as long as it remains exiled.',
        ],
        [
            "a stack ability activated from the hand with an effect the grammar reads",
            "Exile this card from your hand: Draw a card.",
        ],
        [
            "a tap leg beside the hand cost (a card in hand has no {T} to pay)",
            "{T}, Exile this card from your hand: Add {G}.",
        ],
        [
            "a chosen colour from the hand (no fixed production to deposit)",
            "Exile this card from your hand: Add one mana of any color.",
        ],
        [
            "a battlefield self-exile on the no-tap mana route",
            "Exile this creature: Add {G}.",
        ],
    ])("%s is refused", (_label, oracleText) => {
        const outcome = compileCard(
            creature("Hand Exile Neighbour", "{2}{G}", oracleText)
        );
        expect(outcome.state).toBe("unparsed");
    });
});
