// Reanimation — "Return target <card> from your graveyard to the battlefield"
// (CR 400.7, CR 110.2a, CR 404.1, issue #4299). `lowerMoveZone` reads the
// battlefield as a destination for exactly ONE source: a single target in YOUR
// graveyard, the sentence itself naming the zone it leaves.
//
// Two layers:
//
//  1. GOLDENS — one per accepted form, each a real corpus row: a spell
//     (Zombify), a triggered "you may" with a mana-value filter (Bishop of
//     Rebirth), an activated ability with a sacrifice cost and sorcery timing
//     (Bonecaller Cleric).
//  2. REFUSALS — the neighbours the rule must NOT read: a graveyard that is not
//     yours, a count above one, a source that is not a graveyard, a
//     destination modifier ("tapped") and an unnamed source zone.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const ZOMBIFY: OracleCard = {
    oracleId: "bb95db4d-5017-4121-bf79-d68476602d8c",
    name: "Zombify",
    manaCost: "{3}{B}",
    typeLine: "Sorcery",
    oracleText:
        "Return target creature card from your graveyard to the battlefield.",
    layout: "normal",
};

const BISHOP_OF_REBIRTH: OracleCard = {
    oracleId: "05058594-608f-4046-bf44-b736a7072f0a",
    name: "Bishop of Rebirth",
    manaCost: "{3}{W}{W}",
    typeLine: "Creature — Vampire Cleric",
    oracleText:
        "Vigilance\nWhenever this creature attacks, you may return target creature card with mana value 3 or less from your graveyard to the battlefield.",
    power: "3",
    toughness: "4",
    layout: "normal",
};

const BONECALLER_CLERIC: OracleCard = {
    oracleId: "fe8d2874-c626-4d4e-a7f5-11c175a2b3bb",
    name: "Bonecaller Cleric",
    manaCost: "{1}{B}",
    typeLine: "Creature — Human Cleric",
    oracleText:
        "{3}{B}, Sacrifice this creature: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.",
    power: "2",
    toughness: "1",
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

/** A sorcery whose Oracle text is exactly `oracleText`. */
function sorcery(oracleText: string) {
    return oracleCard({
        name: "Reanimation Probe",
        manaCost: "{3}{B}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("reanimation — goldens (CR 400.7, CR 110.2a)", () => {
    it("Zombify: a spell returning one creature card from your graveyard", () => {
        expect(sortKeys(compiled(ZOMBIFY))).toEqual(
            sortKeys({
                name: "Zombify",
                types: ["Sorcery"],
                manaCost: { X: 3, B: 1 },
                oracleText:
                    "Return target creature card from your graveyard to the battlefield.",
                effects: [
                    {
                        op: "moveZone",
                        target: { target: 0 },
                        to: "battlefield",
                    },
                ],
                targetRequirement: {
                    type: "Creature",
                    count: 1,
                    zone: "graveyard",
                    controller: "you",
                },
            })
        );
    });

    it("Bishop of Rebirth: a triggered 'you may' with a mana-value filter", () => {
        expect(sortKeys(compiled(BISHOP_OF_REBIRTH))).toEqual(
            sortKeys({
                name: "Bishop of Rebirth",
                types: ["Creature"],
                subtypes: ["Vampire", "Cleric"],
                manaCost: { X: 3, W: 2 },
                power: 3,
                toughness: 4,
                oracleText:
                    "Vigilance\nWhenever this creature attacks, you may return target creature card with mana value 3 or less from your graveyard to the battlefield.",
                staticAbilities: ["vigilance"],
                compiledTriggeredAbilities: [
                    {
                        id: "bishop-of-rebirth-trigger",
                        oracleText:
                            "Whenever this creature attacks, you may return target creature card with mana value 3 or less from your graveyard to the battlefield.",
                        head: { kind: "attacks" },
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            mvFilter: { max: 3 },
                            zone: "graveyard",
                            controller: "you",
                        },
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Return target creature card with mana value 3 or less from your graveyard to the battlefield?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "moveZone",
                                        target: { target: 0 },
                                        to: "battlefield",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Bonecaller Cleric: an activated ability with a sacrifice cost, sorcery timing", () => {
        expect(sortKeys(compiled(BONECALLER_CLERIC))).toEqual(
            sortKeys({
                name: "Bonecaller Cleric",
                types: ["Creature"],
                subtypes: ["Human", "Cleric"],
                manaCost: { X: 1, B: 1 },
                power: 2,
                toughness: 1,
                oracleText:
                    "{3}{B}, Sacrifice this creature: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.",
                activatedAbilities: [
                    {
                        id: "bonecaller-cleric-ability",
                        oracleText:
                            "{3}{B}, Sacrifice this creature: Return target creature card from your graveyard to the battlefield. Activate only as a sorcery.",
                        cost: { mana: { X: 3, B: 1 }, sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "moveZone",
                                target: { target: 0 },
                                to: "battlefield",
                            },
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            zone: "graveyard",
                            controller: "you",
                        },
                        sorcerySpeedOnly: true,
                    },
                ],
            })
        );
    });
});

describe("reanimation — refusals (fail-closed neighbours)", () => {
    const BATTLEFIELD_REFUSAL =
        '"battlefield" is not a zone destination in grammar v0';

    // Each of these reaches `lowerMoveZone` and is refused THERE, by one guard
    // of the `reanimated` predicate — the reason is asserted, not just the state,
    // so a refusal that passes for an unrelated reason cannot pass here.
    const REFUSED_BY_PREDICATE: [string, string][] = [
        [
            "a graveyard that is not yours",
            "Return target creature card from a graveyard to the battlefield.",
        ],
        [
            "more than one target (the cards would enter together)",
            "Return up to two target creature cards from your graveyard to the battlefield.",
        ],
        [
            "a battlefield permanent you control (no zone change to name)",
            "Return target creature you control to the battlefield.",
        ],
        [
            "a battlefield permanent named without a zone",
            "Return target permanent to the battlefield.",
        ],
        [
            "a compound type noun (a type LIST is an OR to the engine)",
            "Return target artifact creature card from your graveyard to the battlefield.",
        ],
        [
            "any card (a card that cannot enter the battlefield)",
            "Return target card from your graveyard to the battlefield.",
        ],
        [
            "an instant card (cannot enter the battlefield)",
            "Return target instant card from your graveyard to the battlefield.",
        ],
    ];

    for (const [label, line] of REFUSED_BY_PREDICATE)
        it(`refuses ${label}`, () => {
            const outcome = compileCard(sorcery(line));
            expect(outcome.state).toBe("unparsed");
            if (outcome.state !== "unparsed") return;
            expect(outcome.gaps.map((gap) => gap.reason)).toContain(
                BATTLEFIELD_REFUSAL
            );
        });

    // These never reach the lowering: the parse refuses them earlier, so they
    // pin only that no slot reads the neighbour, not the predicate.
    const REFUSED_BY_PARSE: [string, string][] = [
        [
            "an opponent's graveyard",
            "Return target creature card from an opponent's graveyard to the battlefield.",
        ],
        [
            "a source that is not a graveyard",
            "Return target creature card from your hand to the battlefield.",
        ],
        [
            "a destination modifier the Op cannot carry",
            "Return target creature card from your graveyard to the battlefield tapped.",
        ],
    ];

    for (const [label, line] of REFUSED_BY_PARSE)
        it(`no slot reads ${label}`, () => {
            expect(compileCard(sorcery(line)).state).toBe("unparsed");
        });
});
