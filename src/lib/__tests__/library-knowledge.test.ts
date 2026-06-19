import { describe, it, expect } from "vitest";
import {
    buildLibraryPileModel,
    libraryPreviewTopCard,
    libraryCount,
} from "../library-knowledge";
import type { CardInstance, PublicLibrary } from "~/types/game";

// ADR 0026 / PRD #338 — pure render-model helpers map the projected (sparse)
// library to face-up positions. No game logic; identity is gated server-side.

function knownCard(id: string): CardInstance {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
        isTapped: false,
    };
}

describe("buildLibraryPileModel", () => {
    it("renders every card face-up for a full (debug) array", () => {
        const lib = [knownCard("a"), knownCard("b")];
        const model = buildLibraryPileModel(lib, "p1");
        expect(model.map((s) => s.faceUp)).toEqual([true, true]);
        expect(model.map((s) => s.index)).toEqual([0, 1]);
    });

    it("renders known positions face-up and the rest as backs (top → bottom)", () => {
        const lib: PublicLibrary = {
            count: 4,
            known: [
                { index: 0, card: knownCard("top") },
                { index: 2, card: knownCard("mid") },
            ],
        };
        const model = buildLibraryPileModel(lib, "p1");
        expect(model).toHaveLength(4);
        expect(model.map((s) => s.faceUp)).toEqual([true, false, true, false]);
        expect(model[0].card.id).toBe("top");
        expect(model[2].card.id).toBe("mid");
        // Hidden slots are synthetic placeholders with an empty def id.
        expect(model[1].card.card.id).toBe("");
    });

    it("treats a count-only library as all backs", () => {
        const model = buildLibraryPileModel({ count: 3 }, "p1");
        expect(model.map((s) => s.faceUp)).toEqual([false, false, false]);
    });
});

describe("libraryPreviewTopCard", () => {
    it("returns the top card when the viewer knows index 0", () => {
        const lib: PublicLibrary = {
            count: 5,
            known: [{ index: 0, card: knownCard("top") }],
        };
        expect(libraryPreviewTopCard(lib)?.id).toBe("top");
    });

    it("returns null when the top card is not known", () => {
        const lib: PublicLibrary = {
            count: 5,
            known: [{ index: 2, card: knownCard("mid") }],
        };
        expect(libraryPreviewTopCard(lib)).toBeNull();
    });

    it("returns the first card of a full array", () => {
        expect(
            libraryPreviewTopCard([knownCard("a"), knownCard("b")])?.id
        ).toBe("a");
    });

    it("returns null for an empty library", () => {
        expect(libraryPreviewTopCard({ count: 0, known: [] })).toBeNull();
        expect(libraryPreviewTopCard([])).toBeNull();
    });
});

describe("libraryCount", () => {
    it("reads count from either shape", () => {
        expect(libraryCount({ count: 7, known: [] })).toBe(7);
        expect(libraryCount([knownCard("a")])).toBe(1);
    });
});
