// `flyCard` landing resolution (issue #5395). The form-level contract (move
// never deferred, reduced motion creates nothing) lives in
// `pool-deck-builder-form.fly.test.tsx`; this pins the helper's own branches:
// where it lands when the destination is off screen, and that it creates
// nothing when there is nowhere to land. No assertion on the animation itself.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { CARD_FLY_ATTR, flyCard } from "../cardFly";

let frames: FrameRequestCallback[] = [];
const animate = vi.fn(() => ({ onfinish: null, oncancel: null }));

function flushFrames() {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
}

/** An element whose layout box is `rect` (happy-dom has no layout). */
function boxed(rect: DOMRect, attrs: Record<string, string> = {}): HTMLElement {
    const el = document.createElement("div");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.getBoundingClientRect = () => rect;
    document.body.appendChild(el);
    return el;
}

const ON_SCREEN = new DOMRect(10, 10, 100, 140);
const OFF_SCREEN = new DOMRect(5000, 10, 100, 140);

beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
    });
    vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: false }))
    );
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
});

afterEach(() => {
    vi.unstubAllGlobals();
    animate.mockClear();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    document.body.innerHTML = "";
});

const ghosts = () => document.querySelectorAll(`[${CARD_FLY_ATTR}]`);

describe("flyCard — landing resolution (issue #5395)", () => {
    it("flies to the stand-in when the destination is off screen, leaving the stand-in visible", () => {
        const source = boxed(ON_SCREEN, {
            role: "button",
            "data-card-copy": "1",
        });
        const dest = boxed(OFF_SCREEN);
        const tab = boxed(new DOMRect(200, 0, 80, 40));
        flyCard(source, { destination: () => dest, standIn: () => tab });
        flushFrames();
        expect(ghosts()).toHaveLength(1);
        expect(tab.style.visibility).toBe("");
    });

    it("hides the real destination while the copy is in flight", () => {
        const source = boxed(ON_SCREEN);
        const dest = boxed(new DOMRect(300, 300, 100, 140));
        flyCard(source, { destination: () => dest });
        flushFrames();
        expect(dest.style.visibility).toBe("hidden");
    });

    it("the flying copy is inert: aria-hidden, no role, no data handle of the tile it copies", () => {
        const source = boxed(ON_SCREEN, {
            role: "button",
            "data-card-copy": "1",
        });
        const dest = boxed(new DOMRect(300, 300, 100, 140));
        flyCard(source, { destination: () => dest });
        flushFrames();
        const ghost = ghosts()[0]!;
        expect(ghost.getAttribute("aria-hidden")).toBe("true");
        expect(ghost.hasAttribute("role")).toBe(false);
        expect(ghost.hasAttribute("data-card-copy")).toBe(false);
    });

    it("creates nothing when neither the destination nor a stand-in is on screen", () => {
        const source = boxed(ON_SCREEN);
        flyCard(source, {
            destination: () => null,
            standIn: () => boxed(OFF_SCREEN),
        });
        flushFrames();
        expect(ghosts()).toHaveLength(0);
        expect(animate).not.toHaveBeenCalled();
    });
});
