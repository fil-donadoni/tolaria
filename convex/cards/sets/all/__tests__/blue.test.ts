import { describe, it, expect } from "vitest";
import { forceOfWill } from "../blue";

// Force of Will — {3}{U}{U} Instant. "You may pay 1 life and exile a blue card
// from your hand rather than pay this spell's mana cost. Counter target spell."
// The pitch cost's life + hand legs and the counter effect are exercised
// end-to-end in convex/gre/__tests__/pitch-cost.test.ts; here we pin the
// definition shape (CR 118.9 / 701.5a).
describe("Force of Will (pitch: pay 1 life + exile a blue card)", () => {
    it("declares the compound alternative cost and the counter effect", () => {
        expect(forceOfWill.alternativeCosts).toEqual([
            {
                id: "pitch-pay-1-life-exile-blue",
                description: "Pay 1 life and exile a blue card from your hand",
                payLife: 1,
                handCost: {
                    action: "exile",
                    requirements: [{ filter: { color: "U" }, count: 1 }],
                },
            },
        ]);
        expect(forceOfWill.targetRequirement).toEqual({
            type: "spell",
            count: 1,
        });
        expect(forceOfWill.effects).toEqual([
            { op: "counter", target: { target: 0 } },
        ]);
    });
});
