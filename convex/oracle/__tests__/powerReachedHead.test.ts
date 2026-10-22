// State trigger head (issue #5206): "when this creature's power is N or
// greater" (CR 603.8).
//
//  1. GOLDEN — Phyrexian Devourer, a real corpus card, compiled whole.
//  2. REFUSALS — neighbours the head must NOT read: another object's power,
//     and a comparison other than "or greater".

import { describe, expect, it } from "vitest";
import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import { expandCompiledTriggers } from "../../cards/compiledTriggers";
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

    it("the rebuilt ability fires on STATE_CHECK only at power >= N (CR 603.8)", () => {
        const outcome = compileCard(devourer(`${HEAD} draw a card.`));
        if (outcome.state === "unparsed") throw new Error("unparsed");
        const [ability] = expandCompiledTriggers(
            outcome.definition as CardDefinition
        ).triggeredAbilities!;
        const at = (power: number) =>
            ability!.matches(
                { type: "STATE_CHECK" },
                { power } as PermanentView,
                {} as TriggerStateView
            );
        expect(ability!.event).toBe("STATE_CHECK");
        expect(at(6)).toBe(false);
        expect(at(7)).toBe(true);
        expect(at(9)).toBe(true);
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
