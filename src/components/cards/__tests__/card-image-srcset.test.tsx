// Per-surface rendition strategy — CardImage's `includeThumb` prop.
//
// Scryfall's `thumb` 146w rendition is the most compressed and reads visibly
// soft on mid-size slots (hand/stack/battlefield ≥96px) on 1× displays, so
// those surfaces pass `includeThumb={false}` to drop it from the srcset.
// Small slots keep the default (bytes matter, artifacts invisible there).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

// CardPreview owns the hover dock and pulls in game-context / portal machinery
// irrelevant to this attribute test — stub it to render its children inline so
// we observe the real <img> CardImage emits.
vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardImage from "../card-image";

// A real registered card id so `resolveCardImageId` yields an image (the <img>
// branch renders rather than the TokenPlaceholder fallback). Any non-`token:`
// id resolves to itself; this is LEA Lightning Bolt's definitionId.
const CARD_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

describe("CardImage includeThumb srcset strategy", () => {
    beforeEach(() => cleanup());

    it("keeps the 146w thumb rendition in the srcset by default", () => {
        const { container } = render(<CardImage card={{ id: CARD_ID }} />);
        const srcset = container.querySelector("img")!.getAttribute("srcset");
        expect(srcset).toContain("/thumb/");
        expect(srcset).toContain("146w");
    });

    it("drops the thumb rendition when includeThumb is false", () => {
        const { container } = render(
            <CardImage card={{ id: CARD_ID }} includeThumb={false} />
        );
        const srcset = container.querySelector("img")!.getAttribute("srcset");
        expect(srcset).not.toContain("/thumb/");
        expect(srcset).toContain("488w");
        expect(srcset).toContain("672w");
    });

    it("forwards the sizes hint to the img", () => {
        const { container } = render(
            <CardImage card={{ id: CARD_ID }} sizes="120px" />
        );
        expect(container.querySelector("img")!.getAttribute("sizes")).toBe(
            "120px"
        );
    });
});
