// Innistrad (ISD) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { avacynsPilgrim } from "../green";

describe("Avacyn's Pilgrim ({T}: Add {W}, CR 605.1a)", () => {
    it("is a 1/1 Human Monk that fixes into white", () => {
        expect(avacynsPilgrim.manaCost).toEqual({ G: 1 });
        expect(avacynsPilgrim.power).toBe(1);
        expect(avacynsPilgrim.toughness).toBe(1);
        const ability = avacynsPilgrim.activatedAbilities![0];
        expect(ability.manaProduced).toEqual({ W: 1 });
        expect(ability.cost).toEqual({ tap: true });
        expect(ability.useStack).toBe(false);
    });
});
