// State trigger head (issue #5206): "when this creature's power is N or
// greater" (CR 603.8).
//
//  1. GOLDEN — Phyrexian Devourer, a real corpus card, compiled whole.
//  2. REFUSALS — neighbours the head must NOT read: another object's power,
//     and a comparison other than "or greater".

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { withTemporaryDefinition } from "../../cards/registry";
import { collectStateTriggers } from "../../gre/triggers";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const devourer = (oracleText: string) =>
    oracleCard({
        name: "Phyrexian Devourer",
        manaCost: "{6}",
        typeLine: "Artifact Creature — Construct",
        oracleText,
        power: "1",
        toughness: "1",
    });

// Phyrexian Devourer's own body ("sacrifice it") is a separate Grammar Gap
// (`triggered › effect clause › Sacrifice it`), so the whole card stays
// unparsed after this rule. The head is exercised over a body the grammar
// already reads; the head line is the card's verbatim.
const HEAD = "When this creature's power is 7 or greater,";

describe("power-reached trigger head — golden (issue #5206)", () => {
    it("Phyrexian Devourer's head compiles to a power-reached descriptor", () => {
        const text = `${HEAD} draw a card.`;
        const outcome = compileCard(devourer(text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "phyrexian-devourer-trigger",
                    oracleText: text,
                    head: { kind: "power-reached", atLeast: 7 },
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ])
        );
    });

    it("fires through the engine on EFFECTIVE power: counters count (CR 603.8, CR 613.4)", () => {
        const outcome = compileCard(devourer(`${HEAD} draw a card.`));
        if (outcome.state === "unparsed") throw new Error("unparsed");
        const definition = {
            ...outcome.definition,
            id: "power-reached-test",
            rarity: "common",
        } as unknown as CardDefinition;
        withTemporaryDefinition(definition, () => {
            const stackAt = (counters: number) => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            battlefield: [
                                makeInstance(definition.id, {
                                    id: "devourer",
                                    controllerId: "p1",
                                    ownerId: "p1",
                                    counters: { "+1/+1": counters },
                                }),
                            ],
                        }),
                        makePlayer("p2"),
                    ],
                });
                return collectStateTriggers(state).length;
            };
            // Base power 1: six counters make 7, five make 6.
            expect(stackAt(5)).toBe(0);
            expect(stackAt(6)).toBe(1);
        });
    });

    it("refuses a condition behind the head instead of dropping it", () => {
        expect(
            compileCard(
                devourer(`${HEAD} if you control a Forest, draw a card.`)
            ).state
        ).toBe("unparsed");
    });
});

describe("power-reached trigger head — refusals", () => {
    it.each([
        [
            "another object's power",
            "When Soldier's power is 7 or greater, draw a card.",
        ],
        [
            "a different comparison",
            "When this creature's power is 7 or less, draw a card.",
        ],
        [
            "a non-numeric bound",
            "When this creature's power is X or greater, draw a card.",
        ],
    ])("%s is not read", (_label, text) => {
        expect(compileCard(devourer(text)).state).toBe("unparsed");
    });
});
