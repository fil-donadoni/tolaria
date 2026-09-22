// "<self> deals N damage to each creature and each player" / "Prevent the
// next N damage that would be dealt to each creature and each player this
// turn" — CR 120.3's fixed two-set damage recipient union (issue #4306).
//
// Read as ONE exact phrase (`SubjectIR` kind `"each-creature-and-player"`),
// not a general "X and Y" coordination — this grammar has none, and widening
// to one would read neighbours no fixture covers ("each opponent and each
// creature", "every creature and every player"). Lowered to a PAIR of
// `forEach` sweeps (one over battlefield creatures, one over players)
// because `dealDamage.to` / `preventDamage.to` each name ONE recipient, the
// same shape the hand-written Pestilence writes by hand (`sets/lea/black.ts`).
//
// Two layers:
//
//  1. GOLDENS — one per verb the corpus prints the phrase under: `dealDamage`
//     (plain "This creature", Thrashing Wumpus; the "It" pronoun dealer
//     behind a sacrifice cost, Bloodfire Colossus — read at COMPILE time
//     only) and `preventDamage`
//     (Kitsune Palliator). Both dealDamage and preventDamage forms are
//     registered `GOLDEN_FIXTURES` rows (the smoke generator cannot build a
//     `forEach`/`$each` script), so a golden here also asserts the fixture
//     takes its card all the way to `ready`.
//  2. REFUSALS — the neighbours the rule must NOT read: "each creature"
//     alone, a differently grouped pair, and "every" in place of "each".

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const THRASHING_WUMPUS: OracleCard = {
    oracleId: "ef220824-fab4-4d8e-9ba4-65ff5ba1db66",
    name: "Thrashing Wumpus",
    manaCost: "{3}{B}{B}",
    typeLine: "Creature — Beast",
    oracleText:
        "{B}: This creature deals 1 damage to each creature and each player.",
    power: "3",
    toughness: "3",
    layout: "normal",
};

const BLOODFIRE_COLOSSUS: OracleCard = {
    oracleId: "cc59e28a-eda3-468c-a31b-73e4b615f953",
    name: "Bloodfire Colossus",
    manaCost: "{6}{R}{R}",
    typeLine: "Creature — Giant",
    oracleText:
        "{R}, Sacrifice this creature: It deals 6 damage to each creature and each player.",
    power: "6",
    toughness: "6",
    layout: "normal",
};

const KITSUNE_PALLIATOR: OracleCard = {
    oracleId: "ed854708-5a65-4293-bebc-d7c639407ba5",
    name: "Kitsune Palliator",
    manaCost: "{2}{W}",
    typeLine: "Creature — Fox Cleric",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to each creature and each player this turn.",
    power: "0",
    toughness: "2",
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

/** A probe card whose Oracle text is exactly `oracleText` — a neighbour form
 *  no corpus card prints, so the refusal is pinned by a synthetic line. */
function creature(oracleText: string) {
    return oracleCard({
        name: "Refusal Probe",
        manaCost: "{1}{B}",
        typeLine: "Creature — Bear",
        oracleText,
        power: "1",
        toughness: "1",
    });
}

function creatureSweep(effect: Record<string, unknown>) {
    return {
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            filter: { type: "Creature" },
        },
        effects: [effect],
    };
}

function playerSweep(effect: Record<string, unknown>) {
    return { op: "forEach", select: { set: "players" }, effects: [effect] };
}

describe("each creature and each player (CR 120.3) — goldens", () => {
    it("dealDamage, plain subject: Thrashing Wumpus deals 1 to every creature, then every player", () => {
        expect(sortKeys(compiled(THRASHING_WUMPUS))).toEqual(
            sortKeys({
                name: "Thrashing Wumpus",
                types: ["Creature"],
                subtypes: ["Beast"],
                manaCost: { X: 3, B: 2 },
                power: 3,
                toughness: 3,
                oracleText:
                    "{B}: This creature deals 1 damage to each creature and each player.",
                activatedAbilities: [
                    {
                        id: "thrashing-wumpus-ability",
                        oracleText:
                            "{B}: This creature deals 1 damage to each creature and each player.",
                        cost: { mana: { B: 1 } },
                        useStack: true,
                        effects: [
                            creatureSweep({
                                op: "dealDamage",
                                amount: 1,
                                to: { ref: "$each" },
                            }),
                            playerSweep({
                                op: "dealDamage",
                                amount: 1,
                                to: { player: { ref: "$each" } },
                            }),
                        ],
                    },
                ],
            })
        );
    });

    // COMPILE-ONLY, deliberately: this asserts the grammar reads "It" as the
    // dealer and lowers it to `$source`, nothing more. Whether `$source` still
    // resolves once the sacrifice cost has moved the creature off the
    // battlefield is a GRE question, already exercised by the hand-written
    // cards that print the same shape (`sets/ice/black.ts`, `fem/black.ts`,
    // `sets/lea/black.ts`) — claiming it here would be a test whose docstring
    // covers more than the test does.
    it("dealDamage, 'It' dealer behind a sacrifice cost: Bloodfire Colossus deals 6 (CR 120.1)", () => {
        expect(sortKeys(compiled(BLOODFIRE_COLOSSUS))).toEqual(
            sortKeys({
                name: "Bloodfire Colossus",
                types: ["Creature"],
                subtypes: ["Giant"],
                manaCost: { X: 6, R: 2 },
                power: 6,
                toughness: 6,
                oracleText:
                    "{R}, Sacrifice this creature: It deals 6 damage to each creature and each player.",
                activatedAbilities: [
                    {
                        id: "bloodfire-colossus-ability",
                        oracleText:
                            "{R}, Sacrifice this creature: It deals 6 damage to each creature and each player.",
                        cost: { mana: { R: 1 }, sacrifice: true },
                        useStack: true,
                        effects: [
                            creatureSweep({
                                op: "dealDamage",
                                amount: 6,
                                to: { ref: "$each" },
                            }),
                            playerSweep({
                                op: "dealDamage",
                                amount: 6,
                                to: { player: { ref: "$each" } },
                            }),
                        ],
                    },
                ],
            })
        );
    });

    it("preventDamage: Kitsune Palliator shields every creature and every player for 1 (CR 615.7)", () => {
        expect(sortKeys(compiled(KITSUNE_PALLIATOR))).toEqual(
            sortKeys({
                name: "Kitsune Palliator",
                types: ["Creature"],
                subtypes: ["Fox", "Cleric"],
                manaCost: { X: 2, W: 1 },
                power: 0,
                toughness: 2,
                oracleText:
                    "{T}: Prevent the next 1 damage that would be dealt to each creature and each player this turn.",
                activatedAbilities: [
                    {
                        id: "kitsune-palliator-ability",
                        oracleText:
                            "{T}: Prevent the next 1 damage that would be dealt to each creature and each player this turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            creatureSweep({
                                op: "preventDamage",
                                mode: "next-n",
                                to: { ref: "$each" },
                                amount: 1,
                                duration: { phase: "end-of-turn" },
                            }),
                            playerSweep({
                                op: "preventDamage",
                                mode: "next-n",
                                to: { player: { ref: "$each" } },
                                amount: 1,
                                duration: { phase: "end-of-turn" },
                            }),
                        ],
                    },
                ],
            })
        );
    });

    it("the dealDamage golden fixture takes Thrashing Wumpus all the way to ready", () => {
        // The smoke scenario has no runtime battlefield/player set to iterate,
        // so the `forEach`/`$each` pair is a card-dependent skip; the
        // registered fixture is what clears it (ADR 0105 § 7.1).
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Thrashing Wumpus"
        );
        expect(fixture?.rule).toBe("effect clause");
        expect(compileCard(fixture!.card).state).toBe("ready");
    });

    it("the preventDamage golden fixture takes Kitsune Palliator all the way to ready", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Kitsune Palliator"
        );
        expect(fixture?.rule).toBe("effect clause");
        expect(compileCard(fixture!.card).state).toBe("ready");
    });
});

describe("each creature and each player (CR 120.3) — refusals stay fail-closed", () => {
    it("reads the exact phrase only: 'each creature' alone is a different, still-refused sentence", () => {
        expect(
            compileCard(
                creature("{B}: This creature deals 1 damage to each creature.")
            ).state
        ).toBe("unparsed");
    });

    it("a differently grouped pair is refused, not folded into the same reading", () => {
        expect(
            compileCard(
                creature(
                    "{B}: This creature deals 1 damage to each opponent and each creature."
                )
            ).state
        ).toBe("unparsed");
    });

    it("'every' is not 'each': the determiner is read verbatim", () => {
        expect(
            compileCard(
                creature(
                    "{B}: This creature deals 1 damage to every creature and every player."
                )
            ).state
        ).toBe("unparsed");
    });
});
