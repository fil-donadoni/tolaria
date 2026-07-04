// Theros (THS) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { sylvanCaryatid } from "../green";

describe("Sylvan Caryatid (Defender, hexproof, {T}: any color, CR 605.1a / 702.16 / 702.3)", () => {
    it("is a 0/3 Plant with defender + hexproof and an any-color mana ability", () => {
        expect(sylvanCaryatid.manaCost).toEqual({ X: 1, G: 1 });
        expect(sylvanCaryatid.power).toBe(0);
        expect(sylvanCaryatid.toughness).toBe(3);
        expect(sylvanCaryatid.staticAbilities).toEqual([
            "defender",
            "hexproof",
        ]);
        const ability = sylvanCaryatid.activatedAbilities![0];
        expect(ability.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
        expect(ability.useStack).toBe(false);
    });
});
