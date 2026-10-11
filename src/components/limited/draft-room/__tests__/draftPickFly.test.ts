// Draft Room pick fly (issue #5397): the flight is cosmetic and resolves its
// own landing. Pool and Sideboard picks fly to DISTINCT destinations, and a
// hidden pane hands the flight to the phone strip's half for that zone. No
// assertion on the animation's keyframes or timing.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { CARD_FLY_ATTR } from "~/lib/cardFly";
import { flyDraftPick } from "../draftPickFly";

let frames: FrameRequestCallback[] = [];
const animate = vi.fn(() => ({ onfinish: null, oncancel: null }));
const flushFrames = () => {
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(0);
};

function boxed(
    rect: DOMRect,
    attrs: Record<string, string>,
    parent: Element = document.body
): HTMLElement {
    const el = document.createElement("div");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.getBoundingClientRect = () => rect;
    parent.appendChild(el);
    return el;
}

const PACK_TILE = new DOMRect(10, 10, 100, 140);
const POOL_SPOT = new DOMRect(300, 300, 100, 140);
const SIDE_SPOT = new DOMRect(500, 300, 100, 140);
const OFF_SCREEN = new DOMRect(5000, 10, 100, 140);

function mountRoom(poolRect: DOMRect) {
    boxed(PACK_TILE, { "data-draft-pick-tile": "", "data-pick-id": "p1" });
    const pool = boxed(new DOMRect(0, 0, 10, 10), {
        "data-deck-pane": "maindeck",
    });
    const side = boxed(new DOMRect(0, 0, 10, 10), {
        "data-deck-pane": "sideboard",
    });
    return {
        poolTile: boxed(poolRect, { "data-card-copy": "7" }, pool),
        sideTile: boxed(SIDE_SPOT, { "data-card-copy": "7" }, side),
    };
}

const ghost = () => document.querySelector(`[${CARD_FLY_ATTR}]`);

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
    document.documentElement.removeAttribute("data-motion");
});

describe("flyDraftPick (issue #5397)", () => {
    it("a Pool pick lands on the new Pool tile, hiding it while in flight", () => {
        const { poolTile, sideTile } = mountRoom(POOL_SPOT);
        flyDraftPick("p1", "maindeck", 7);
        flushFrames();
        expect(ghost()).not.toBeNull();
        expect(poolTile.style.visibility).toBe("hidden");
        expect(sideTile.style.visibility).toBe("");
    });

    it("a Sideboard pick lands on the Sideboard copy, not the Pool", () => {
        const { poolTile, sideTile } = mountRoom(POOL_SPOT);
        flyDraftPick("p1", "sideboard", 7);
        flushFrames();
        expect(sideTile.style.visibility).toBe("hidden");
        expect(poolTile.style.visibility).toBe("");
    });

    it("waits for the pick to come back from the server", () => {
        boxed(PACK_TILE, { "data-draft-pick-tile": "", "data-pick-id": "p1" });
        const pool = boxed(new DOMRect(0, 0, 10, 10), {
            "data-deck-pane": "maindeck",
        });
        flyDraftPick("p1", "maindeck", 7);
        flushFrames();
        expect(ghost()).toBeNull();
        boxed(POOL_SPOT, { "data-card-copy": "7" }, pool);
        flushFrames();
        expect(ghost()).not.toBeNull();
    });

    it("flies to the strip half when the pane is off screen", () => {
        mountRoom(OFF_SCREEN);
        const strip = boxed(new DOMRect(0, 600, 200, 40), {
            "data-slot": "draft-strip-drop",
            "data-zone": "maindeck",
        });
        flyDraftPick("p1", "maindeck", 7);
        flushFrames();
        expect(ghost()).not.toBeNull();
        expect(strip.style.visibility).toBe("");
    });

    it("creates nothing under reduced motion", () => {
        mountRoom(POOL_SPOT);
        document.documentElement.dataset.motion = "reduced";
        flyDraftPick("p1", "maindeck", 7);
        flushFrames();
        expect(ghost()).toBeNull();
        expect(frames).toHaveLength(0);
    });
});
