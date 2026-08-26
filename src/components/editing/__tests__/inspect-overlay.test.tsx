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
import { getCardByName } from "@convex/cards";
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

    // Issue #2668 — the header row's OWN controls (Oracle/Printed, ‹ ›, ×)
    // are exempt from tap-anywhere dismissal AS A CLASS, not a per-control
    // list: the face toggle used to be missing from that list, so a tap on
    // "Printed" flipped the mode and dismissed the overlay in the same tap,
    // making the printed face unreachable in the Draft Room. Drives the
    // REAL overlay end to end, not a hand-built view.
    it("tapAnywhereCloses: the Oracle/Printed toggle switches faces without closing; a background tap still closes in one", () => {
        const onClose = vi.fn();
        renderOverlay({ onClose, tapAnywhereCloses: true });

        const printedButton = document.querySelector(
            '[data-preview-mode="printed"]'
        ) as HTMLElement;
        const oracleButton = document.querySelector(
            '[data-preview-mode="computed"]'
        ) as HTMLElement;
        expect(printedButton).not.toBeNull();

        // The printed face renders its own `<img alt="… (printed)">` branch
        // (distinct from `CardPreviewFace`'s art `<img>`, which is present in
        // BOTH modes) — that is the real signal the mode actually switched.
        const printedFaceImg = () =>
            content().querySelector('img[alt$="(printed)"]');

        // Tap "Printed" — the overlay MUST still be mounted, and the printed
        // face must be showing.
        fireEvent.click(printedButton);
        expect(document.querySelector("[data-inspect-overlay]")).not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(printedFaceImg()).not.toBeNull();

        // Tap "Oracle" — still open, face switches back.
        fireEvent.click(oracleButton);
        expect(document.querySelector("[data-inspect-overlay]")).not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(printedFaceImg()).toBeNull();

        // With the printed face showing, a tap on the art still closes the
        // overlay in ONE tap.
        fireEvent.click(printedButton);
        onClose.mockClear();
        fireEvent.click(printedFaceImg()!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Same class of control, from the other two members of the row: the
    // step arrows and the close button must keep behaving exactly as they
    // did before the centralized exemption replaced their own
    // `stopPropagation()` calls (issue #2668).
    it("tapAnywhereCloses: the step arrows and the × still act without closing / still close", () => {
        const onClose = vi.fn();
        const previous = vi.fn();
        renderOverlay({
            onClose,
            tapAnywhereCloses: true,
            onStep: { previous },
        });

        fireEvent.click(
            document.querySelector('[aria-label="Previous card"]')!
        );
        expect(previous).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.click(
            document.querySelector('[aria-label="Close inspect overlay"]')!
        );
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Issue #2668 review — the class-based exemption must actually be a
    // CLASS: a button-only selector reproduces the issue's own bug one level
    // up (a non-<button> control silently fails to join the exemption, the
    // exact shape #2668 was filed to remove). Nothing this component renders
    // today is a <select>, so this inserts a real one directly into the real
    // header row and fires a real click through the panel's actual dismiss
    // handler — proving the mechanism is generic, not proving a component
    // that does not exist.
    it("tapAnywhereCloses: the header row's exemption covers every interactive control kind, not just <button>", () => {
        const onClose = vi.fn();
        renderOverlay({ onClose, tapAnywhereCloses: true });

        const controlRow = document.querySelector("[data-inspect-controls]")!;
        const select = document.createElement("select");
        controlRow.appendChild(select);

        fireEvent.click(select);
        expect(onClose).not.toHaveBeenCalled();
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

// ADR 0103 §9 / issue #2728 — the Engine View slot renders the DSL/protocol
// badge read off the real `CardDefinition`, in EVERY orientation, without
// disturbing this component's own real guard: the 100dvh cap (test above)
// is a STATIC style declaration, and the slot lands inside the content
// region's own `overflow-y-auto` (stacked) / split text column (landscape,
// already `flex-1 min-h-0 overflow-y-auto`) — so more content there scrolls
// instead of growing the panel.
describe("InspectOverlay — Engine View slot (issue #2728)", () => {
    const LIGHTNING_BOLT_ID = getCardByName("Lightning Bolt").id;

    beforeEach(() => stubViewport("portrait"));
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it("renders the full slot (eyebrow + DSL badge + empty tree well) for a resolvable card", () => {
        renderOverlay({ cardId: LIGHTNING_BOLT_ID });
        expect(content().textContent).toContain("Engine view");
        expect(content().textContent).toContain("DSL");
        expect(
            content().querySelector("[data-engine-view-slot]")
        ).not.toBeNull();
        expect(
            content().querySelector("[data-engine-view-tree]")
        ).not.toBeNull();
    });

    it("renders nothing for an identity with no CardDefinition (the default fixture id, 'bolt')", () => {
        renderOverlay();
        expect(content().textContent).not.toContain("Engine view");
        expect(content().querySelector("[data-engine-view-slot]")).toBeNull();
    });

    it("does not perturb the 100dvh cap — the panel's cap is a fixed declaration, unaffected by whether the badge renders", () => {
        renderOverlay({ cardId: LIGHTNING_BOLT_ID });
        expect(panel().style.maxHeight).toBe("calc(100dvh - 1.5rem)");
    });

    it("in landscape (split), the badge lands in the SAME scrolling text column as the oracle text — the split layout is unchanged", () => {
        stubViewport("landscape");
        renderOverlay({ cardId: LIGHTNING_BOLT_ID });
        expect(content().dataset.inspectContent).toBe("split");
        const slot = content().querySelector(
            "[data-engine-view-slot]"
        ) as HTMLElement;
        expect(slot).not.toBeNull();
        // The split text column is `flex-1 min-h-0 overflow-y-auto`
        // (`card-preview-face.tsx`) — the slot is a descendant of it, not a
        // sibling that could grow the panel independently.
        expect(slot.closest(".overflow-y-auto")).not.toBeNull();
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
