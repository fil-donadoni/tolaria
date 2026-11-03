// Issue #1368 — the Bot prices `forEach { set: "times", count }` as the body
// repeated `count` times, never as a board-scaling member set and never as a
// neutral no-op: "add two mana in any combination of colors" is worth twice
// one mana of any color, and a zero count is worth nothing.

import { describe, it, expect } from "vitest";
import type { EffectOp, EffectValue } from "../../../cards/types";
import { colorChoiceModes } from "../../../cards/abilities/chooseColor";
import { valueEffectScript, contextFreeGrounding } from "../index";

const cf = contextFreeGrounding();

const ONE_MANA_ANY_COLOR: EffectOp = {
    op: "optionChoice",
    prompt: "Choose a color to add one mana of.",
    modes: colorChoiceModes((color) => [
        { op: "addMana", mana: { [color]: 1 } },
    ]),
};

function times(count: EffectValue): EffectOp[] {
    return [
        {
            op: "forEach",
            select: { set: "times", count },
            effects: [ONE_MANA_ANY_COLOR],
        },
    ];
}

describe('valuation — forEach { set: "times" } (issue #1368)', () => {
    it("is the body's value times the literal count, and positive", () => {
        const one = valueEffectScript([ONE_MANA_ANY_COLOR], cf);
        const two = valueEffectScript(times(2), cf);
        expect(one.points).toBeGreaterThan(0);
        expect(two.points).toBeCloseTo(one.points * 2);
        expect(two.tags).not.toContain("board-scaling");
    });

    it("a zero count is worth nothing", () => {
        expect(valueEffectScript(times(0), cf).points).toBe(0);
    });
});
