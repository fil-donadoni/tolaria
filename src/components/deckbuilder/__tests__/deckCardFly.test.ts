// A move into a pane that is not on screen flies to that pane's TAB label,
// which pulses on arrival (issue #5400). happy-dom has no layout or Web
// Animations, so the boxes and `animate` are stubbed; what is asserted is
// WHICH element the copy flies to and which one pulses — never the keyframes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CARD_FLY_ATTR } from "~/lib/cardFly";
import { flyDeckCard } from "../deckCardFly";

let frames: FrameRequestCallback[] = [];
const rects = new Map<Element, DOMRect>();
const animated: Element[] = [];

function mountDom() {
    document.body.innerHTML = `
        <div data-deck-pane-tab="maindeck-creatures"></div>
        <div data-deck-pane-tab="maindeck-others"></div>
        <div data-deck-pane="sideboard">
            <div data-card-copy="serra"></div>
        </div>`;
    const box = (sel: string, r: DOMRect) =>
        rects.set(document.querySelector(sel)!, r);
    box(
        '[data-deck-pane="sideboard"] [data-card-copy]',
        new DOMRect(5, 100, 80, 112)
    );
    box(
        '[data-deck-pane-tab="maindeck-creatures"]',
        new DOMRect(10, 4, 90, 40)
    );
    box('[data-deck-pane-tab="maindeck-others"]', new DOMRect(110, 4, 90, 40));
}

beforeEach(() => {
    frames = [];
    rects.clear();
    animated.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
    });
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {},
        }))
    );
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
            return rects.get(this) ?? new DOMRect(0, 0, 0, 0);
        }
    );
    (Element.prototype as unknown as { animate: unknown }).animate = function (
        this: Element
    ) {
        animated.push(this);
        const animation = {
            onfinish: null as null | (() => void),
            oncancel: null,
        };
        queueMicrotask(() => animation.onfinish?.());
        return animation;
    };
    mountDom();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    document.body.innerHTML = "";
});

const flush = () => {
    const queued = frames;
    frames = [];
    queued.forEach((cb) => cb(0));
};

describe("flyDeckCard to a hidden pane's tab", () => {
    it("flies to the tab of the band the card lands in, and that tab pulses", async () => {
        flyDeckCard("sideboard", "maindeck", "serra", "maindeck-creatures");
        flush();
        const ghost = document.querySelector(`[${CARD_FLY_ATTR}]`);
        expect(ghost).not.toBeNull();
        expect(animated).toContain(ghost);
        await Promise.resolve();
        await Promise.resolve();
        const tab = document.querySelector(
            '[data-deck-pane-tab="maindeck-creatures"]'
        );
        const other = document.querySelector(
            '[data-deck-pane-tab="maindeck-others"]'
        );
        expect(animated).toContain(tab);
        expect(animated).not.toContain(other);
    });

    it("flies to the zone's own tab when no pane is named", async () => {
        document.body.insertAdjacentHTML(
            "beforeend",
            '<div data-deck-pane-tab="maindeck"></div>'
        );
        const tab = document.querySelector('[data-deck-pane-tab="maindeck"]')!;
        rects.set(tab, new DOMRect(10, 4, 90, 40));
        flyDeckCard("sideboard", "maindeck", "serra");
        flush();
        await Promise.resolve();
        await Promise.resolve();
        expect(animated).toContain(tab);
    });
});
