import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import LibraryOrderPicker from "../library-order-picker";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";

const looked = [
    { instanceId: "a", defId: "def-a" },
    { instanceId: "b", defId: "def-b" },
    { instanceId: "c", defId: "def-c" },
];

// Issue #315 — the picker reads `useMinimizedChoice` (minimize-to-board). The
// board mounts the real provider; these tests only need a no-op so the hook
// resolves. Mirrors the wrapper in player-graveyard / board-piles tests.
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

describe("LibraryOrderPicker", () => {
    it("confirming without dragging preserves the current top order and keeps everything on top", () => {
        // `lookedAt` is top-to-bottom (a = current top). No drag → the submit
        // must reproduce that order (topmost first) with nothing sent away.
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
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
        const { getByText } = renderPicker(
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
        const { getByText } = renderPicker(
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
        const { getByText } = renderPicker(
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
        const { getByText } = renderPicker(
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
        const { getByText } = renderPicker(
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

    // issue #1101 (Reviving Vapors) — `digToHand`'s `destination: "graveyard"`
    // reuses distribute mode but the un-kept pile is the GRAVEYARD, not the
    // library bottom. The chrome must follow `destination` here too (it used
    // to be hardcoded to "BOTTOM" regardless of the prop).
    it("renders HAND/GRAVEYARD chrome in distribute mode with destination graveyard", () => {
        const { getByText, queryByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="graveyard"
                prompt="Reviving Vapors"
                submitting={false}
                distribute={{ keep: 1 }}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("GRAVEYARD")).toBeTruthy();
        expect(getByText("HAND")).toBeTruthy();
        expect(queryByText("BOTTOM")).toBeNull();
    });

    it("distribute mode gates Done until exactly `keep` cards are in the HAND zone", () => {
        // Every card starts in the BOTTOM zone (hand is empty), so with keep = 1
        // the Done button is disabled and clicking it must not submit an illegal
        // (zero-to-hand) selection.
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
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

    it("optional distribute (Narset, min 0) lets Done submit with an empty HAND", () => {
        // Narset's −2 is a "you may": min 0, keep 1. Every card starts in the
        // BOTTOM zone; with the optional floor the player may confirm taking
        // nothing (submits an empty hand list).
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="library-bottom"
                prompt="Narset"
                submitting={false}
                distribute={{ keep: 1, min: 0 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(false);
        fireEvent.click(done);
        // Empty hand → the second (bottom) list holds every looked-at card.
        expect(onConfirm).toHaveBeenCalledWith([], ["a", "b", "c"]);
    });

    // putBack mode (Brainstorm, CR 401.4): HAND (left, pool) / TOP OF LIBRARY
    // (right, exactly `keep` on top). Cards start in the HAND zone.
    it("renders HAND / TOP OF LIBRARY chrome in putBack mode", () => {
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Brainstorm"
                submitting={false}
                putBack={{ keep: 2 }}
                onConfirm={vi.fn()}
            />
        );
        expect(getByText("HAND")).toBeTruthy();
        expect(getByText("TOP OF LIBRARY")).toBeTruthy();
    });

    it("putBack mode gates Done until exactly `keep` cards are on top", () => {
        // Every card starts in the HAND (left) zone; with keep = 2 and nothing
        // placed on top yet, Done is disabled and must not submit.
        const onConfirm = vi.fn();
        const { getByText } = renderPicker(
            <LibraryOrderPicker
                lookedAt={looked}
                destination="none"
                prompt="Brainstorm"
                submitting={false}
                putBack={{ keep: 2 }}
                onConfirm={onConfirm}
            />
        );
        const done = getByText("Done") as HTMLButtonElement;
        expect(done.disabled).toBe(true);
        fireEvent.click(done);
        expect(onConfirm).not.toHaveBeenCalled();
    });
});
