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

// Issue #2056 defect 3 amplification: `onBack`/`legality` let a caller whose
// OWN header/legality bands hide themselves under `short-viewport:` (e.g.
// `PoolDeckBuilderForm`) fold that functionality into this single row
// instead of losing it outright. Both are opt-in (omitted entirely by the
// catalogue `DeckBuilder`, which keeps its own bands at every height) and
// rendered ONLY under `short-viewport:` even when passed.
describe("SaveDeckBar — onBack/legality (issue #2056 defect 3 amplification)", () => {
    it("without onBack/legality, renders neither a Back button nor a legality chip", () => {
        const { queryByText } = render(
            <SaveDeckBar
                name="My Deck"
                onChangeName={vi.fn()}
                onDone={vi.fn()}
                cardCount={40}
            />
        );
        expect(queryByText("← Back")).toBeNull();
        expect(queryByText("Legal")).toBeNull();
    });

    it("with onBack, renders a Back button (short-viewport-only) that fires onBack when clicked", () => {
        const onBack = vi.fn();
        const { getByText } = render(
            <SaveDeckBar
                name="My Deck"
                onChangeName={vi.fn()}
                onDone={vi.fn()}
                cardCount={40}
                onBack={onBack}
                backLabel="← Back to Event"
            />
        );
        const backButton = getByText("← Back to Event");
        const classes = backButton.className.split(/\s+/);
        expect(classes).toContain("hidden");
        expect(classes).toContain("short-viewport:inline-flex");
        fireEvent.click(backButton);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("with legality, renders a DeckLegalityChip wrapped in a short-viewport-only span", () => {
        const { getByText, container } = render(
            <SaveDeckBar
                name="My Deck"
                onChangeName={vi.fn()}
                onDone={vi.fn()}
                cardCount={40}
                legality={{
                    formatLabel: "Limited",
                    isLegal: true,
                    reasons: [],
                }}
            />
        );
        const badge = getByText("Legal");
        const wrapper = badge.parentElement as HTMLElement;
        const wrapperClasses = wrapper.className.split(/\s+/);
        expect(wrapperClasses).toContain("hidden");
        expect(wrapperClasses).toContain("short-viewport:inline-flex");
        // Sanity: it's actually the chip, not the standalone panel — the
        // panel would additionally render a "legality" label + role=status.
        expect(container.querySelector('[role="status"]')).toBeNull();
    });
});
