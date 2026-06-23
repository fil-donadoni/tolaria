// Featured Card picker pure logic (PRD #589, issue #599). Toggling the override
// and resolving the builder's indicator across reloads / card removal.
import { describe, it, expect } from "vitest";
import { toggleFeatured, effectiveFeatured } from "../featuredPicker";
import type { DeckCard } from "~/types/game";

const cards: DeckCard[] = [
    { cardId: "bolt", cardName: "Lightning Bolt" },
    { cardId: "shock", cardName: "Shock" },
];

describe("toggleFeatured", () => {
    it("sets the override when a new card is picked", () => {
        expect(toggleFeatured(undefined, "bolt")).toBe("bolt");
    });

    it("switches the override to a different card", () => {
        expect(toggleFeatured("bolt", "shock")).toBe("shock");
    });

    it("clears the override when the already-featured card is re-picked (revert to default)", () => {
        expect(toggleFeatured("bolt", "bolt")).toBeUndefined();
    });
});

describe("effectiveFeatured", () => {
    it("uses the override picked this session", () => {
        expect(effectiveFeatured("shock", "bolt", cards)).toBe("shock");
    });

    it("falls back to the value the deck loaded with when untouched (survives reloads)", () => {
        expect(effectiveFeatured(undefined, "shock", cards)).toBe("shock");
    });

    it("defaults to the first Maindeck card when neither is set", () => {
        expect(effectiveFeatured(undefined, null, cards)).toBe("bolt");
    });

    it("falls back to the first remaining card when the featured card was removed", () => {
        // Override points at a card no longer in the Maindeck.
        expect(effectiveFeatured("gone", undefined, cards)).toBe("bolt");
        // Loaded value points at a removed card too.
        expect(effectiveFeatured(undefined, "gone", cards)).toBe("bolt");
    });

    it("resolves to null for an empty deck", () => {
        expect(effectiveFeatured("bolt", "bolt", [])).toBeNull();
    });
});
