// ESC-to-dismiss UX (board-wide rule): pressing Escape with an overlay open
// closes that overlay instead of opening the pause menu. ModePicker's portal
// variant is the one custom (non-base-ui) overlay, so it needs its own ESC
// handler AND a `data-slot="dialog-content"` tag the board's global ESC handler
// detects to skip the pause menu. These tests pin both.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ModePicker from "../mode-picker";
import type { SpellMode } from "@convex/cards/types";

const modes: SpellMode[] = [
    { id: "a", label: "Mode A", oracleText: "do A" },
    { id: "b", label: "Mode B", oracleText: "do B" },
];

afterEach(cleanup);

describe("ModePicker portal — ESC dismiss (UX)", () => {
    it("calls onCancel when Escape is pressed", () => {
        const onCancel = vi.fn();
        render(
            <ModePicker
                modes={modes}
                cardName="Test"
                variant="portal"
                position={{ x: 10, y: 10 }}
                onSelect={vi.fn()}
                onCancel={onCancel}
            />
        );

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("renders a popup the board's ESC handler can detect (skips pause menu)", () => {
        render(
            <ModePicker
                modes={modes}
                cardName="Test"
                variant="portal"
                position={{ x: 10, y: 10 }}
                onSelect={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        // Same selector the board uses to bail out of opening the pause menu.
        expect(
            document.querySelector('[data-slot="dialog-content"]')
        ).not.toBeNull();
        expect(screen.getByText("Mode A")).toBeTruthy();
    });
});
