// "target creature you don't control" — the "you don't control" controller
// qualifier of the object descriptor (issue #7221). CR 102.2: in a two-player
// game (ADR 0010) the player who isn't you is your opponent, so the qualifier
// reads exactly as "an opponent controls" does: `controller: "opponent"`.
//
// Two layers:
//
//  1. GOLDENS — the qualifier at the three sites the corpus prints it: a
//     second target beside a "you control" one (Prey Upon), an overload
//     spell's swept target (Electrickery), an activated ability's target
//     (Touchstone). Whole cards, whole Compiled Definitions.
//  2. REFUSALS — a neighbour the rule must NOT read: "of an opponent's choice
//     you don't control" (Volcanic Offering) names who CHOOSES the target, a
//     clause the descriptor has no reading for; the qualifier never lets the
//     line through by consuming its tail.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";

const PREY_UPON: OracleCard = {
    oracleId: "b3c12848-528d-4005-878f-4f950a07240a",
    name: "Prey Upon",
    manaCost: "{G}",
    typeLine: "Sorcery",
    oracleText:
        "Target creature you control fights target creature you don't control. (Each deals damage equal to its power to the other.)",
    layout: "normal",
};

const ELECTRICKERY: OracleCard = {
    oracleId: "99fd4b51-1698-4168-9366-a6ea2df22361",
    name: "Electrickery",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText:
        'Electrickery deals 1 damage to target creature you don\'t control.\nOverload {1}{R} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
    layout: "normal",
};

const TOUCHSTONE: OracleCard = {
    oracleId: "92382bdb-84cf-4456-8ca1-8a19badae7ad",
    name: "Touchstone",
    manaCost: "{2}",
    typeLine: "Artifact",
    oracleText: "{T}: Tap target artifact you don't control.",
    layout: "normal",
};

const VOLCANIC_OFFERING: OracleCard = {
    oracleId: "05e0a10d-532a-451c-a54e-27e64969fe0e",
    name: "Volcanic Offering",
    manaCost: "{4}{R}",
    typeLine: "Instant",
    oracleText:
        "Destroy target nonbasic land you don't control and target nonbasic land of an opponent's choice you don't control.\nVolcanic Offering deals 7 damage to target creature you don't control and 7 damage to target creature of an opponent's choice you don't control.",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe('"you don\'t control" descriptor qualifier (CR 102.2, issue #7221)', () => {
    it("Prey Upon: the second target is the opponent's, beside a 'you control' one", () => {
        expect(sortKeys(compiled(PREY_UPON))).toEqual(
            sortKeys({
                name: "Prey Upon",
                types: ["Sorcery"],
                manaCost: { G: 1 },
                oracleText: PREY_UPON.oracleText,
                effects: [
                    {
                        op: "fight",
                        creature: { target: 0 },
                        other: { target: 1 },
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "you",
                },
                additionalTargetRequirements: [
                    { type: "Creature", count: 1, controller: "opponent" },
                ],
            })
        );
    });

    it("Electrickery: the overload sweep's target set is the opponent's creatures", () => {
        expect(sortKeys(compiled(ELECTRICKERY))).toEqual(
            sortKeys({
                name: "Electrickery",
                types: ["Instant"],
                manaCost: { R: 1 },
                oracleText: ELECTRICKERY.oracleText,
                overload: {
                    id: "overload",
                    description: "Overload {1}{R}",
                    mana: { X: 1, R: 1 },
                },
                effects: [
                    {
                        op: "forEach",
                        select: { set: "targets" },
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 1,
                                to: { ref: "$each" },
                            },
                        ],
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    controller: "opponent",
                },
            })
        );
    });

    it("Touchstone: an activated ability's target reads the qualifier too", () => {
        expect(sortKeys(compiled(TOUCHSTONE))).toEqual(
            sortKeys({
                name: "Touchstone",
                types: ["Artifact"],
                manaCost: { X: 2 },
                oracleText: TOUCHSTONE.oracleText,
                activatedAbilities: [
                    {
                        id: "touchstone-ability",
                        oracleText: TOUCHSTONE.oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "tapUntap",
                                action: "tap",
                                target: { target: 0 },
                            },
                        ],
                        targetRequirement: {
                            type: "Artifact",
                            count: 1,
                            controller: "opponent",
                        },
                    },
                ],
            })
        );
    });

    it("refuses 'of an opponent's choice you don't control' (Volcanic Offering)", () => {
        const outcome = compileCard(VOLCANIC_OFFERING);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        // The descriptor itself is what refuses: "of an opponent's choice"
        // is the span no qualifier claims.
        expect(outcome.gaps.map((g) => g.attribution?.span)).toEqual([
            "nonbasic land of an opponent's choice you don't control",
            "creature you don't control and 7 damage to target creature of an opponent's choice you don't control",
        ]);
    });
});
