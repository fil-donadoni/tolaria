// The Escape → pause menu binding both boards share (issue #2353): the GRE
// board's guard, lifted out of `board.tsx` unchanged, plus the per-board
// `extraBlockers` the Manual Board needs for overlays that carry no shared
// `data-slot` marker.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, fireEvent, cleanup } from "@testing-library/react";
import { usePauseMenuHotkey } from "../usePauseMenuHotkey";

function mountOverlay(attr: string, value = ""): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute(attr, value);
    document.body.appendChild(el);
    return el;
}

const pressEscape = () => fireEvent.keyDown(window, { key: "Escape" });

afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
});

describe("usePauseMenuHotkey", () => {
    it("Escape opens the menu; any other key does not", () => {
        const onOpen = vi.fn();
        renderHook(() => usePauseMenuHotkey({ enabled: true, onOpen }));
        fireEvent.keyDown(window, { key: "Enter" });
        expect(onOpen).not.toHaveBeenCalled();
        pressEscape();
        expect(onOpen).toHaveBeenCalledOnce();
    });

    it("does nothing while disabled (the GRE board's game-over guard)", () => {
        const onOpen = vi.fn();
        renderHook(() => usePauseMenuHotkey({ enabled: false, onOpen }));
        pressEscape();
        expect(onOpen).not.toHaveBeenCalled();
    });

    it.each([
        "dialog-content",
        "popover-content",
        "context-menu-content",
        "sheet-content",
    ])("stays out of the way of an open %s overlay on either board", (slot) => {
        const onOpen = vi.fn();
        mountOverlay("data-slot", slot);
        renderHook(() => usePauseMenuHotkey({ enabled: true, onOpen }));
        pressEscape();
        expect(onOpen).not.toHaveBeenCalled();
    });

    it("honours a board's extra blockers, and only that board's", () => {
        const onOpen = vi.fn();
        mountOverlay("data-phase-sheet");
        const { rerender } = renderHook(
            ({ extraBlockers }: { extraBlockers?: string }) =>
                usePauseMenuHotkey({ enabled: true, onOpen, extraBlockers }),
            { initialProps: { extraBlockers: "[data-phase-sheet]" } }
        );
        pressEscape();
        expect(onOpen).not.toHaveBeenCalled();

        // Without the extra blocker (the GRE board's call) the same DOM does
        // not suppress it — the shared list is unchanged.
        rerender({ extraBlockers: undefined });
        pressEscape();
        expect(onOpen).toHaveBeenCalledOnce();
    });
});
