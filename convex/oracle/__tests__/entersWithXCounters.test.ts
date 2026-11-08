// "<self> enters with X <kind> counters on it." — the entry replacement
// (CR 614.1c) whose count is the X chosen for the spell that became the
// permanent (CR 107.3m), issue #8584.
//
//  1. GOLDEN forms — a real corpus card compiled whole, one per argument
//     class of the counter kind: a P/T counter on a creature (Ivy Elemental)
//     and a non-+1/+1 P/T kind beside other lines (Lightning Serpent).
//  2. The issue's key — Chalice of the Void's "This artifact enters with X
//     charge counters on it." is no longer a gap of the card (its trigger
//     line is another gap, so the card stays unparsed).
//  3. REFUSALS — a card with no {X} to announce, and the "where X is …"
//     neighbour, which defines X another way and is another form.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiledOf(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(
            `${card.name} did not reach ready: ${outcome.state} — ${JSON.stringify(
                outcome.state === "unparsed" ? outcome.gaps : outcome.reasons
            )}`
        );
    return outcome.definition;
}

describe("golden — enters with X counters (CR 614.1c / 107.3m)", () => {
    it("Ivy Elemental — X +1/+1 counters, the cast X", () => {
        const oracleText = "This creature enters with X +1/+1 counters on it.";
        expect(
            sortKeys(
                compiledOf(
                    oracleCard({
                        oracleId: "38517711-e570-4337-b269-addcf8bfdd74",
                        name: "Ivy Elemental",
                        manaCost: "{X}{G}",
                        typeLine: "Creature — Elemental",
                        oracleText,
                        power: "0",
                        toughness: "0",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Ivy Elemental",
                types: ["Creature"],
                subtypes: ["Elemental"],
                manaCost: { X: "X", G: 1 },
                power: 0,
                toughness: 0,
                oracleText,
                entersWith: { counters: [{ type: "+1/+1", count: "X" }] },
            })
        );
    });

    it("Lightning Serpent — X +1/+0 counters beside keyword and trigger lines", () => {
        const oracleText =
            "Trample, haste\nThis creature enters with X +1/+0 counters on it.\nAt the beginning of the end step, sacrifice this creature.";
        expect(
            sortKeys(
                compiledOf(
                    oracleCard({
                        oracleId: "d07b4bb6-0c8d-44ea-a5b3-eeb6e36f3631",
                        name: "Lightning Serpent",
                        manaCost: "{X}{R}",
                        typeLine: "Creature — Elemental Serpent",
                        oracleText,
                        power: "2",
                        toughness: "1",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Lightning Serpent",
                types: ["Creature"],
                subtypes: ["Elemental", "Serpent"],
                manaCost: { X: "X", R: 1 },
                power: 2,
                toughness: 1,
                oracleText,
                staticAbilities: ["trample", "haste"],
                compiledTriggeredAbilities: [
                    {
                        id: "lightning-serpent-trigger",
                        oracleText:
                            "At the beginning of the end step, sacrifice this creature.",
                        head: {
                            kind: "phase",
                            phase: "END_STEP",
                            scope: "each",
                        },
                        effects: [
                            { op: "sacrifice", target: { ref: "$source" } },
                        ],
                    },
                ],
                entersWith: { counters: [{ type: "+1/+0", count: "X" }] },
            })
        );
    });
});

describe("the issue's key — Chalice of the Void's entry line is read", () => {
    it("no gap names the charge-counter line", () => {
        const enters = "This artifact enters with X charge counters on it.";
        const outcome = compileCard(
            oracleCard({
                oracleId: "74027ba4-a6ba-4696-baf1-60ef0b27ee0a",
                name: "Chalice of the Void",
                manaCost: "{X}{X}",
                typeLine: "Artifact",
                oracleText: `${enters}\nWhenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter that spell.`,
                power: undefined,
                toughness: undefined,
            })
        );
        const gapLines =
            outcome.state === "unparsed" ? outcome.gaps.map((g) => g.line) : [];
        expect(
            gapLines.some((line) => line.includes("charge counters on it."))
        ).toBe(false);
        expect(
            gapLines.some((line) => line.startsWith("This artifact enters"))
        ).toBe(false);
    });
});

describe("refusals — the neighbours of the X form", () => {
    it("a card whose mana cost prints no {X} has no X to announce (CR 107.3m)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Elemental",
                manaCost: "{2}{G}",
                typeLine: "Creature — Elemental",
                oracleText: "This creature enters with X +1/+1 counters on it.",
                power: "0",
                toughness: "0",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it('"where X is …" defines X another way and stays refused', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Vessel",
                manaCost: "{X}{4}",
                typeLine: "Artifact",
                oracleText:
                    "This artifact enters with X charge counters on it, where X is your life total.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
