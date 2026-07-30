import { describe, it, expect } from "vitest";
import { forceOfVigor } from "../green";

// Force of Vigor — {2}{G}{G} Instant. "If it's not your turn, you may exile a
// green card from your hand rather than pay this spell's mana cost. Destroy up
// to two target artifacts and/or enchantments." (CR 118.9 pitch cost;
// CR 701.7 destroy.) The pitch cost's hand leg + not-your-turn condition and the
// destroy effect (reused Op) are covered by the framework tests + the catalogue
// smoke sweep; here we pin the definition shape.
describe("Force of Vigor (pitch: exile a green card, not your turn)", () => {
    it("declares the conditional hand alternative cost and up-to-two destroy", () => {
        expect(forceOfVigor.alternativeCosts).toEqual([
            {
                id: "pitch-exile-green",
                description: "Exile a green card from your hand",
                condition: { kind: "not-your-turn" },
                hand: {
                    action: "exile",
                    requirements: [{ filter: { color: "G" }, count: 1 }],
                },
            },
        ]);
        expect(forceOfVigor.targetRequirement).toEqual({
            type: ["Artifact", "Enchantment"],
            count: { min: 0, max: 2 },
        });
        expect(forceOfVigor.effects).toEqual([
            { op: "destroy", target: { target: 0 } },
            { op: "destroy", target: { target: 1 } },
        ]);
    });
});
