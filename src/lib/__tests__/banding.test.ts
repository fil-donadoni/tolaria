import { describe, it, expect } from "vitest";
import {
    hasBanding,
    hasBandsWithOther,
    hasBandingLike,
    canFormBand,
} from "../banding";
import type { CardInstance } from "~/types/game";

// Real LEG card ids (registry-backed for name / supertype resolution).
const HUNDING = "07d8e501-6857-4a52-a3b9-2bf0bee5b08c"; // Legendary (no banding)
const MARHAULT = "67330004-6720-46d9-9de0-c79230110583"; // Legendary (no banding)
const FROST_GIANT = "6955d54f-7b37-4e43-8183-51677fb1ee11"; // non-legendary

function creature(
    cardId: string,
    staticAbilities: string[],
    id = "c"
): CardInstance {
    return {
        id,
        card: { id: cardId },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        types: ["Creature"],
        isTapped: false,
        staticAbilities,
    };
}

describe("frontend banding helpers mirror the engine (CR 702.22c / 702.22j)", () => {
    it("hasBanding / hasBandsWithOther / hasBandingLike", () => {
        const plain = creature(FROST_GIANT, ["banding"]);
        const variant = creature(HUNDING, ["bands with other:legendary"]);
        const vanilla = creature(FROST_GIANT, []);

        expect(hasBanding(plain)).toBe(true);
        expect(hasBandsWithOther(plain)).toBe(false);
        expect(hasBandingLike(plain)).toBe(true);

        expect(hasBanding(variant)).toBe(false);
        expect(hasBandsWithOther(variant)).toBe(true);
        expect(hasBandingLike(variant)).toBe(true);

        expect(hasBandingLike(vanilla)).toBe(false);
    });

    it("canFormBand: plain banding band", () => {
        expect(
            canFormBand([
                creature(FROST_GIANT, ["banding"], "a"),
                creature(FROST_GIANT, [], "b"),
            ])
        ).toBe(true);
    });

    it("canFormBand: legendary bands-with-other band of two legendaries", () => {
        expect(
            canFormBand([
                creature(HUNDING, ["bands with other:legendary"], "a"),
                creature(MARHAULT, [], "b"),
            ])
        ).toBe(true);
    });

    it("canFormBand rejects a non-legendary member in a legendary band", () => {
        expect(
            canFormBand([
                creature(HUNDING, ["bands with other:legendary"], "a"),
                creature(FROST_GIANT, [], "b"),
            ])
        ).toBe(false);
    });

    it("canFormBand: name-quality band of same-named members", () => {
        expect(
            canFormBand([
                creature(
                    HUNDING,
                    ["bands with other:name=Hunding Gjornersen"],
                    "a"
                ),
                creature(HUNDING, [], "b"),
            ])
        ).toBe(true);
    });

    it("canFormBand rejects a differently-named member in a name band", () => {
        expect(
            canFormBand([
                creature(
                    HUNDING,
                    ["bands with other:name=Hunding Gjornersen"],
                    "a"
                ),
                creature(MARHAULT, [], "b"),
            ])
        ).toBe(false);
    });
});
