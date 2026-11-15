import { describe, it, expect } from "vitest";
import type { CardInstance } from "~/types/game";
import {
    ORDERED_FAN_HIDDEN_STEP,
    ORDERED_FAN_OVERLAP,
    buildOrderedPileSlots,
    orderedFanWidthFactor,
} from "../ordered-pile";

function card(id: string): CardInstance {
    return {
        id,
        card: { id },
        controllerId: "me",
        ownerId: "me",
        zone: "graveyard",
        isTapped: false,
    };
}

describe("ordered pile slots (issue #9874)", () => {
    const cards = ["a", "b", "c", "d"].map(card);

    it("numbers positions from the top (last array index = position 1)", () => {
        const slots = buildOrderedPileSlots(cards, () => true);
        expect(slots.map((s) => s.position)).toEqual([4, 3, 2, 1]);
    });

    it("marks a card failing the filter hidden, keeping its slot", () => {
        const slots = buildOrderedPileSlots(cards, (c) => c.id !== "b");
        expect(slots.map((s) => s.kind)).toEqual([
            "card",
            "hidden",
            "card",
            "card",
        ]);
    });

    it("fan width = one card + each later slot's visible step", () => {
        const step = 1 - ORDERED_FAN_OVERLAP;
        expect(orderedFanWidthFactor([])).toBe(0);
        expect(
            orderedFanWidthFactor(buildOrderedPileSlots(cards, () => true))
        ).toBeCloseTo(1 + 3 * step);
        // a, [b hidden], [c hidden], d: a→b card step, b→c and c→d sliver.
        const slots = buildOrderedPileSlots(
            cards,
            (c) => c.id === "a" || c.id === "d"
        );
        expect(orderedFanWidthFactor(slots)).toBeCloseTo(
            1 + step + 2 * ORDERED_FAN_HIDDEN_STEP
        );
    });
});
