// Copy card preview — the body builder (CR 707.2). A copy permanent's preview
// shows two faces: the CURRENT (presented) identity built from the live
// instance, and the ORIGINAL (printed) identity built from `copiedFrom` with no
// instance/context. This suite pins the ORIGINAL-face contract: a printed
// snapshot independent of any live-instance overrides.
import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import { buildPreviewBody } from "~/lib/preview-body";
import type { CardInstance } from "~/types/game";

const CLONE = getCardByName("Clone");
const SERRA = getCardByName("Serra Angel");
const TERRAIN = getCardByName("Illusionary Terrain");

describe("buildPreviewBody — original (printed) face (CR 707.2)", () => {
    it("returns the printed identity of the copiedFrom card", () => {
        const original = buildPreviewBody(CLONE.id);

        expect(original.displayName).toBe("Clone");
        // Printed art comes from Clone's own image id, not the copied object.
        expect(original.imageSrc).toContain(CLONE.id);
        // Primary is the `art` WebP; the art_crop JPG rides along as fallback.
        expect(original.imageSrc).toContain("/art/");
        expect(original.imageFallbackSrc).toContain("/art_crop/");
        expect(original.imageFallbackSrc).toContain(CLONE.id);
        expect(original.typeLine).toContain("Creature");
        // Clone is printed 0/0 (its copiable P/T comes only from a copy effect).
        expect(original.basePower).toBe(CLONE.power);
        expect(original.baseToughness).toBe(CLONE.toughness);
    });

    it("ignores live-instance overrides — it never reads an instance", () => {
        // A copy instance presenting as Serra Angel, with pumped P/T and a
        // color override. The ORIGINAL face is built from `copiedFrom` ONLY, so
        // none of these live fields leak into it.
        const copyInstance = {
            id: "inst-1",
            card: { id: SERRA.id },
            copiedFrom: CLONE.id,
            types: SERRA.types,
            subtypes: SERRA.subtypes ?? [],
            power: 99,
            toughness: 99,
            staticAbilities: SERRA.staticAbilities ?? [],
            colorOverride: ["red"],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            isSummoningSick: false,
        } as unknown as CardInstance;

        const original = buildPreviewBody(copyInstance.copiedFrom!);

        expect(original.displayName).toBe("Clone");
        expect(original.basePower).toBe(CLONE.power);
        expect(original.effPower).toBe(CLONE.power); // no instance ⇒ printed
        expect(original.ptModified).toBe(false);
        expect(original.colorName).toBeNull();
        expect(original.ownerName).toBeNull();
    });

    it("current face presents the copied object's identity", () => {
        const copyInstance = {
            id: "inst-1",
            card: { id: SERRA.id },
            copiedFrom: CLONE.id,
            types: SERRA.types,
            subtypes: SERRA.subtypes ?? [],
            power: SERRA.power,
            toughness: SERRA.toughness,
            staticAbilities: SERRA.staticAbilities ?? [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            isSummoningSick: false,
        } as unknown as CardInstance;

        // Presented (current) face: built from card.id (Serra Angel).
        const current = buildPreviewBody(
            SERRA.id,
            copyInstance,
            { allPlayers: [], playerId: "p1" },
            "Serra Angel"
        );
        expect(current.displayName).toBe("Serra Angel");
        expect(current.hasPT).toBe(true);
    });
});

describe("buildPreviewBody — Illusionary Terrain chosen types (CR 614.12, ADR 0050)", () => {
    function terrainInstance(chosenSubtypes?: string[]): CardInstance {
        return {
            id: "terr-1",
            card: { id: TERRAIN.id },
            types: TERRAIN.types,
            subtypes: TERRAIN.subtypes ?? [],
            staticAbilities: TERRAIN.staticAbilities ?? [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            isSummoningSick: false,
            ...(chosenSubtypes ? { chosenSubtypes } : {}),
        } as unknown as CardInstance;
    }

    it("splices the chosen pair into the oracle text once picked", () => {
        const body = buildPreviewBody(
            TERRAIN.id,
            terrainInstance(["Forest", "Island"]),
            { allPlayers: [], playerId: "p1" }
        );
        const joined = (body.oracleParagraphs ?? []).join("\n");
        expect(joined).toContain(
            "Basic lands of the Forest type are the Island type."
        );
        expect(joined).not.toContain("first chosen type");
        expect(joined).not.toContain("second chosen type");
    });

    it("shows the printed placeholder text before a pair is chosen", () => {
        const body = buildPreviewBody(TERRAIN.id, terrainInstance(), {
            allPlayers: [],
            playerId: "p1",
        });
        const joined = (body.oracleParagraphs ?? []).join("\n");
        expect(joined).toContain(
            "Basic lands of the first chosen type are the second chosen type."
        );
    });
});
