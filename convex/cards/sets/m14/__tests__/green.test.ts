// Magic 2014 (M14) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { elvishMystic } from "../green";

describe("Elvish Mystic ({T}: Add {G}, CR 605.1a)", () => {
    it("is a 1/1 Elf Druid with a fixed {G} tap ability", () => {
        expect(elvishMystic.manaCost).toEqual({ G: 1 });
        expect(elvishMystic.power).toBe(1);
        expect(elvishMystic.toughness).toBe(1);
        const ability = elvishMystic.activatedAbilities![0];
        expect(ability.manaProduced).toEqual({ G: 1 });
        expect(ability.cost).toEqual({ tap: true });
        expect(ability.useStack).toBe(false);
    });
});
