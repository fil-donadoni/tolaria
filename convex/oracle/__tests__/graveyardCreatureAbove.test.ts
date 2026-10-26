// "…if this card is in your graveyard with a creature card directly above it"
// (Death Spark, Krovikan Horror): CR 113.6b — the ability functions from the
// graveyard, so the zone is the descriptor's `zone`; CR 404.2 — the pile keeps
// its order, so "directly above" is the next higher index, a board predicate
// the descriptor carries as `graveyard-creature-above` (CR 603.4 intervening-if).

import { describe, expect, it } from "vitest";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type { GameEvent, PermanentView } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { conditionRule } from "../grammar/shared/condition";
import { oracleCard, parseContext } from "./oracle.fixture";

const KROVIKAN_TEXT =
    "At the beginning of the end step, if this card is in your graveyard with a creature card directly above it, you may return this card to your hand.\n{1}, Sacrifice a creature: This creature deals 1 damage to any target.";
const DEATH_SPARK_TEXT =
    "Death Spark deals 1 damage to any target.\nAt the beginning of your upkeep, if this card is in your graveyard with a creature card directly above it, you may pay {1}. If you do, return this card to your hand.";

const KROVIKAN_HORROR = oracleCard({
    name: "Krovikan Horror",
    manaCost: "{3}{B}",
    typeLine: "Creature — Horror Spirit",
    oracleText: KROVIKAN_TEXT,
    power: "2",
    toughness: "2",
});
const DEATH_SPARK = oracleCard({
    name: "Death Spark",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText: DEATH_SPARK_TEXT,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} is ${outcome.state}`);
    return outcome.definition;
}

describe("graveyard creature-above condition — golden fixtures (CR 113.6b, CR 404.2)", () => {
    it("Krovikan Horror: end-step recursion beside an activated ability", () => {
        expect(sortKeys(compiled(KROVIKAN_HORROR))).toEqual(
            sortKeys({
                name: "Krovikan Horror",
                types: ["Creature"],
                subtypes: ["Horror", "Spirit"],
                manaCost: { X: 3, B: 1 },
                power: 2,
                toughness: 2,
                oracleText: KROVIKAN_TEXT,
                activatedAbilities: [
                    {
                        id: "krovikan-horror-ability",
                        oracleText:
                            "{1}, Sacrifice a creature: This creature deals 1 damage to any target.",
                        cost: {
                            mana: { X: 1 },
                            sacrificeFilter: { types: ["Creature"] },
                        },
                        useStack: true,
                        effects: [
                            { op: "dealDamage", amount: 1, to: { target: 0 } },
                        ],
                        targetRequirement: { type: "any", count: 1 },
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "krovikan-horror-trigger",
                        oracleText: KROVIKAN_TEXT.split("\n")[0],
                        head: {
                            kind: "phase",
                            phase: "END_STEP",
                            scope: "each",
                        },
                        condition: { kind: "graveyard-creature-above" },
                        zone: "graveyard",
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                prompt: "Return this card to your hand?",
                                bind: "$may1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$may1" },
                                then: [
                                    {
                                        op: "moveZone",
                                        target: { ref: "$source" },
                                        to: "hand",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("Death Spark: a paid {1} upkeep return beside a spell", () => {
        expect(sortKeys(compiled(DEATH_SPARK))).toEqual(
            sortKeys({
                name: "Death Spark",
                types: ["Instant"],
                manaCost: { R: 1 },
                oracleText: DEATH_SPARK_TEXT,
                effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
                targetRequirement: { type: "any", count: 1 },
                compiledTriggeredAbilities: [
                    {
                        id: "death-spark-trigger",
                        oracleText: DEATH_SPARK_TEXT.split("\n")[1],
                        head: {
                            kind: "phase",
                            phase: "UPKEEP",
                            scope: "your",
                        },
                        condition: { kind: "graveyard-creature-above" },
                        zone: "graveyard",
                        effects: [
                            {
                                op: "mayPay",
                                player: "controller",
                                cost: { X: 1 },
                                prompt: "You may pay {1}. If you do, return this card to your hand",
                                bind: "$paid1",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$paid1" },
                                then: [
                                    {
                                        op: "moveZone",
                                        target: { ref: "$source" },
                                        to: "hand",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("graveyard creature-above condition — grammar and refusals", () => {
    it("conditionRule keeps the plain zone condition free of the pile clause", () => {
        const plain = conditionRule.run(
            "if this card is in your graveyard",
            parseContext()
        );
        expect(plain.ok && plain.value).toEqual({ kind: "self-in-graveyard" });
        const above = conditionRule.run(
            "if this card is in your graveyard with a creature card directly above it",
            parseContext()
        );
        expect(above.ok && above.value).toEqual({
            kind: "self-in-graveyard",
            creatureCardAbove: true,
        });
    });

    it.each([
        [
            "a land card above (only creature is printed)",
            "if this card is in your graveyard with a land card directly above it",
        ],
        [
            "anywhere above rather than directly above",
            "if this card is in your graveyard with a creature card above it",
        ],
        [
            "a count of cards above",
            "if this card is in your graveyard with two creature cards directly above it",
        ],
    ])("conditionRule refuses %s", (_form, text) => {
        expect(conditionRule.run(text, parseContext()).ok).toBe(false);
    });

    it("refuses the clause behind a head with no graveyard-zone factory", () => {
        expect(
            compileCard(
                oracleCard({
                    name: "Probe",
                    manaCost: "{1}{B}",
                    typeLine: "Creature — Zombie",
                    oracleText:
                        "Whenever you cast a spell, if this card is in your graveyard with a creature card directly above it, you gain 1 life.",
                    power: "1",
                    toughness: "1",
                })
            ).state
        ).toBe("unparsed");
    });
});

describe("graveyard creature-above condition — engine predicate (CR 404.2, CR 603.4)", () => {
    const ability = resolveCompiledTrigger(
        compiled(KROVIKAN_HORROR).compiledTriggeredAbilities![0]!
    );
    const horror = { id: "horror", ownerId: "p1", controllerId: "p1" };
    const event = {
        type: "PHASE_BEGIN",
        phase: "END_STEP",
        activePlayerId: "p1",
    } as unknown as GameEvent;

    function fires(graveyard: { id: string; types: string[] }[]): boolean {
        const state = {
            players: [
                { id: "p1", graveyard, battlefield: [] },
                { id: "p2", graveyard: [], battlefield: [] },
            ],
        };
        return ability.matches(
            event,
            horror as unknown as PermanentView,
            state as never
        );
    }

    it("fires only with a creature card on the next higher index", () => {
        const self = { id: "horror", types: ["Creature"] };
        expect(fires([self, { id: "a", types: ["Creature"] }])).toBe(true);
        expect(fires([self, { id: "a", types: ["Instant"] }])).toBe(false);
        // On top: nothing above. A creature BELOW does not count.
        expect(fires([{ id: "a", types: ["Creature"] }, self])).toBe(false);
        // A creature two up with a non-creature directly above: no.
        expect(
            fires([
                self,
                { id: "a", types: ["Land"] },
                { id: "b", types: ["Creature"] },
            ])
        ).toBe(false);
    });

    it("fails closed with no state view", () => {
        expect(
            ability.matches(
                event,
                horror as unknown as PermanentView,
                undefined
            )
        ).toBe(false);
    });
});
