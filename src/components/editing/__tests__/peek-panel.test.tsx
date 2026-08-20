// The Peek Panel (PRD #2405 D16, issue #2583) — the primary move path on
// touch. Render-level contract tests against the `data-peek-panel` /
// `data-editing-action` markers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup, fireEvent } from "@testing-library/react";
import PeekPanel from "../peek-panel";
import { PEEK_PANEL_RAIL_WIDTH } from "../usePeekPanelLayout";
import type { EditingSurfaceAction } from "../editing-surface-action";

/** `useViewportMode` reads two media queries. Stub them so a test picks the
 *  regime instead of inheriting happy-dom's default. */
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

const panel = () => document.querySelector("[data-peek-panel]");
const actionEls = () =>
    [...document.querySelectorAll("[data-editing-action]")] as HTMLElement[];

function actions(onPick = vi.fn(), onSide = vi.fn()): EditingSurfaceAction[] {
    return [
        { label: "Pick", primary: true, onSelect: onPick },
        { label: "→ Side", onSelect: onSide },
        { label: "Inspect", onSelect: () => {} },
    ];
}

function renderPanel(
    props: Partial<React.ComponentProps<typeof PeekPanel>> = {}
) {
    return render(
        <PeekPanel
            cardId="bolt"
            name="Lightning Bolt"
            subtitle="Instant"
            actions={actions()}
            onClose={() => {}}
            {...props}
        />
    );
}

describe("PeekPanel (issue #2583)", () => {
    beforeEach(() => stubViewport("portrait"));
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("renders the surface's CTA row in order, with the primary marked", () => {
        renderPanel();
        expect(actionEls().map((el) => el.dataset.editingAction)).toEqual([
            "Pick",
            "→ Side",
            "Inspect",
        ]);
        expect(actionEls()[0].dataset.primary).toBe("true");
        expect(actionEls()[1].dataset.primary).toBeUndefined();
    });

    it("fires the surface's callback for the tapped CTA", () => {
        const onPick = vi.fn();
        const onSide = vi.fn();
        render(
            <PeekPanel
                cardId="bolt"
                name="Lightning Bolt"
                actions={actions(onPick, onSide)}
                onClose={() => {}}
            />
        );
        fireEvent.click(actionEls()[1]);
        expect(onSide).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });

    it("every CTA is sized from --control-h, the pointer-aware token", () => {
        renderPanel();
        for (const el of actionEls()) {
            expect(el.style.minHeight).toBe("var(--control-h)");
        }
    });

    // The other half of the ≥44px acceptance criterion. The button above
    // commits to the token; this asserts the token is 44px under
    // `pointer: coarse` — the two together are what make the CTA a real touch
    // target, and neither alone proves it.
    it("--control-h resolves to 44px on a coarse pointer", () => {
        const css = readFileSync(
            resolve(process.cwd(), "src/index.css"),
            "utf8"
        );
        expect(css).toMatch(/--control-h-coarse:\s*44px/);
        const coarseBlock = css.slice(css.indexOf("@media (pointer: coarse)"));
        expect(coarseBlock).toMatch(/--control-h:\s*var\(--control-h-coarse\)/);
    });

    it("closes through the × without touching the surface's CTAs", () => {
        const onClose = vi.fn();
        const onPick = vi.fn();
        render(
            <PeekPanel
                cardId="bolt"
                name="Lightning Bolt"
                actions={actions(onPick)}
                onClose={onClose}
            />
        );
        fireEvent.click(
            document.querySelector('[aria-label="Close Lightning Bolt panel"]')!
        );
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });

    // Non-modal by construction: tapping the NEXT card must retarget the open
    // panel, not need a dismiss first. A scrim or focus trap here would make
    // that a two-tap gesture, which is why this is not built on ActionSheet.
    it("retargets in place when the surface selects another card", () => {
        const { rerender } = renderPanel();
        expect(panel()!.getAttribute("aria-label")).toBe(
            "Selected card: Lightning Bolt"
        );
        rerender(
            <PeekPanel
                cardId="counterspell"
                name="Counterspell"
                subtitle="Instant"
                actions={actions()}
                onClose={() => {}}
            />
        );
        expect(document.querySelectorAll("[data-peek-panel]")).toHaveLength(1);
        expect(panel()!.getAttribute("aria-label")).toBe(
            "Selected card: Counterspell"
        );
        // No scrim: the surface underneath stays tappable while it is open.
        expect(document.querySelector(".modal-scrim")).toBeNull();
    });

    it("is a bottom sheet in portrait and a right rail in landscape", () => {
        const { unmount } = renderPanel();
        expect(panel()!.getAttribute("data-peek-panel")).toBe("sheet");
        unmount();

        stubViewport("landscape");
        renderPanel();
        expect(panel()!.getAttribute("data-peek-panel")).toBe("rail");
        // The width comes from the SHARED constant, which is also what the
        // adopting surface reserves — two copies of the number is how the
        // panel and the reserve drift apart (issue #2583 review).
        expect((panel() as HTMLElement).style.width).toBe(
            PEEK_PANEL_RAIL_WIDTH
        );
    });

    it("lets the surface override the viewport-derived layout", () => {
        renderPanel({ layout: "rail" });
        expect(panel()!.getAttribute("data-peek-panel")).toBe("rail");
    });

    it("disables a CTA the surface reports unavailable", () => {
        const onPick = vi.fn();
        render(
            <PeekPanel
                cardId="bolt"
                name="Lightning Bolt"
                actions={[
                    {
                        label: "Pick",
                        primary: true,
                        disabled: true,
                        onSelect: onPick,
                    },
                ]}
                onClose={() => {}}
            />
        );
        const [pick] = actionEls();
        expect((pick as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(pick);
        expect(onPick).not.toHaveBeenCalled();
    });
});
