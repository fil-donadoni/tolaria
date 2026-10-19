// Issue #5664 — the pinned anchored preview re-clamps when its size or the
// viewport changes after mount (Live text / Printed card toggle, engine view,
// late image load, window resize), not only at first paint, and its body is a
// scroll container so a capped panel scrolls instead of clipping.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRef } from "react";
import CardPreviewAnchored from "../card-preview-anchored";
import type { PreviewBodyContent } from "~/lib/preview-body";

const CONTENT: PreviewBodyContent = {
    cardName: "Lightning Bolt",
    displayName: "Lightning Bolt",
    imageSrc: null,
    imageFallbackSrc: null,
    printedImageSrc: null,
    printedImageId: null,
    types: ["Instant"],
    subtypes: [],
    staticAbilities: [],
    manaCost: "{R}",
    typeLine: "Instant",
    oracleParagraphs: ["Lightning Bolt deals 3 damage to any target."],
    bodyAbilities: { keywords: [], activated: [], triggered: [] },
    hasBody: false,
    hasPT: false,
    ptModified: false,
    counterDisplays: [],
    colorName: "Red",
    ownerName: null,
    attachedToName: null,
    abilityWordCounters: null,
    isManualGame: false,
};

const VH = 900;
const PAD = 8;
let panelHeight = 300;
const observers: Array<() => void> = [];

function rect(top: number, left: number, width: number, height: number) {
    return {
        top,
        left,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

beforeEach(() => {
    panelHeight = 300;
    observers.length = 0;
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", VH);
    vi.stubGlobal(
        "ResizeObserver",
        class {
            cb: () => void;
            constructor(cb: () => void) {
                this.cb = cb;
            }
            // Only an OBSERVED panel re-clamps: the callback is reachable
            // from the test solely through `observe`.
            observe() {
                observers.push(this.cb);
            }
            disconnect() {}
        }
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
        function (this: HTMLElement) {
            if (this.hasAttribute("data-card-preview-anchored"))
                return rect(0, 0, 330, panelHeight);
            // The anchor: a hand card in the lowest row of the board.
            return rect(780, 600, 90, 120);
        }
    );
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function mount() {
    const anchorRef = createRef<HTMLDivElement>();
    render(
        <>
            <div ref={anchorRef} />
            <CardPreviewAnchored
                {...CONTENT}
                size="sm"
                imageLoaded
                anchorRef={anchorRef}
            />
        </>
    );
    return document.querySelector(
        "[data-card-preview-anchored]"
    ) as HTMLElement;
}

const topOf = (el: HTMLElement) => parseFloat(el.style.top);

describe("CardPreviewAnchored stays inside the viewport after mount (issue #5664)", () => {
    it("clamps the hand card's preview above the bottom edge at mount", () => {
        const panel = mount();
        expect(topOf(panel) + panelHeight).toBeLessThanOrEqual(VH - PAD);
    });

    it("re-clamps when the panel grows after mount", () => {
        const panel = mount();
        expect(topOf(panel)).toBe(VH - PAD - 300);
        panelHeight = 640;
        act(() => observers.forEach((fire) => fire()));
        expect(topOf(panel)).toBe(VH - PAD - 640);
    });

    it("re-clamps when the window shrinks", () => {
        const panel = mount();
        vi.stubGlobal("innerHeight", 500);
        act(() => {
            window.dispatchEvent(new Event("resize"));
        });
        expect(topOf(panel) + panelHeight).toBeLessThanOrEqual(500 - PAD);
    });

    it("hosts the body in a scroll container so a capped panel scrolls", () => {
        const panel = mount();
        const scroll = panel.querySelector("[data-card-preview-scroll]");
        expect(scroll?.className).toContain("overflow-y-auto");
        expect(scroll?.className).toContain("min-h-0");
    });
});
