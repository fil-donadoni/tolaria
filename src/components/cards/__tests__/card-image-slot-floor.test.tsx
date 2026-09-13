// The measured image-quality floor — issue #3553.
//
// The `sizes` hint used to be a hand-written constant per call site, and ~18
// call sites wrote nothing at all and inherited the board's 140px while
// rendering into a 180-260px slot. That resolves a rendition below the slot's
// device-pixel width, which is the "art looks soft until I nudge the window"
// defect: a resize re-evaluates the candidate and the image silently repairs
// itself.
//
// `CardImage` now MEASURES the slot it paints into and derives both the hint
// and `thumb`'s presence from it. happy-dom has no layout engine — every rect
// is zero — so this file stubs `getBoundingClientRect` on the slot element the
// way the ui-gate probe tests stub theirs; the real five-viewport measurement
// is `check:ui`'s `cardsSoft`, which is the enforcement. What IS testable here
// is the wiring: that a measured slot reaches the attributes at all, and that
// the no-source-before-measurement rule holds.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("../card-preview", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CardImage from "../card-image";

const CARD_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

/** Make every element in the document report `width` — the slot wrapper
 *  included, which is the box `useCardSlotFloor` observes. Restored per test.
 */
function stubLayout(width: number, dpr: number) {
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalDpr = window.devicePixelRatio;
    Element.prototype.getBoundingClientRect = function () {
        return {
            width,
            height: width * 1.4,
            left: 0,
            top: 0,
            right: width,
            bottom: width * 1.4,
            x: 0,
            y: 0,
            toJSON() {},
        } as DOMRect;
    };
    Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: dpr,
    });
    return () => {
        Element.prototype.getBoundingClientRect = originalRect;
        Object.defineProperty(window, "devicePixelRatio", {
            configurable: true,
            value: originalDpr,
        });
    };
}

describe("CardImage derives its srcset hint from the measured slot (issue #3553)", () => {
    let restore: (() => void) | null = null;
    beforeEach(() => cleanup());
    afterEach(() => {
        restore?.();
        restore = null;
    });

    it("declares the measured slot width, not the call site's constant", () => {
        // The reported defect: the draft pack card declared `sizes="180px"`
        // while its slot painted wider. The declaration now comes from the
        // slot, so a stale prop cannot under-declare — 208 rounds up to 208.
        restore = stubLayout(208, 2);
        const { container } = render(
            <CardImage card={{ id: CARD_ID }} sizes="140px" />
        );
        expect(container.querySelector("img")!.getAttribute("sizes")).toBe(
            "208px"
        );
    });

    it("drops thumb once the measured slot outgrows its 146 real pixels", () => {
        // The other half of the defect: `thumb` left in the candidate list for
        // a slot more than twice its own width. 180 CSS px at 2x needs 360.
        restore = stubLayout(180, 2);
        const { container } = render(<CardImage card={{ id: CARD_ID }} />);
        const srcset = container.querySelector("img")!.getAttribute("srcset");
        expect(srcset).not.toContain("/thumb/");
    });

    it("keeps thumb for a genuinely small measured slot", () => {
        // A floor, not a blanket upgrade: a 64px chip at 1x is covered by
        // thumb's 146 pixels and must keep fetching it.
        restore = stubLayout(64, 1);
        const { container } = render(
            <CardImage card={{ id: CARD_ID }} includeThumb={false} />
        );
        const srcset = container.querySelector("img")!.getAttribute("srcset");
        expect(srcset).toContain("/thumb/");
    });

    it("falls back to the declared hint when the slot cannot be measured", () => {
        // No layout engine (this test environment, and a zero-width box in a
        // real browser). The call site's prop is the escape hatch, and it must
        // still reach the element — otherwise every happy-dom render of every
        // card surface would emit an image with no responsive attributes.
        const { container } = render(
            <CardImage card={{ id: CARD_ID }} sizes="112px" />
        );
        expect(container.querySelector("img")!.getAttribute("sizes")).toBe(
            "112px"
        );
    });

    it("renders the printed-face marker the ui-gate probe measures", () => {
        // `cardsSoft` is scoped to `data-card-face="printed"`. Losing the
        // marker does not fail any assertion about the image — it silently
        // empties the gate's scope, which is the worst of both outcomes.
        const { container } = render(<CardImage card={{ id: CARD_ID }} />);
        expect(
            container.querySelector('img[data-card-face="printed"]')
        ).not.toBeNull();
    });
});
