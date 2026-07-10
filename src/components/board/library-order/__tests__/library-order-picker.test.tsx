import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import LibraryOrderPicker from "../library-order-picker";

const looked = [
    { instanceId: "a", defId: "def-a" },
    { instanceId: "b", defId: "def-b" },
    { instanceId: "c", defId: "def-c" },
];

describe("LibraryOrderPicker", () => {
    it("confirming without dragging preserves the current top order and keeps everything on top", () => {
        // `lookedAt` is top-to-bottom (a = current top). No drag → the submit
        // must reproduce that order (topmost first) with nothing sent away.
        const onConfirm = vi.fn();
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Scry"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"], []);
    });

    it("renders scry chrome for library-bottom", () => {
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Scry"
                submitting={false}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("BOTTOM")).toBeTruthy();
        expect(getByText("TOP")).toBeTruthy();
    });

    it("renders surveil chrome for graveyard", () => {
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="graveyard"
                prompt="Surveil"
                submitting={false}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("GRAVEYARD")).toBeTruthy();
        expect(getByText("LIBRARY")).toBeTruthy();
    });

    it("order-only (none) shows a single top label and submits an empty second list", () => {
        const onConfirm = vi.fn();
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Ponder"
                submitting={false}
                onConfirm={onConfirm}
            />
        );
        expect(getByText("TOP OF LIBRARY")).toBeTruthy();
        fireEvent.click(getByText("Done"));
        expect(onConfirm).toHaveBeenCalledWith(["a", "b", "c"], []);
    });

    it("does not fire onConfirm while a submission is in flight", () => {
        const onConfirm = vi.fn();
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Scry"
                submitting={true}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(getByText("Done"));
        expect(onConfirm).not.toHaveBeenCalled();
    });

    // distribute mode (Impulse / Stock Up): HAND (right) / BOTTOM (left).
    it("renders HAND/BOTTOM chrome in distribute mode", () => {
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Impulse"
                submitting={false}
                distribute={{ keep: 1 }}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("BOTTOM")).toBeTruthy();
        expect(getByText("HAND")).toBeTruthy();
    });

    it("distribute mode gates Done until exactly `keep` cards are in the HAND zone", () => {
        // Every card starts in the BOTTOM zone (hand is empty), so with keep = 1
        // the Done button is disabled and clicking it must not submit an illegal
        // (zero-to-hand) selection.
        const onConfirm = vi.fn();
        const { getByText } = render(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Impulse"
                submitting={false}
                distribute={{ keep: 1 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(true);
        fireEvent.click(done);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
