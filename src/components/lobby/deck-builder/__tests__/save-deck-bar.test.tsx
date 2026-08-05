// Issue #2056 defect 2: short-viewport chrome treatment — `SaveDeckBar`'s
// own vertical padding shrinks under `short-viewport:` (`max-height: 500px`)
// so it stops claiming a fixed slice of an already-scarce landscape-phone
// viewport, one of the bands that pushed the `Done` button below the fold.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import SaveDeckBar from "../save-deck-bar";

afterEach(() => cleanup());

describe("SaveDeckBar", () => {
    it("renders the card count, name field and Done button, and submits onDone", () => {
        const onDone = vi.fn();
        const { getByText, getByPlaceholderText } = render(
            <SaveDeckBar
                name="My Deck"
                onChangeName={vi.fn()}
                onDone={onDone}
                cardCount={40}
            />
        );
        expect(getByText("40 cards")).toBeTruthy();
        expect(getByPlaceholderText("Deck name")).toBeTruthy();
        fireEvent.click(getByText("Done"));
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

describe("SaveDeckBar — short-viewport chrome treatment (issue #2056)", () => {
    it("carries a short-viewport padding override on its root", () => {
        const { container } = render(
            <SaveDeckBar
                name="My Deck"
                onChangeName={vi.fn()}
                onDone={vi.fn()}
                cardCount={40}
            />
        );
        const root = container.firstElementChild as HTMLElement;
        expect(root.className.split(/\s+/)).toContain("short-viewport:py-1");
    });
});
