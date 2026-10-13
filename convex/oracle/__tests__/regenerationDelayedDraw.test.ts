// Regeneration lock on damaged targets and the imperative delayed draw —
// issue #4569, a Grammar Cluster (ADR 0137):
//
//  - "A creature dealt damage this way can't be regenerated this turn" after
//    ONE announced target (CR 701.19c, CR 608.2h) — Incinerate;
//  - "Draw a card at the beginning of the next turn's upkeep" (CR 603.7a) —
//    Portent, the imperative twin of "You draw a card at …".
//
// GOLDEN fixtures (a real corpus card compiled whole) + REFUSALS (fail-closed,
// ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectUnparsed(oracleText: string, typeLine = "Instant") {
    const outcome = compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{U}",
            typeLine,
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
    expect(outcome.state).toBe("unparsed");
}

describe("regeneration lock and delayed draw — golden fixtures", () => {
    it("CR 701.19c + CR 608.2h — damaged creature can't regenerate: Incinerate", () => {
        const text =
            "Incinerate deals 3 damage to any target. A creature dealt damage this way can't be regenerated this turn.";
        const card = oracleCard({
            name: "Incinerate",
            manaCost: "{1}{R}",
            typeLine: "Instant",
            oracleText: text,
            oracleId: "d8fd7a34-8418-4e98-b79b-119c4348c667",
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Incinerate",
                types: ["Instant"],
                manaCost: { X: 1, R: 1 },
                oracleText: text,
                effects: [
                    { op: "dealDamage", amount: 3, to: { target: 0 } },
                    { op: "preventRegeneration", target: { target: 0 } },
                ],
                targetRequirement: { type: "any", count: 1 },
            })
        );
    });

    it("CR 603.7a — imperative delayed draw: Flare", () => {
        const text =
            "Flare deals 1 damage to any target.\nDraw a card at the beginning of the next turn's upkeep.";
        const card = oracleCard({
            name: "Flare",
            manaCost: "{2}{R}",
            typeLine: "Instant",
            oracleText: text,
            layout: "normal",
        });
        expect(sortKeys(compiledDefinition(card))).toEqual(
            sortKeys({
                name: "Flare",
                types: ["Instant"],
                manaCost: { X: 2, R: 1 },
                oracleText: text,
                effects: [
                    { op: "dealDamage", amount: 1, to: { target: 0 } },
                    {
                        op: "delayedTrigger",
                        timing: "next-upkeep",
                        oracleText:
                            "At the beginning of the next turn's upkeep, draw a card.",
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
                targetRequirement: { type: "any", count: 1 },
            })
        );
    });
});

describe("regeneration lock and delayed draw — refusals", () => {
    it("refuses the lock with no announced target before it", () => {
        expectUnparsed(
            "You gain 3 life. A creature dealt damage this way can't be regenerated this turn."
        );
    });

    it("refuses a two-card delayed draw (no printed body)", () => {
        expectUnparsed(
            "Draw two cards at the beginning of the next turn's upkeep."
        );
    });
});
