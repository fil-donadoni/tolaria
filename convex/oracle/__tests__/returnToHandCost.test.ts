// "Return a <permanent> you control to its owner's hand" activation cost
// (CR 602.1a, 118.1, 109.5).
//
// 1. GOLDEN — a real Oracle row compiled whole (Wirewood Symbiote).
// 2. REFUSALS — neighbours the rule must NOT read, so fail-closed is pinned.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { activationCostRule } from "../grammar/shared/cost";
import { oracleCard, parseContext } from "./oracle.fixture";

const SYMBIOTE_TEXT =
    "Return an Elf you control to its owner's hand: Untap target creature. Activate only once each turn.";

function creature(oracleText: string) {
    return oracleCard({
        name: "Wirewood Symbiote",
        manaCost: "{G}",
        typeLine: "Creature — Insect",
        power: "1",
        toughness: "1",
        oracleText,
    } as never);
}

describe("Return-a-permanent cost — golden (CR 602.1a, 118.1)", () => {
    it("Wirewood Symbiote: lowers to cost.returnToHandFilter", () => {
        const outcome = compileCard(creature(SYMBIOTE_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition).toEqual({
            name: "Wirewood Symbiote",
            types: ["Creature"],
            subtypes: ["Insect"],
            manaCost: { G: 1 },
            power: 1,
            toughness: 1,
            oracleText: SYMBIOTE_TEXT,
            activatedAbilities: [
                {
                    id: "wirewood-symbiote-ability",
                    oracleText: SYMBIOTE_TEXT,
                    cost: { returnToHandFilter: { subtypes: ["Elf"] } },
                    useStack: true,
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { target: 0 },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                    oncePerTurn: true,
                },
            ],
        });
    });
});

describe("Return-a-permanent cost — refusals", () => {
    it.each([
        "Return an Elf to its owner's hand",
        "Return an Elf an opponent controls to its owner's hand",
        "Return two Elves you control to its owner's hand",
        "Return an Elf you control",
        "Return an Elf you control to your hand",
        "Return target Elf you control to its owner's hand",
    ])("refuses %s", (span) => {
        expect(
            activationCostRule.run(span, parseContext(creature(""))).ok
        ).toBe(false);
    });
});
