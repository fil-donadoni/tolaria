import { describe, expect, it } from "vitest";
import { reduceFace } from "../oracle-corpus";

// Issue #7905 — CR 202.2e / 204.1: a back face has no mana cost, so its colour
// is its colour indicator; only the corpus can carry it.
describe("reduceFace colours", () => {
    const backFace = {
        name: "Plated Kilnbeast",
        type_line: "Creature — Beast",
        oracle_text: "",
        colors: ["G", "R"],
    };

    it("keeps card_faces[].colors when asked", () => {
        expect(reduceFace(backFace, true).colors).toEqual(["G", "R"]);
    });

    it("keeps an empty array: colourless is known, not unknown", () => {
        expect(reduceFace({ ...backFace, colors: [] }, true).colors).toEqual(
            []
        );
    });

    it("leaves colors absent (UNKNOWN) when the row has none or is top-level", () => {
        const noColors: Record<string, unknown> = { ...backFace };
        delete noColors.colors;
        expect(reduceFace(noColors, true)).not.toHaveProperty("colors");
        expect(reduceFace(backFace)).not.toHaveProperty("colors");
    });
});
