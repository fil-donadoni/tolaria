// Issue #502 (PRD #501) — opt-in lazy art on CardImage.
//
// CardImage is shared between the battlefield (mounted thousands of times per
// render, must fetch eagerly) and the deck-builder search grid (off-screen
// results should defer their art fetch). The `lazy` prop controls native
// `loading="lazy"` on the underlying <img>; it must default OFF so in-game
// usages are unchanged, and be present ONLY when explicitly set.
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

describe("CardImage lazy art (#502)", () => {
    beforeEach(() => cleanup());

    it("does NOT set loading=lazy by default", () => {
        const { container } = render(<CardImage card={{ id: CARD_ID }} />);
        const img = container.querySelector("img");
        expect(img).toBeTruthy();
        expect(img!.getAttribute("loading")).toBeNull();
    });

    it("sets loading=lazy when the lazy prop is passed", () => {
        const { container } = render(<CardImage card={{ id: CARD_ID }} lazy />);
        const img = container.querySelector("img");
        expect(img).toBeTruthy();
        expect(img!.getAttribute("loading")).toBe("lazy");
    });

    it("does NOT set loading=lazy when lazy is explicitly false", () => {
        const { container } = render(
            <CardImage card={{ id: CARD_ID }} lazy={false} />
        );
        expect(
            container.querySelector("img")!.getAttribute("loading")
        ).toBeNull();
    });
});
