// Damage prevention and the flying damage sweep (issue #4590) — four Grammar
// Rules, one cluster:
//
//  - CR 615.1a — "Prevent all combat damage that would be dealt this turn."
//    (Fog): the game-wide combat shield, `preventDamage` mode "all-combat".
//  - CR 615.7 + CR 601.2d — "Prevent the next N damage that would be dealt
//    this turn to any number of targets, divided as you choose." (Remedy):
//    ONE announced group carrying the budget, mode "next-n-divided".
//  - CR 120.3 + CR 702.9a — "<self> deals N damage to each creature with
//    flying [and each player]" (Needle Storm, Hurricane): the requirement twin
//    of Earthquake's "without flying", the sweep filter's `hasAbility`.
//  - CR 702.33e — the spell-site "If this spell was kicked, … instead": a
//    damage sweep replaced by one over the same recipients (Canopy Surge), and
//    a divided shield whose budget the kicker replaces (Pollen Remedy, the
//    budget swapped into `kickedTargetRequirement`).
//
// Two layers: GOLDENS, one per accepted form (the three whose smoke skips are
// card-dependent are `GOLDEN_FIXTURES` rows, asserted here to reach `ready`),
// and REFUSALS, one per neighbour the rules must not read.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const FOG: OracleCard = {
    oracleId: "27e9db49-7af7-4bef-ad4c-bf5dfb92030d",
    name: "Fog",
    manaCost: "{G}",
    typeLine: "Instant",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    layout: "normal",
};

const REMEDY: OracleCard = {
    oracleId: "c644f190-63e5-4496-8612-bbe7be91afc9",
    name: "Remedy",
    manaCost: "{1}{W}",
    typeLine: "Instant",
    oracleText:
        "Prevent the next 5 damage that would be dealt this turn to any number of targets, divided as you choose.",
    layout: "normal",
};

const NEEDLE_STORM: OracleCard = {
    oracleId: "1f513d1e-03ca-4e0f-af48-6490d71d5c41",
    name: "Needle Storm",
    manaCost: "{2}{G}",
    typeLine: "Sorcery",
    oracleText: "Needle Storm deals 4 damage to each creature with flying.",
    layout: "normal",
};

const FLYING_CREATURES = {
    set: "permanents",
    zone: "battlefield",
    filter: { type: "Creature", hasAbility: "flying" },
} as const;

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function fixture(name: string) {
    const row = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (row === undefined) throw new Error(`no golden fixture for ${name}`);
    return row;
}

/** A probe whose Oracle text is exactly `oracleText` — a neighbour form, so
 *  the refusal is pinned by a synthetic line. */
function probe(typeLine: string, oracleText: string) {
    return oracleCard({
        name: "Refusal Probe",
        manaCost: "{1}{G}",
        typeLine,
        oracleText,
    });
}

describe("damage prevention and the flying sweep — goldens", () => {
    it("CR 615.1a: Fog prevents all combat damage this turn", () => {
        expect(sortKeys(compiled(FOG))).toEqual(
            sortKeys({
                name: "Fog",
                types: ["Instant"],
                manaCost: { G: 1 },
                oracleText:
                    "Prevent all combat damage that would be dealt this turn.",
                effects: [{ op: "preventDamage", mode: "all-combat" }],
            })
        );
        expect(compileCard(FOG).state).toBe("ready");
    });

    it("CR 601.2d: Remedy divides a 5-point shield among any number of targets", () => {
        expect(sortKeys(compiled(REMEDY))).toEqual(
            sortKeys({
                name: "Remedy",
                types: ["Instant"],
                manaCost: { X: 1, W: 1 },
                oracleText:
                    "Prevent the next 5 damage that would be dealt this turn to any number of targets, divided as you choose.",
                targetRequirement: {
                    type: "any",
                    count: { min: 1 },
                    divideAsChosen: { total: 5, kind: "prevent" },
                },
                effects: [
                    {
                        op: "preventDamage",
                        mode: "next-n-divided",
                        total: 5,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            })
        );
        expect(compileCard(REMEDY).state).toBe("ready");
    });

    it("CR 702.9a: Needle Storm deals 4 to each creature with flying", () => {
        expect(sortKeys(compiled(NEEDLE_STORM))).toEqual(
            sortKeys({
                name: "Needle Storm",
                types: ["Sorcery"],
                manaCost: { X: 2, G: 1 },
                oracleText:
                    "Needle Storm deals 4 damage to each creature with flying.",
                effects: [
                    {
                        op: "forEach",
                        select: FLYING_CREATURES,
                        effects: [
                            {
                                op: "dealDamage",
                                amount: 4,
                                to: { ref: "$each" },
                            },
                        ],
                    },
                ],
            })
        );
        expect(compileCard(NEEDLE_STORM).state).toBe("ready");
    });

    for (const name of ["Hurricane", "Canopy Surge", "Pollen Remedy"]) {
        it(`${name}: the golden fixture compiles to its expected definition and reaches ready`, () => {
            const row = fixture(name);
            expect(sortKeys(compiled(row.card))).toEqual(
                sortKeys(row.expected)
            );
            expect(compileCard(row.card).state).toBe("ready");
        });
    }
});

describe("damage prevention and the flying sweep — refusals stay fail-closed", () => {
    const refused: readonly [string, string, string][] = [
        [
            "all damage, not combat damage, is another shield",
            "Instant",
            "Prevent all damage that would be dealt this turn.",
        ],
        [
            "the combat shield's duration is 'this turn' only",
            "Instant",
            "Prevent all combat damage that would be dealt until end of turn.",
        ],
        [
            "a divided shield's budget is printed digits, not X",
            "Instant",
            "Prevent the next X damage that would be dealt this turn to any number of targets, divided as you choose.",
        ],
        [
            "a divided shield is read over 'any number of targets' only",
            "Instant",
            "Prevent the next 3 damage that would be dealt this turn to any number of target creatures, divided as you choose.",
        ],
        [
            "a second qualifier beside 'with flying' is refused",
            "Sorcery",
            "Refusal Probe deals 2 damage to each white creature with flying.",
        ],
        [
            "'with flying' is read by the damage sweep only, not by destroy",
            "Sorcery",
            "Destroy all creatures with flying.",
        ],
        [
            "a kicked replacement over different recipients is refused",
            "Sorcery",
            "Kicker {2}\nRefusal Probe deals 1 damage to each creature with flying and each player. If this spell was kicked, it deals 4 damage to each creature without flying and each player instead.",
        ],
        [
            "a kicked replacement of a single target is refused",
            "Sorcery",
            "Kicker {2}\nRefusal Probe deals 1 damage to any target. If this spell was kicked, it deals 4 damage to any target instead.",
        ],
        [
            "'this way' re-budgets a divided shield only",
            "Instant",
            "Kicker {2}\nPrevent the next 3 damage that would be dealt to any target this turn. If this spell was kicked, prevent the next 6 damage this way instead.",
        ],
    ];
    for (const [why, typeLine, text] of refused) {
        it(why, () => {
            expect(compileCard(probe(typeLine, text)).state).toBe("unparsed");
        });
    }
});
