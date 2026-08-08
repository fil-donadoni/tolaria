// The preview's art box must hold ART_CROP_RATIO for EVERY source aspect.
//
// `aspect-ratio` sizes a box only while its content doesn't demand more. An
// IN-FLOW `<img className="w-full h-full">` resolves `h-full` against a parent
// that is still `height: auto`, falls back to its intrinsic aspect, and
// stretches the box — `object-fit` never gets a chance because the element is
// auto-sized to the image. Landscape art (nearly the whole catalogue) sits
// close enough to 563/451 that nothing shows; a Saga's art_crop is PORTRAIT
// (Urza's Saga is 312×752) and turned the preview into a tall column.
//
// jsdom has no layout engine, so this asserts the CSS contract that makes the
// ratio authoritative: the box clips, and the img is out of flow and covering.
// Those three together are what force a centre crop.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import CardPreviewFace from "../card-preview-face";
import { ART_CROP_RATIO } from "~/lib/images";
import type { PreviewBodyContent } from "~/lib/preview-body";

afterEach(cleanup);

const CONTENT: PreviewBodyContent = {
    cardName: "Urza's Saga",
    displayName: "Urza's Saga",
    // A portrait art_crop — the shape that broke the box.
    imageSrc: "https://cards.scryfall.io/art/front/c/1/saga.webp",
    imageFallbackSrc: "https://cards.scryfall.io/art_crop/front/c/1/saga.jpg",
    printedImageSrc: null,
    types: ["Enchantment", "Land"],
    subtypes: ["Urza's", "Saga"],
    staticAbilities: [],
    manaCost: null,
    typeLine: "Enchantment Land — Urza's Saga",
    oracleParagraphs: null,
    bodyAbilities: { keywords: [], activated: [], triggered: [] },
    hasBody: false,
    hasPT: false,
    ptModified: false,
    counterDisplays: [],
    colorName: null,
    ownerName: null,
    attachedToName: null,
    milestones: null,
    isManualGame: false,
};

describe("card preview art box (portrait art, e.g. a Saga)", () => {
    it("clips to ART_CROP_RATIO and centre-crops the art out of flow", () => {
        const { container } = render(
            <CardPreviewFace {...CONTENT} size="sm" />
        );
        const img = container.querySelector("img")!;
        const box = img.parentElement!;

        expect(box.style.aspectRatio).toBe(ART_CROP_RATIO);
        // Clips, so tall art can never grow the box.
        expect(box.className).toContain("overflow-hidden");
        // Out of flow, so the box's height is not derived from the image.
        expect(img.className).toContain("absolute");
        expect(img.className).toContain("inset-0");
        // Fills and centre-crops whatever aspect the source has.
        expect(img.className).toContain("object-cover");
        expect(img.className).toContain("w-full");
        expect(img.className).toContain("h-full");
    });
});
