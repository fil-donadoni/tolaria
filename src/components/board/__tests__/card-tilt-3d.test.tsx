// Slice #253 (PRD #249) — Arena-style hover interactions on Board cards.
//
// These tests assert the OBSERVABLE behavior of the imperative tilt+glare,
// not pixels (jsdom does not render real 3D): pointermove writes a tilt
// transform that varies with the pointer position, the glare is positioned at
// the pointer, pointer-leave resets the transform to flat and fades the glare,
// and the hover-zoom preview is anchored to the card element.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// motion's useReducedMotion reads matchMedia; default to "motion allowed".
let reduceMotion = false;
vi.mock("motion/react", () => ({
    useReducedMotion: () => reduceMotion,
}));

import CardTilt3D from "../card-tilt-3d";

/** Stub getBoundingClientRect on the tilt root so jsdom (which returns a 0×0
 *  box) yields a measurable card surface for the pointer math. */
function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
    const full: DOMRect = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
        ...rect,
    } as DOMRect;
    el.getBoundingClientRect = () => full;
}

function tiltRoot() {
    return document.querySelector<HTMLElement>("[data-card-tilt-root]")!;
}
function tiltInner() {
    return document.querySelector<HTMLElement>("[data-card-tilt]")!;
}
function glare() {
    return document.querySelector<HTMLElement>("[data-card-glare]")!;
}

/** Recover the rotateX/rotateY degrees from a transform string. */
function rotations(transform: string) {
    const rx = transform.match(/rotateX\(([-\d.]+)deg\)/);
    const ry = transform.match(/rotateY\(([-\d.]+)deg\)/);
    return { rx: Number(rx?.[1]), ry: Number(ry?.[1]) };
}

describe("CardTilt3D hover interactions (#253)", () => {
    beforeEach(() => {
        cleanup();
        reduceMotion = false;
    });

    it("tilts toward the cursor — transform varies with pointer position", () => {
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });

        // Pointer in the top-left quadrant.
        fireEvent.pointerMove(root, { clientX: 40, clientY: 40 });
        const topLeft = rotations(tiltInner().style.transform);

        // Pointer in the bottom-right quadrant.
        fireEvent.pointerMove(root, { clientX: 160, clientY: 240 });
        const bottomRight = rotations(tiltInner().style.transform);

        // The transform actually changed with the pointer (not a static value).
        expect(topLeft).not.toEqual(bottomRight);
        // rotateY follows horizontal offset: left → negative, right → positive.
        expect(topLeft.ry).toBeLessThan(0);
        expect(bottomRight.ry).toBeGreaterThan(0);
        // rotateX follows vertical offset (inverted): above center → positive,
        // below center → negative.
        expect(topLeft.rx).toBeGreaterThan(0);
        expect(bottomRight.rx).toBeLessThan(0);
    });

    it("applies a forward lift + scale on hover", () => {
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });
        fireEvent.pointerMove(root, { clientX: 100, clientY: 140 });
        const t = tiltInner().style.transform;
        expect(t).toMatch(/translateZ\(28px\)/);
        expect(t).toMatch(/scale\(1\.07\)/);
    });

    it("positions the glare at the pointer and makes it visible on hover", () => {
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });

        // Pointer at the exact center → glare centered at 50% 50%.
        fireEvent.pointerMove(root, { clientX: 100, clientY: 140 });
        expect(Number(glare().style.opacity)).toBeGreaterThan(0);
        expect(glare().style.background).toContain("50.00% 50.00%");

        // Move toward the top-left → glare follows the pointer (< 50%).
        fireEvent.pointerMove(root, { clientX: 50, clientY: 70 });
        expect(glare().style.background).toContain("25.00% 25.00%");
    });

    it("eases back to flat and fades the glare on pointer leave", () => {
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });
        fireEvent.pointerMove(root, { clientX: 30, clientY: 30 });
        expect(rotations(tiltInner().style.transform).ry).not.toBe(0);
        expect(Number(glare().style.opacity)).toBeGreaterThan(0);

        fireEvent.pointerLeave(root);
        const reset = rotations(tiltInner().style.transform);
        expect(reset.rx).toBe(0);
        expect(reset.ry).toBe(0);
        expect(tiltInner().style.transform).toMatch(/translateZ\(0px\)/);
        expect(tiltInner().style.transform).toMatch(/scale\(1\)/);
        expect(Number(glare().style.opacity)).toBe(0);
        // The reset uses the longer ease (so it's a smooth settle, not a snap).
        expect(tiltInner().style.transition).toContain("320ms");
    });

    it("uses a snappy transition while following the pointer", () => {
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });
        fireEvent.pointerMove(root, { clientX: 100, clientY: 140 });
        expect(tiltInner().style.transition).toContain("60ms");
    });

    it("keeps the glare inert so it never blocks the card's own pointer handlers", () => {
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        expect(glare().className).toContain("pointer-events-none");
    });

    it("suppresses the native context menu for any descendant (bubbling to the tilt root)", () => {
        // The board card's real `contextmenu` can land on the flattened art box
        // OUTSIDE the card's CardPreview handler; the tilt root, as a common
        // ancestor, cancels it deterministically so the native "Save image…"
        // menu never wins. A card WITHOUT the tilt (stack/graveyard) is
        // unaffected — this handler only exists here.
        render(
            <CardTilt3D>
                <div data-testid="face">
                    <span data-testid="deep" />
                </div>
            </CardTilt3D>
        );
        const deep = screen.getByTestId("deep");
        const ev = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
        });
        deep.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
    });

    it("does not stopPropagation the contextmenu (Base UI ability menu still opens)", () => {
        const ancestorSaw = vi.fn();
        render(
            // Bubble-phase ancestor listener: it runs AFTER the tilt root's own
            // bubble handler, so it fires only if the root did NOT stopPropagation.
            <div onContextMenu={ancestorSaw}>
                <CardTilt3D>
                    <div data-testid="face" />
                </CardTilt3D>
            </div>
        );
        const face = screen.getByTestId("face");
        face.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
        );
        // The event still reaches the ancestor (Base UI's ContextMenu trigger
        // relies on this to open the activated-ability menu).
        expect(ancestorSaw).toHaveBeenCalled();
    });

    it("renders its children (the card face) so text stays crisp DOM", () => {
        render(
            <CardTilt3D>
                <div data-testid="face">Lightning Bolt</div>
            </CardTilt3D>
        );
        expect(screen.getByTestId("face").textContent).toBe("Lightning Bolt");
    });

    it("disables tilt + glare entirely under prefers-reduced-motion", () => {
        reduceMotion = true;
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });
        // No pointer handlers are attached, so a move is a no-op — the inner
        // element keeps its (empty) inline transform and the glare stays hidden.
        fireEvent.pointerMove(root, { clientX: 30, clientY: 30 });
        expect(tiltInner().style.transform).toBe("");
        expect(glare().style.opacity).toBe("");
    });
});

// Issue #2551 — a tapped permanent rotates its visual layer 90° clockwise
// inside an UNROTATED slot box (#1994), and `CardTilt3D` deliberately wraps
// that rotated layer from the outside (#1994 round 4 — moving it inside kills
// every pointer handler on a tapped card). So the fix is a frame change, not
// a DOM change: `visualRotationDeg` tells the tilt what rotation is applied
// beneath it, and both of its outputs move into the card's frame.
//
// The reference geometry (rect 200×280, centre 100,140, `rotate(90deg)`
// clockwise so the card's own "up" points at slot +x):
//
//   card-frame offset (cx, cy)  →  slot pixel (100 + 200·cx·cos - 280·cy·sin,
//                                              140 + 200·cx·sin + 280·cy·cos)
describe("CardTilt3D under a tapped permanent's 90° rotation (#2551)", () => {
    beforeEach(() => {
        cleanup();
        reduceMotion = false;
    });

    function renderRotated(deg: number) {
        render(
            <CardTilt3D visualRotationDeg={deg}>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });
        return root;
    }

    it("tilts the card's VISIBLE top edge away when the cursor is pushed toward it", () => {
        // The card's top edge lies on the RIGHT of the slot while tapped, so
        // the cursor goes to slot (184, 140) — card-frame (0, -0.3). Sending
        // that edge away is a POSITIVE rotateY, with no rotateX component: the
        // rotation is about the card's OWN horizontal axis.
        const root = renderRotated(90);
        fireEvent.pointerMove(root, { clientX: 184, clientY: 140 });
        const t = rotations(tiltInner().style.transform);
        expect(t.ry).toBeCloseTo(4.2, 2);
        expect(t.rx).toBe(0);
    });

    it("produces the untapped tilt rigidly rotated with the art (covariance)", () => {
        // Card-frame (0.2, -0.3) — off-axis, so a mere component swap cannot
        // fake it. Untapped that point sits at slot (140, 56) and yields
        // rotateX(4.20) rotateY(2.80); tapped it sits at slot (184, 180) and
        // must yield the same rotation conjugated by 90°: (-2.80, 4.20).
        const root = renderRotated(90);
        fireEvent.pointerMove(root, { clientX: 184, clientY: 180 });
        const t = rotations(tiltInner().style.transform);
        expect(t.rx).toBeCloseTo(-2.8, 2);
        expect(t.ry).toBeCloseTo(4.2, 2);
        // The lift and scale are orientation-agnostic and must not change.
        expect(tiltInner().style.transform).toMatch(/translateZ\(28px\)/);
        expect(tiltInner().style.transform).toMatch(/scale\(1\.07\)/);
    });

    it("puts the glare's bright spot under the cursor in the card's own frame", () => {
        // Same slot point as the covariance case → card-frame (0.2, -0.3) →
        // 70% across, 20% down the CARD. The unrotated-frame code would put it
        // at 92.00% 64.29% instead — mirrored and transposed, exactly the
        // symptom the issue reports.
        const root = renderRotated(90);
        fireEvent.pointerMove(root, { clientX: 184, clientY: 180 });
        expect(glare().style.background).toContain("70.00% 20.00%");
    });

    it("draws the glare box on the ROTATED card face, not the portrait slot box", () => {
        // The glare is `absolute inset-0` inside `[data-card-tilt]` — the same
        // box the rotated visual layer starts from — so carrying the SAME
        // rotation makes the two coincide exactly: same centre, swapped
        // width/height, the card corner landing on the card's own corners.
        renderRotated(90);
        expect(glare().style.transform).toBe("rotate(90deg)");
        expect(glare().className).toContain("inset-0");
        expect(glare().className).toContain("card-corner");
    });

    it("keeps the unrotated caller byte-identical (hand, pile, untapped board)", () => {
        // Explicit parity guard: the default (and an explicit 0) must produce
        // the legacy strings exactly, down to the glare box having no
        // transform at all.
        render(
            <CardTilt3D>
                <div data-testid="face" />
            </CardTilt3D>
        );
        const root = tiltRoot();
        stubRect(root, { left: 0, top: 0, width: 200, height: 280 });
        fireEvent.pointerMove(root, { clientX: 150, clientY: 210 });
        expect(tiltInner().style.transform).toBe(
            "rotateX(-3.50deg) rotateY(3.50deg) translateZ(28px) scale(1.07)"
        );
        expect(glare().style.background).toContain("75.00% 75.00%");
        expect(glare().style.transform).toBe("");
    });

    it("still suppresses tilt AND glare under prefers-reduced-motion while rotated", () => {
        reduceMotion = true;
        const root = renderRotated(90);
        fireEvent.pointerMove(root, { clientX: 184, clientY: 180 });
        expect(tiltInner().style.transform).toBe("");
        expect(glare().style.opacity).toBe("");
        expect(glare().style.background).toBe("");
    });
});
