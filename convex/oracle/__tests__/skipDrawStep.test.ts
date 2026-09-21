// "Skip your draw step." — the static clause frame (CR 614.10, issue #4304).
//
// Four layers, each watching a different way the frame can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition: the skip beside an activated ability that
//     draws (Yawgmoth's Bargain, Symbiotic Deployment).
//  2. REFUSALS — the neighbours of the sentence stay unparsed. The rule reads
//     the printed sentence and nothing that merely resembles it.
//  3. LOWERING invariants — what only the whole card can decide: the field is
//     a boolean on the definition, JSON-pure, never a trigger or a static
//     effect, and idempotent when the sentence is printed twice.
//  4. BEHAVIOUR — the compiled definition, registered as-is, actually stops the
//     turn-based draw (CR 504.1) at the real `advancePhase` seam, and a
//     control run without the permanent draws — so the assertion can tell the
//     two apart.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { advancePhase } from "../../gre/phases";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./fixtures";

const YAWGMOTHS_BARGAIN = oracleCard({
    oracleId: "f7f76f39-a0de-4bda-86b6-0f291892fcec",
    name: "Yawgmoth's Bargain",
    manaCost: "{4}{B}{B}",
    typeLine: "Enchantment",
    oracleText: "Skip your draw step.\nPay 1 life: Draw a card.",
    power: undefined,
    toughness: undefined,
});

const SYMBIOTIC_DEPLOYMENT = oracleCard({
    oracleId: "a6872d7a-b647-4baf-bd1e-06707ccbb71a",
    name: "Symbiotic Deployment",
    manaCost: "{2}{G}",
    typeLine: "Enchantment",
    oracleText:
        "Skip your draw step.\n{1}, Tap two untapped creatures you control: Draw a card.",
    power: undefined,
    toughness: undefined,
});

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

/** The clause alone, through the static slot. */
function clause(line: string): unknown {
    const parsed = staticSlot.run(line, parseContext());
    expect(parsed.ok, `expected "${line}" to parse`).toBe(true);
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error("not a static clause");
    return parsed.value.clause;
}

describe("Skip your draw step — golden fixtures (CR 614.10)", () => {
    it("Yawgmoth's Bargain: the skip beside a life-paid draw", () => {
        expect(sortKeys(compiled(YAWGMOTHS_BARGAIN))).toEqual(
            sortKeys({
                name: "Yawgmoth's Bargain",
                types: ["Enchantment"],
                manaCost: { X: 4, B: 2 },
                oracleText: "Skip your draw step.\nPay 1 life: Draw a card.",
                activatedAbilities: [
                    {
                        id: "yawgmoth-s-bargain-ability",
                        oracleText: "Pay 1 life: Draw a card.",
                        cost: { life: 1 },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
                drawStepReplacement: true,
            })
        );
    });

    it("Symbiotic Deployment: the skip beside a tap-two-creatures draw", () => {
        expect(sortKeys(compiled(SYMBIOTIC_DEPLOYMENT))).toEqual(
            sortKeys({
                name: "Symbiotic Deployment",
                types: ["Enchantment"],
                manaCost: { X: 2, G: 1 },
                oracleText:
                    "Skip your draw step.\n{1}, Tap two untapped creatures you control: Draw a card.",
                activatedAbilities: [
                    {
                        id: "symbiotic-deployment-ability",
                        oracleText:
                            "{1}, Tap two untapped creatures you control: Draw a card.",
                        cost: {
                            mana: { X: 1 },
                            tapOtherFilter: {
                                filter: {
                                    types: ["Creature"],
                                    controllerRelation: "you",
                                },
                                count: 2,
                            },
                        },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
                drawStepReplacement: true,
            })
        );
    });

    it("reads the bare sentence into the skip clause and routes it to the static slot", () => {
        expect(clause("Skip your draw step.")).toEqual({
            kind: "skip-draw-step",
        });
        const routed = routeLine("Skip your draw step.", parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });
});

describe("Skip your draw step — refusals (fail-closed neighbours)", () => {
    const refused = [
        // A different step: the rule is the DRAW step's, not "any step".
        "Skip your untap step.",
        "Skip your upkeep step.",
        // Optional / one-shot / next-occurrence: each is a different mechanic
        // (CR 614.10a — "next" waits for the first occurrence not skipped).
        "You may skip your draw step.",
        "Skip your next draw step.",
        "Skip your draw step this turn.",
        // Another player's step: the frame is the controller's own.
        "Skip its controller's draw step.",
        "Each player skips their draw step.",
        "Target player skips their next draw step.",
        // Trailing text is never swallowed.
        "Skip your draw step and gain 2 life.",
    ];
    for (const line of refused) {
        it(`REFUSES "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
    }

    it("does not read the sentence without its full stop as a static clause", () => {
        expect(staticSlot.run("Skip your draw step", parseContext()).ok).toBe(
            false
        );
    });
});

describe("Skip your draw step — lowering invariants", () => {
    it("is a JSON-pure boolean, never a trigger or a continuous effect", () => {
        const definition = compiled(YAWGMOTHS_BARGAIN);
        expect(definition.drawStepReplacement).toBe(true);
        expect(definition.compiledStaticEffects).toBeUndefined();
        expect(definition.compiledTriggeredAbilities).toBeUndefined();
        expect(definition.staticAbilities).toBeUndefined();
        expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    });

    it("a card that prints no such sentence carries no flag", () => {
        const definition = compiled(
            oracleCard({
                oracleText: "Flying",
                typeLine: "Creature — Bird",
            })
        );
        expect(definition.drawStepReplacement).toBeUndefined();
    });

    it("the sentence printed twice is one flag, not two (idempotent)", () => {
        const definition = compiled(
            oracleCard({
                typeLine: "Enchantment",
                power: undefined,
                toughness: undefined,
                oracleText: "Skip your draw step.\nSkip your draw step.",
            })
        );
        expect(definition.drawStepReplacement).toBe(true);
    });
});

describe("Skip your draw step — the compiled definition at the real draw step (CR 504.1)", () => {
    const BARGAIN_ID = "compiled-yawgmoths-bargain";

    function withBargain<T>(fn: () => T): T {
        const definition: CardDefinition = {
            ...compiled(YAWGMOTHS_BARGAIN),
            id: BARGAIN_ID,
            rarity: "rare",
        };
        return withTemporaryDefinition(definition, fn);
    }

    /** p1's turn 2, standing in UPKEEP with one card on top of the library. */
    function drawStepFrom(battlefield: ReturnType<typeof makeInstance>[]) {
        const p1 = makePlayer("p1", {
            battlefield,
            library: [makeInstance(BARGAIN_ID, { id: "top" })],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });
        advancePhase(state);
        return { state, p1 };
    }

    it("the controller's turn-based draw does not happen", () => {
        withBargain(() => {
            const { state, p1 } = drawStepFrom([
                makeInstance(BARGAIN_ID, {
                    id: "bargain",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ]);
            expect(state.phase).toBe("DRAW");
            expect(p1.hand).toHaveLength(0);
            expect(p1.library).toHaveLength(1);
        });
    });

    it("control: without the permanent the same step draws the card", () => {
        withBargain(() => {
            const { state, p1 } = drawStepFrom([]);
            expect(state.phase).toBe("DRAW");
            expect(p1.hand).toHaveLength(1);
            expect(p1.library).toHaveLength(0);
        });
    });
});
