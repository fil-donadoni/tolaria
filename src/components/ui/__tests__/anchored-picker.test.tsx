// The shared anchored-picker primitive (ADR 0103 §5, issue #2731) — extracted
// on the FOURTH near-identical copy: `mode-picker.tsx`'s `ModePickerPortal`,
// `alt-cost-picker.tsx`, `phyrexian-picker.tsx` and `additional-cost-picker.tsx`
// each carried its own portal, its own `useLayoutEffect` viewport clamp and its
// own row markup. This is a NEW primitive, so its clamp/escape/focus behaviour
// gets its own test file rather than riding on a consumer's coverage — per-card
// tests exercise it through mode/alt-cost/etc, but none of them prove the
// primitive's OWN contracts in isolation (ESC, scrim click, the clamp math, the
// 44px row floor).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AnchoredPicker, {
    AnchoredPickerRow,
    clampToViewport,
} from "../anchored-picker";

afterEach(cleanup);

describe("clampToViewport (pure positioning math)", () => {
    it("leaves an anchor untouched when the popup fits", () => {
        expect(clampToViewport({ x: 100, y: 100 }, 50, 50)).toEqual({
            x: 100,
            y: 100,
        });
    });

    it("pushes the anchor back inside the right/bottom edge", () => {
        // window is 1024x768 in the jsdom/happy-dom test environment.
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const result = clampToViewport({ x: vw, y: vh }, 200, 100, 8);
        expect(result.x).toBe(vw - 200 - 8);
        expect(result.y).toBe(vh - 100 - 8);
    });

    it("never pushes the anchor past the top/left margin", () => {
        const result = clampToViewport({ x: -500, y: -500 }, 50, 50, 8);
        expect(result).toEqual({ x: 8, y: 8 });
    });
});

describe("AnchoredPicker", () => {
    function renderPicker(onCancel = vi.fn()) {
        return render(
            <AnchoredPicker
                position={{ x: 20, y: 30 }}
                rowCount={2}
                onCancel={onCancel}
                title="Test Card"
            >
                <AnchoredPickerRow onSelect={() => {}}>
                    Row one
                </AnchoredPickerRow>
                <AnchoredPickerRow onSelect={() => {}}>
                    Row two
                </AnchoredPickerRow>
            </AnchoredPicker>
        );
    }

    it("renders every row passed as children", () => {
        renderPicker();
        expect(screen.getByText("Row one")).toBeTruthy();
        expect(screen.getByText("Row two")).toBeTruthy();
    });

    it("renders the title header", () => {
        renderPicker();
        expect(screen.getByText("Test Card")).toBeTruthy();
    });

    it("tags the popup with data-slot=dialog-content, for the board's global ESC handler", () => {
        renderPicker();
        expect(
            document.querySelector('[data-slot="dialog-content"]')
        ).not.toBeNull();
    });

    it("calls onCancel when Escape is pressed", () => {
        const onCancel = vi.fn();
        renderPicker(onCancel);
        fireEvent.keyDown(window, { key: "Escape" });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("calls onCancel when the scrim is clicked", () => {
        const onCancel = vi.fn();
        const { baseElement } = renderPicker(onCancel);
        const scrim = baseElement.querySelector(".modal-scrim")!;
        fireEvent.mouseDown(scrim);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("invokes a row's onSelect on click", () => {
        const onSelect = vi.fn();
        render(
            <AnchoredPicker
                position={{ x: 0, y: 0 }}
                rowCount={1}
                onCancel={vi.fn()}
            >
                <AnchoredPickerRow onSelect={onSelect}>
                    Only row
                </AnchoredPickerRow>
            </AnchoredPicker>
        );
        fireEvent.click(screen.getByText("Only row"));
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("renders nothing (no header block) when neither title nor subtitle is given", () => {
        const { baseElement } = render(
            <AnchoredPicker
                position={{ x: 0, y: 0 }}
                rowCount={1}
                onCancel={vi.fn()}
            >
                <AnchoredPickerRow onSelect={() => {}}>
                    Only row
                </AnchoredPickerRow>
            </AnchoredPicker>
        );
        // The header hairline rule only renders alongside a title/subtitle.
        expect(baseElement.querySelector(".bg-gradient-to-r")).toBeNull();
    });
});

describe("AnchoredPickerRow", () => {
    it("carries the shared 44px menu-row floor (ADR 0103 §5)", () => {
        render(<AnchoredPickerRow onSelect={() => {}}>Row</AnchoredPickerRow>);
        const button = screen.getByText("Row").closest("button")!;
        expect(button.className).toContain("min-h-[var(--menu-row-h)]");
    });

    it("passes through data-testid for callers that need one", () => {
        render(
            <AnchoredPickerRow onSelect={() => {}} data-testid="my-row">
                Row
            </AnchoredPickerRow>
        );
        expect(screen.getByTestId("my-row")).toBeTruthy();
    });
});
