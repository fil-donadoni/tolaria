// "If you control a creature, damage that would reduce your life total to less
// than N reduces it to N instead." — the static clause frame (CR 614.1a +
// CR 120.4c): Worship.
//
//  1. GOLDEN — a real Oracle row (Worship) compiled whole.
//  2. REFUSALS — neighbours stay unparsed.
//  3. EXPANSION — `expandDefinition` rebuilds the declaration into one
//     `damage-lifeloss` replacement entry and removes it.

import { describe, expect, it } from "vitest";
import { expandDefinition } from "../../cards/registry";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const CLAUSE =
    "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.";

const WORSHIP = oracleCard({
    name: "Worship",
    manaCost: "{3}{W}",
    typeLine: "Enchantment",
    oracleText: CLAUSE,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

describe("damage life floor — golden (CR 614.1a)", () => {
    it("Worship: the declaration alone", () => {
        expect(sortKeys(compiled(WORSHIP))).toEqual(
            sortKeys({
                name: "Worship",
                types: ["Enchantment"],
                manaCost: { X: 3, W: 1 },
                oracleText: CLAUSE,
                damageLifeFloor: { floor: 1, whileControlling: "Creature" },
            })
        );
    });
});

describe("damage life floor — refusals (fail-closed neighbours)", () => {
    const refused: readonly [string, string][] = [
        [
            "an unconditional floor",
            "Damage that would reduce your life total to less than 1 reduces it to 1 instead.",
        ],
        [
            "a life-total condition",
            "As long as you have 5 or more life, damage that would reduce your life total to less than 1 reduces it to 1 instead.",
        ],
        [
            "a duration",
            "Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead.",
        ],
        [
            "mismatched numbers",
            "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 2 instead.",
        ],
        [
            "another permanent type",
            "If you control a land, damage that would reduce your life total to less than 1 reduces it to 1 instead.",
        ],
    ];

    it("control: the accepted sentence compiles ready", () => {
        expect(
            compileCard(oracleCard({ name: "Test Card", oracleText: CLAUSE }))
                .state
        ).toBe("ready");
    });

    for (const [why, text] of refused)
        it(`refuses ${why}`, () => {
            const outcome = compileCard(
                oracleCard({ name: "Test Card", oracleText: text })
            );
            expect(outcome.state).toBe("unparsed");
        });
});

describe("damage life floor — expansion", () => {
    it("rebuilds the declaration into one damage-lifeloss entry", () => {
        const expanded = expandDefinition({
            ...compiled(WORSHIP),
            id: "test-worship",
            rarity: "rare",
        });
        expect(expanded.damageLifeFloor).toBeUndefined();
        expect(
            expanded.replacementEffects!.map((r) => [r.id, r.eventKind])
        ).toEqual([["worship-damage-life-floor", "damage-lifeloss"]]);
    });
});
