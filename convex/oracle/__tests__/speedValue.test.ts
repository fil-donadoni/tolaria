// Speed read as a NUMBER (CR 702.179f): "where X is your speed", "life equal
// to your speed", and "cost {X} less to cast, where X is your speed".
//
//  1. GOLDEN — The Speed Demon compiled whole, `ready`.
//  2. REAL ROWS — the corpus cards whose speed line now reads, though another
//     line of theirs is still unparsed: the speed line is not among the gaps.
//  3. REFUSALS — the neighbours with no fixture: an X nobody prints, a tax,
//     another player's speed.
//
// The engine read (`speedOf` at resolution, and per cost determination) is
// `convex/gre/__tests__/speed.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { lowerStaticClause } from "../lowerStatic";
import { staticClauseRule } from "../grammar/shared/staticClause";
import { oracleCard } from "./oracle.fixture";

const REMINDER =
    "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)";

const SPEED_DEMON_TEXT = `Flying, trample\n${REMINDER}\nAt the beginning of your end step, you draw X cards and lose X life, where X is your speed.`;

/** The lines of a compile outcome's gaps, `[]` when it compiled. */
function gapLines(card: Parameters<typeof compileCard>[0]): string[] {
    const outcome = compileCard(card);
    return outcome.state === "unparsed" ? outcome.gaps.map((g) => g.line) : [];
}

function enchantment(name: string, manaCost: string, line: string) {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Enchantment",
        oracleText: `${REMINDER}\n${line}`,
        power: undefined,
        toughness: undefined,
    });
}

describe('"where X is your speed" (CR 107.3, CR 702.179f)', () => {
    it("compiles The Speed Demon whole", () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "c9fb22b4-dc22-4291-91f2-89c07cee7569",
                name: "The Speed Demon",
                manaCost: "{3}{B}{B}",
                typeLine: "Legendary Creature — Demon",
                oracleText: SPEED_DEMON_TEXT,
                power: "5",
                toughness: "5",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "The Speed Demon",
                types: ["Creature"],
                supertypes: ["Legendary"],
                subtypes: ["Demon"],
                manaCost: { X: 3, B: 2 },
                power: 5,
                toughness: 5,
                oracleText: SPEED_DEMON_TEXT,
                staticAbilities: ["flying", "trample", "start your engines!"],
                compiledTriggeredAbilities: [
                    {
                        id: "the-speed-demon-trigger",
                        oracleText:
                            "At the beginning of your end step, you draw X cards and lose X life, where X is your speed.",
                        head: {
                            kind: "phase",
                            phase: "END_STEP",
                            scope: "your",
                        },
                        effects: [
                            {
                                op: "draw",
                                player: "controller",
                                count: { speed: { of: "controller" } },
                            },
                            {
                                op: "loseLife",
                                player: "controller",
                                amount: { speed: { of: "controller" } },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("refuses a tail defining an X the head does not print", () => {
        expect(
            gapLines(
                enchantment(
                    "Probe",
                    "{1}{B}",
                    "At the beginning of your end step, you draw two cards, where X is your speed."
                )
            )
        ).toHaveLength(1);
    });
});

describe('"life equal to your speed" (CR 119.3, CR 702.179f)', () => {
    const momentumBreaker = oracleCard({
        oracleId: "087d2e42-c69f-4cd2-b2e3-e0b64ac2893b",
        name: "Momentum Breaker",
        manaCost: "{1}{B}",
        typeLine: "Enchantment",
        oracleText: `${REMINDER}\nWhen this enchantment enters, each opponent sacrifices a creature or Vehicle of their choice. Each opponent who can't discards a card.\n{2}, Sacrifice this enchantment: You gain life equal to your speed.`,
        power: undefined,
        toughness: undefined,
    });

    it("reads Momentum Breaker's line; only its enters line is a gap", () => {
        expect(gapLines(momentumBreaker)).toEqual([
            "When this enchantment enters, each opponent sacrifices a creature or Vehicle of their choice. Each opponent who can't discards a card.",
        ]);
    });

    it("lowers the line to a gain of the controller's speed", () => {
        const outcome = compileCard(
            enchantment(
                "Momentum Breaker",
                "{1}{B}",
                "{2}, Sacrifice this enchantment: You gain life equal to your speed."
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.activatedAbilities?.[0]?.effects).toEqual([
            {
                op: "gainLife",
                player: "controller",
                amount: { speed: { of: "controller" } },
            },
        ]);
    });

    it("refuses another player's speed", () => {
        expect(
            gapLines(
                enchantment(
                    "Probe",
                    "{1}{B}",
                    "{2}, Sacrifice this enchantment: You gain life equal to target opponent's speed."
                )
            )
        ).toHaveLength(1);
    });
});

describe('"cost {X} less to cast, where X is your speed" (CR 601.2f, CR 702.179f)', () => {
    const COST_LINE =
        "Noncreature spells you cast cost {X} less to cast, where X is your speed";

    it("reads Samut's cost line; only its anthem line is a gap", () => {
        expect(
            gapLines(
                oracleCard({
                    oracleId: "ee89c719-5ae8-4316-bfd0-cfe3684b5859",
                    name: "Samut, the Driving Force",
                    manaCost: "{3}{R}{G}{W}",
                    typeLine: "Legendary Creature — Human Warrior Cleric",
                    oracleText: `First strike, vigilance, haste\n${REMINDER}\nOther creatures you control get +X/+0, where X is your speed.\n${COST_LINE}.`,
                    power: "4",
                    toughness: "5",
                })
            )
        ).toEqual([
            "Other creatures you control get +X/+0, where X is your speed.",
        ]);
    });

    it("lowers to a reduction of {1} per point of the controller's speed", () => {
        const clause = staticClauseRule.run(COST_LINE, undefined);
        expect(clause.ok).toBe(true);
        if (!clause.ok) return;
        const lowered = lowerStaticClause(clause.value, COST_LINE, () => "id");
        expect(lowered.ok && lowered.lowered.effects).toEqual([
            {
                kind: "cost-modifier",
                spells: { excludeTypes: ["Creature"], controller: "you" },
                reduction: 1,
                count: { kind: "controller-speed" },
            },
        ]);
    });

    it("refuses a speed-sized tax", () => {
        expect(
            staticClauseRule.run(
                "Noncreature spells you cast cost {X} more to cast, where X is your speed",
                undefined
            ).ok
        ).toBe(false);
    });
});
