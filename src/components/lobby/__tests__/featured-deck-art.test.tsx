// Featured-art renderer (PRD #589, issue #600): a deck's resolved Featured Card
// ID is painted via the shared image layer (art_crop), and a deck with no
// resolvable art falls back to an in-app placeholder instead of a broken image.
// See `../featured-deck-art`.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import FeaturedDeckArt from "../featured-deck-art";

// A real preset Scryfall printing id (non-token), so resolveCardImageId returns
// the same id and the art_crop URL is well-formed.
const REAL_CARD_ID = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";

describe("FeaturedDeckArt (issue #600)", () => {
    it("renders the art_crop image for a resolved Featured Card ID", () => {
        const { container } = render(
            <FeaturedDeckArt featuredCardId={REAL_CARD_ID} />
        );
        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        const expected = getArtCropImageUrl(resolveCardImageId(REAL_CARD_ID)!);
        expect(img!.getAttribute("src")).toBe(expected);
        // The source derives from the shared resolver, not a hand-built URL.
        expect(expected).toContain("art_crop");
        expect(expected).toContain(REAL_CARD_ID);
    });

    it("renders the no-art fallback for a deck with no featured card", () => {
        const { container } = render(<FeaturedDeckArt featuredCardId={null} />);
        // No <img> at all — the placeholder is an inline SVG icon, never a
        // broken image element.
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("svg")).not.toBeNull();
    });

    it("renders the fallback for an unresolvable (token) card id", () => {
        // A synthetic token id resolves to null (no printed art) — the renderer
        // must show the placeholder, never the synthetic id as an <img> src.
        const { container } = render(
            <FeaturedDeckArt featuredCardId="token:Goblin|R|1/1" />
        );
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("svg")).not.toBeNull();
    });
});
