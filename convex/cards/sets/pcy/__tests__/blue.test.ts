import { describe, it, expect } from "vitest";
import { foil } from "../blue";

// Foil — {2}{U}{U} Instant. "You may discard an Island card and another card
// rather than pay this spell's mana cost. Counter target spell." (CR 118.9 pitch
// cost — DISCARD leg; CR 701.9 discard; CR 701.5a counter; issue #1003.) The
// two-requirement discard leg and the counter effect are exercised end-to-end in
// convex/gre/__tests__/pitch-cost.test.ts; here we pin the definition shape.
describe("Foil (pitch: discard an Island card and another card)", () => {
    it("declares the two-requirement discard alternative cost", () => {
        expect(foil.alternativeCosts).toEqual([
            {
                id: "pitch-discard-island-and-card",
                description: "Discard an Island card and another card",
                handCost: {
                    action: "discard",
                    requirements: [
                        { filter: { subtype: "Island" }, count: 1 },
                        { filter: {}, count: 1 },
                    ],
                },
            },
        ]);
        expect(foil.targetRequirement).toEqual({ type: "spell", count: 1 });
        expect(foil.effects).toEqual([
            { op: "counter", target: { target: 0 } },
        ]);
    });
});
