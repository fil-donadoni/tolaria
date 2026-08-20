// The Inspect Overlay (PRD #2405, issue #2583) — the editing surfaces' full
// card read, and the replacement for the hold-preview they lost.
//
// The height contract is the reason this component exists separately from the
// board's `CardPreview` overlay (ADR 0009, untouched): at 844×390 a `90vh`
// panel overflows, because on mobile Safari/Chrome `vh` is the LARGE viewport
// — the height the page has only once the URL bar has scrolled away. Only
// happy-dom can be asked whether the declaration is right; whether it RENDERS
// within 100dvh is the five-viewport probe's job, not this file's.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import InspectOverlay from "../inspect-overlay";
import type { EditingSurfaceAction } from "../editing-surface-action";

function stubViewport(mode: "portrait" | "landscape") {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches:
            mode === "portrait"
                ? query.includes("orientation: portrait")
                : query.includes("max-height: 500px"),
        addEventListener() {},
        removeEventListener() {},
    }));
}

const scrim = () => document.querySelector("[data-inspect-overlay]")!;
const panel = () =>
    document.querySelector("[data-inspect-panel]") as HTMLElement;
const content = () =>
    document.querySelector("[data-inspect-content]") as HTMLElement;
const actionEls = () =>
    [...document.querySelectorAll("[data-editing-action]")] as HTMLElement[];

function renderOverlay(
    props: Partial<React.ComponentProps<typeof InspectOverlay>> = {}
) {
    return render(
        <InspectOverlay cardId="bolt" onClose={() => {}} {...props} />
    );
}

describe("InspectOverlay (issue #2583)", () => {
    beforeEach(() => stubViewport("portrait"));
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("caps its panel at 100dvh MINUS the scrim's padding — never vh, never a fraction of it", () => {
        renderOverlay();
        // Not a flat `100dvh`: the scrim is `p-3`, so a panel capped at the
        // full viewport is taller than the box it centres in and hangs 12px
        // past each edge (issue #2583 review). happy-dom cannot measure that,
        // which is why the cap has to be right by construction.
        expect(panel().style.maxHeight).toBe("calc(100dvh - 1.5rem)");
        expect(panel().parentElement!.className).toContain("p-3");
        // A `vh` cap anywhere on the panel would reintroduce the landscape
        // overflow this component exists to remove.
        expect(panel().style.maxHeight).not.toMatch(/\d+vh[^a-z]/);
        expect(panel().className).not.toMatch(/max-h-\[\d+vh\]/);
    });

    it("stacks art over text in portrait and splits art | text in landscape", () => {
        const { unmount } = renderOverlay();
        expect(content().dataset.inspectContent).toBe("stacked");
        expect(content().className).toContain("flex-col");
        unmount();

        stubViewport("landscape");
        renderOverlay();
        expect(content().dataset.inspectContent).toBe("split");
        expect(content().className).toContain("flex-row");
    });

    it("lets the surface override the viewport-derived split", () => {
        renderOverlay({ layout: "split" });
        expect(content().dataset.inspectContent).toBe("split");
    });

    it("renders the surface's actions inside the overlay, so read → act is one flow", () => {
        const onPick = vi.fn();
        const acts: EditingSurfaceAction[] = [
            { label: "Pick", primary: true, onSelect: onPick },
            { label: "→ Side", onSelect: () => {} },
        ];
        renderOverlay({ actions: acts });
        expect(actionEls().map((el) => el.dataset.editingAction)).toEqual([
            "Pick",
            "→ Side",
        ]);
        fireEvent.click(actionEls()[0]);
        expect(onPick).toHaveBeenCalledTimes(1);
    });

    it("by default a tap inside the panel does NOT close it (deckbuilder read)", () => {
        const onClose = vi.fn();
        renderOverlay({ onClose });
        fireEvent.click(panel());
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(scrim());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // PRD #2405 D15 — the Draft Room wants read → back to picking in one tap.
    it("tapAnywhereCloses closes on a tap inside the panel, but the primary CTA still fires", () => {
        const onClose = vi.fn();
        const onPick = vi.fn();
        const onSide = vi.fn();
        renderOverlay({
            onClose,
            tapAnywhereCloses: true,
            actions: [
                { label: "Pick", primary: true, onSelect: onPick },
                { label: "→ Side", onSelect: onSide },
            ],
        });

        fireEvent.click(panel());
        expect(onClose).toHaveBeenCalledTimes(1);
        onClose.mockClear();

        // The primary action must PICK, not be swallowed by the dismiss.
        fireEvent.click(actionEls()[0]);
        expect(onPick).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();

        // A non-primary CTA is not exempt: it acts AND the overlay closes.
        fireEvent.click(actionEls()[1]);
        expect(onSide).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("steps with ‹ ›, disabling the arrow the surface has no card for", () => {
        const previous = vi.fn();
        renderOverlay({ onStep: { previous } });
        const prev = document.querySelector(
            '[aria-label="Previous card"]'
        ) as HTMLButtonElement;
        const next = document.querySelector(
            '[aria-label="Next card"]'
        ) as HTMLButtonElement;

        expect(prev.disabled).toBe(false);
        expect(next.disabled).toBe(true);
        fireEvent.click(prev);
        expect(previous).toHaveBeenCalledTimes(1);
    });

    it("offers no stepping arrows when the surface supplies no onStep", () => {
        renderOverlay();
        expect(
            document.querySelector('[aria-label="Previous card"]')
        ).toBeNull();
        expect(document.querySelector('[aria-label="Next card"]')).toBeNull();
    });

    it("closes through the × even in the non-dismissing default mode", () => {
        const onClose = vi.fn();
        renderOverlay({ onClose });
        fireEvent.click(
            document.querySelector('[aria-label="Close inspect overlay"]')!
        );
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

// This overlay shipped as `role="dialog" aria-modal="true"` with no Escape
// handler at all (#2583): a keyboard user who opened it had no way out that
// did not involve tabbing blind, and `aria-modal` tells assistive tech the
// rest of the page is inert, so "tab back to the surface" is wrong as well as
// unpleasant. Issue #2593.
describe("InspectOverlay keyboard dismissal (issue #2593)", () => {
    beforeEach(() => stubViewport("portrait"));
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("Escape closes it", () => {
        const onClose = vi.fn();
        renderOverlay({ onClose });
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("Escape does nothing once the overlay has unmounted", () => {
        const onClose = vi.fn();
        const { unmount } = renderOverlay({ onClose });
        unmount();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("ignores a modifier chord and other keys", () => {
        const onClose = vi.fn();
        renderOverlay({ onClose });
        fireEvent.keyDown(window, { key: "Escape", metaKey: true });
        fireEvent.keyDown(window, { key: "Enter" });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("takes focus into the panel on open", () => {
        renderOverlay();
        expect(document.activeElement).toBe(panel());
        expect(panel().getAttribute("tabindex")).toBe("-1");
    });
});
