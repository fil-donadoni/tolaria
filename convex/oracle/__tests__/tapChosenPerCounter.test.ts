// "<player> taps an untapped <types> they control for each <type> counter on
// this <noun>" (CR 701.26a, CR 122.1) — Tangle Wire.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const TANGLE_WIRE = oracleCard({
    name: "Tangle Wire",
    manaCost: "{3}",
    typeLine: "Artifact",
    oracleText:
        "Fading 4 (This artifact enters with four fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)\nAt the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.",
    power: undefined,
    toughness: undefined,
});

describe("tap an untapped permanent per counter (CR 701.26a)", () => {
    it("compiles Tangle Wire to a counter-sized choice then a tap", () => {
        const outcome = compileCard(TANGLE_WIRE);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                compiledTriggeredAbilities: [
                    {
                        effects: [
                            {
                                bind: "$tapped1",
                                count: {
                                    counters: {
                                        of: { ref: "$source" },
                                        type: "fade",
                                    },
                                },
                                filter: {
                                    tapped: false,
                                    type: ["Artifact", "Creature", "Land"],
                                },
                                kind: "choose-permanents",
                                op: "choice",
                                player: { ref: "$event.activePlayerId" },
                                prompt: "Tap an untapped artifact, creature, or land you control.",
                                zone: "battlefield",
                            },
                            {
                                effects: [
                                    {
                                        action: "tap",
                                        op: "tapUntap",
                                        target: { ref: "$each" },
                                    },
                                ],
                                op: "forEach",
                                select: { ref: "$tapped1", set: "bound" },
                            },
                        ],
                        head: {
                            kind: "phase",
                            phase: "UPKEEP",
                            scope: "each",
                        },
                        id: "tangle-wire-trigger",
                        oracleText:
                            "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.",
                    },
                ],
                manaCost: { X: 3 },
                name: "Tangle Wire",
                oracleText: TANGLE_WIRE.oracleText,
                staticAbilities: ["fading 4"],
                types: ["Artifact"],
            })
        );
    });

    it("refuses a count that is not a source's counters", () => {
        const outcome = compileCard({
            ...TANGLE_WIRE,
            oracleText:
                "At the beginning of each player's upkeep, that player taps an untapped artifact, creature, or land they control for each card in their hand.",
        });
        expect(outcome.state).toBe("unparsed");
    });
});

describe("neighbours stay refused (fail-closed)", () => {
    it("refuses a head naming no player for 'that player'", () => {
        const outcome = compileCard({
            ...TANGLE_WIRE,
            oracleText:
                "Fading 4\nAt the beginning of your upkeep, that player taps an untapped artifact, creature, or land they control for each fade counter on this artifact.",
        });
        expect(outcome.state).toBe("unparsed");
    });
});
