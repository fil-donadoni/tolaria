/**
 * The nested-choice bound is MEASURED (issue #3194).
 *
 * `MAX_CHOICE_DEPTH` used to be 1, with a comment naming Vision Charm as "the
 * shape that occurs" — while that card's land-type mode takes TWO nested option
 * choices, so both probes that recurse per suspended choice hit the cap on the
 * second one and failed open on the case the bound was written for. A constant
 * justified against an assumption is what this file replaces: the bound is
 * re-derived from the shipped catalogue here, and a card that chains deeper
 * than it reds.
 */

import { describe, expect, it } from "vitest";
import { registeredDefinitions } from "../../../cards";
import { getCardByName } from "../../../cards";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    MAX_CHOICE_BRANCH_WORK,
    MAX_CHOICE_DEPTH,
    RAISES_RESOLUTION_CHOICE,
    catalogueChoiceDepth,
    definitionChoiceDepth,
    scriptChoiceDepth,
} from "../choiceDepth";

const CATALOGUE: CardDefinition[] = [...registeredDefinitions()];

describe("resolution-choice depth", () => {
    it("no shipped card chains deeper than the bound the probes use", () => {
        const { depth, cards } = catalogueChoiceDepth(CATALOGUE);
        expect(
            depth,
            `deepest chain of resolution-time choices is ${depth} (${cards.join(", ")}), ` +
                `but MAX_CHOICE_DEPTH is ${MAX_CHOICE_DEPTH}. Raising the bound is a COST ` +
                `decision (see choiceDepth.ts), not a formality — read the header first.`
        ).toBeLessThanOrEqual(MAX_CHOICE_DEPTH);
    });

    it("Vision Charm's land-type mode needs two levels, not one", () => {
        // The exact card the old bound's comment named as "the shape that
        // occurs" at ONE level. Two nested `requestOptionChoice` calls: a land
        // type, then the basic land type it becomes (CR 305.7).
        expect(definitionChoiceDepth(getCardByName("Vision Charm"))).toBe(2);
    });

    it("counts a chain along one path: sequential adds, alternatives take the max", () => {
        const draw: EffectOp = { op: "draw", count: 1, player: "controller" };
        // `if` arms are ALTERNATIVES — the deeper arm sets the depth, the two
        // do not sum; the Ops of one array are a SEQUENCE and do.
        const alternatives: EffectOp = {
            op: "if",
            predicate: { binding: "$paid" },
            then: [draw, draw],
            else: [draw],
        };
        expect(scriptChoiceDepth([draw])).toBe(1);
        expect(scriptChoiceDepth([draw, draw, draw])).toBe(3);
        expect(scriptChoiceDepth([alternatives])).toBe(2);
        expect(scriptChoiceDepth([draw, alternatives])).toBe(3);
    });

    it("classifies every Op in the union — no silent 'raises nothing' default", () => {
        // `tsc` already reds on a missing row (the Record is total over
        // `EffectOp["op"]`); this is the runtime twin, and it also pins that
        // the classification is not vacuous in either direction.
        const rows = Object.values(RAISES_RESOLUTION_CHOICE);
        expect(rows.length).toBeGreaterThan(80);
        expect(rows.filter(Boolean).length).toBeGreaterThan(0);
        expect(rows.filter((r) => !r).length).toBeGreaterThan(0);
        expect(RAISES_RESOLUTION_CHOICE.optionChoice).toBe(true);
        expect(RAISES_RESOLUTION_CHOICE.choice).toBe(true);
        expect(RAISES_RESOLUTION_CHOICE.dealDamage).toBe(false);
    });

    it("bounds the WORK a probe may spend, not only its depth", () => {
        // The two bounds answer different questions (a catalogue fact vs. a
        // cost decision). Without the second, raising the first multiplies:
        // `MAX_CHOICE_BRANCHES ^ MAX_CHOICE_DEPTH` is 32768 at depth 5.
        expect(MAX_CHOICE_BRANCH_WORK).toBeLessThan(8 ** MAX_CHOICE_DEPTH);
        // …and it must still admit the shape that motivated the raise: Vision
        // Charm opens 5 first-level branches, each with 5 of its own.
        expect(MAX_CHOICE_BRANCH_WORK).toBeGreaterThanOrEqual(5 + 5 * 5);
    });
});
