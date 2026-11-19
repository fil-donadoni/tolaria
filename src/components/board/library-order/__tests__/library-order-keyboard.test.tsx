// Issue #9995 — the surveil / scry / order picker is operable without a
// pointer: every card is a focusable button named after it, click / Enter /
// Space toggles it between the two zones, ArrowLeft/Right reorder in a zone.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import LibraryOrderPicker from "../library-order-picker";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";

const looked = [
    { instanceId: "a", defId: "def-a" },
    { instanceId: "b", defId: "def-b" },
    { instanceId: "c", defId: "def-c" },
];

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};
const renderPicker = (ui: ReactElement) =>
    render(
        <MinimizedChoiceContext value={noopMinimized}>
            {ui}
        </MinimizedChoiceContext>
    );

const surveil = (onConfirm = vi.fn()) => {
    renderPicker(
        <LibraryOrderPicker
            lookedAt={looked}
            destination="graveyard"
            prompt="Surveil"
            submitting={false}
            onConfirm={onConfirm}
        />
    );
    return onConfirm;
};

const cards = () => screen.getAllByRole("button", { name: /^Card — / });

describe("LibraryOrderPicker keyboard / click path (issue #9995)", () => {
    it("exposes every card as a focusable button naming its zone", () => {
        surveil();
        const btns = cards();
        expect(btns).toHaveLength(3);
        for (const b of btns) {
            expect(b.getAttribute("tabindex")).toBe("0");
            expect(b.getAttribute("aria-label")).toContain("Top of library");
        }
    });

    it("click sends a card to the graveyard and back", () => {
        const onConfirm = surveil();
        fireEvent.click(cards()[0]); // a → graveyard
        expect(cards()[0].getAttribute("aria-label")).toContain("Graveyard");
        fireEvent.click(screen.getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["b", "c"], ["a"]);
    });

    it("Enter and Space toggle the focused card", () => {
        const onConfirm = surveil();
        fireEvent.keyDown(cards()[1], { key: "Enter" }); // b → graveyard
        fireEvent.keyDown(cards()[2], { key: " " }); // c → graveyard
        fireEvent.click(screen.getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["a"], ["b", "c"]);
    });

    it("arrow keys reorder the top pile (rightmost = topmost)", () => {
        const onConfirm = surveil();
        // Initial left→right: c b a (a topmost). Move `a` one slot left.
        fireEvent.keyDown(cards()[0], { key: "ArrowLeft" });
        fireEvent.click(screen.getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["b", "a", "c"], []);
    });

    it("does nothing while submitting", () => {
        const onConfirm = vi.fn();
        renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="graveyard"
                prompt="Surveil"
                submitting
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(cards()[0]);
        expect(cards()[0].getAttribute("aria-label")).toContain(
            "Top of library"
        );
    });

    it("keys the picker handles never reach window hotkeys (Space = confirm)", () => {
        surveil();
        const spy = vi.fn();
        window.addEventListener("keydown", spy);
        try {
            fireEvent.keyDown(cards()[0], { key: " ", code: "Space" });
            fireEvent.keyDown(cards()[0], { key: "ArrowLeft" });
            expect(spy).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener("keydown", spy);
        }
    });
});
