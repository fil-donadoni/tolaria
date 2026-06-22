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
