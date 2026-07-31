// Copy card preview — the body builder (CR 707.2). A copy permanent's preview
// shows two faces: the CURRENT (presented) identity built from the live
// instance, and the ORIGINAL (printed) identity built from `copiedFrom` with no
// instance/context. This suite pins the ORIGINAL-face contract: a printed
// snapshot independent of any live-instance overrides.
import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import { buildPreviewBody, buildEmblemPreviewBody } from "~/lib/preview-body";
import type { CardInstance } from "~/types/game";
import type { EmblemInstance } from "@convex/cards/types";

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
        // Phase 2: the printed-card toggle surface resolves to the grid WebP
        // of the card's own printing.
        expect(original.printedImageSrc).toContain("/grid/");
        expect(original.printedImageSrc).toContain(CLONE.id);
        expect(original.printedImageSrc).toContain(".webp");
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

describe("buildEmblemPreviewBody — command-zone emblem face (CR 114, issue #1221)", () => {
    const SORIN_ART = "327ddaaf-b6a7-4c80-9b38-5ab68181b3d6";
    const emblem: EmblemInstance = {
        id: "emblem-1",
        ownerId: "p1",
        emblemId: "sorin-lord-of-innistrad-emblem",
        name: "Sorin, Lord of Innistrad emblem",
        text: "Creatures you control get +1/+0.",
        imagePrintId: SORIN_ART,
    };

    it("builds the emblem face from the denormalized wire fields (no registry)", () => {
        const body = buildEmblemPreviewBody(emblem);

        expect(body.displayName).toBe("Sorin, Lord of Innistrad emblem");
        expect(body.typeLine).toBe("Emblem");
        // Oracle text becomes the preview's paragraphs.
        expect(body.oracleParagraphs).toEqual([
            "Creatures you control get +1/+0.",
        ]);
        // Art resolves from the print id via the shared image helpers: `art`
        // WebP primary, art_crop JPG fallback, grid WebP for the printed toggle.
        expect(body.imageSrc).toContain("/art/");
        expect(body.imageSrc).toContain(SORIN_ART);
        expect(body.imageFallbackSrc).toContain("/art_crop/");
        expect(body.printedImageSrc).toContain("/grid/");
        // An emblem is pure text — no P/T, mana cost, counters, or chips.
        expect(body.hasPT).toBe(false);
        expect(body.hasBody).toBe(false);
        expect(body.manaCost).toBeNull();
    });

    it("falls back to a null image (in-app placeholder) when no art print id", () => {
        const body = buildEmblemPreviewBody({
            ...emblem,
            imagePrintId: undefined,
        });
        expect(body.imageSrc).toBeNull();
        expect(body.imageFallbackSrc).toBeNull();
        expect(body.printedImageSrc).toBeNull();
        // The oracle text still shows so the placeholder is informative.
        expect(body.oracleParagraphs).toEqual([
            "Creatures you control get +1/+0.",
        ]);
    });
});

// CR 700.2c — a permanent that locked in a mode as it entered (Chromatic Armor
// / Prismatic Ward: "As this Aura enters, choose a color") must SAY which one
// in its live rules box. The printed text only says "the last chosen color",
// and on Chromatic Armor that colour changes during the game via its {X}
// re-choose, so the board had no way to read the current answer.
describe("buildPreviewBody — chosen mode in the live oracle text", () => {
    const CHROMATIC_ARMOR_ID = "2657e85b-8f77-41fa-9df2-233443efef43";

    function armor(chosenModeId?: string): CardInstance {
        return {
            id: "armor-1",
            card: { id: CHROMATIC_ARMOR_ID },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            types: ["Enchantment"],
            subtypes: ["Aura"],
            ...(chosenModeId ? { chosenModeId } : {}),
        } as CardInstance;
    }

    it("names the chosen colour next to the printed phrase", () => {
        const body = buildPreviewBody(CHROMATIC_ARMOR_ID, armor("W"));
        const line = body.oracleParagraphs?.find((p) =>
            /chosen color/i.test(p)
        );
        expect(line).toBeDefined();
        expect(line).toContain("(white)");
    });

    it("tracks a re-choose", () => {
        const body = buildPreviewBody(CHROMATIC_ARMOR_ID, armor("R"));
        expect(
            body.oracleParagraphs?.find((p) => /chosen color/i.test(p))
        ).toContain("(red)");
    });

    it("leaves the printed text alone before a colour is chosen", () => {
        const body = buildPreviewBody(CHROMATIC_ARMOR_ID, armor());
        expect(body.oracleParagraphs?.some((p) => p.includes("("))).toBe(false);
    });
});

// CR 614.12 / 201.3 — a permanent that named a card as it entered (Meddling
// Mage) must SAY which one in its live rules box. The printed text only says
// "the chosen name", and the pick is per-instance: two Mages on the same board
// lock different cards, so without this the board had no way to read either.
describe("buildPreviewBody — chosen card name in the live oracle text", () => {
    const MEDDLING_MAGE = getCardByName("Meddling Mage");

    function mage(chosenName?: string): CardInstance {
        return {
            id: "mage-1",
            card: { id: MEDDLING_MAGE.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            types: ["Creature"],
            subtypes: ["Human", "Wizard"],
            ...(chosenName ? { chosenName } : {}),
        } as CardInstance;
    }

    it("names the chosen card next to the printed phrase", () => {
        const body = buildPreviewBody(MEDDLING_MAGE.id, mage("Lightning Bolt"));
        const line = body.oracleParagraphs?.find((p) => /chosen name/i.test(p));
        expect(line).toBeDefined();
        expect(line).toContain("(Lightning Bolt)");
    });

    it("is per-instance — a second Mage shows its own pick", () => {
        const body = buildPreviewBody(MEDDLING_MAGE.id, mage("Counterspell"));
        expect(
            body.oracleParagraphs?.find((p) => /chosen name/i.test(p))
        ).toContain("(Counterspell)");
    });

    it("leaves the printed text alone before a name is chosen (CR 400.7 — a reanimated Mage has none)", () => {
        const body = buildPreviewBody(MEDDLING_MAGE.id, mage());
        expect(body.oracleParagraphs?.some((p) => p.includes("("))).toBe(false);
    });
});
