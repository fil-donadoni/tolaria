// Compact legality readout (issue #2056 defect 3 amplification): the
// short-viewport substitute for `DeckLegalityPanel`'s always-reserved ~48px
// band. A legal deck costs one static badge; an illegal deck's reasons only
// cost height while the disclosure is open (a Popover), never while closed —
// that's what makes the chip's closed-state height ~0 versus the panel's
// fixed band.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import DeckLegalityChip from "../deck-legality-chip";

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const REASONS = [
    { code: "too-few-cards" as const, message: "Deck has fewer than 40 cards" },
    { code: "banned-card" as const, message: "Contains a banned card" },
];

describe("DeckLegalityChip", () => {
    it("renders a static Legal badge for a legal deck (no disclosure)", () => {
        const { getByText, queryByRole } = render(
            <DeckLegalityChip
                formatLabel="Limited"
                isLegal={true}
                reasons={[]}
            />
        );
        expect(getByText("Legal")).toBeTruthy();
        expect(queryByRole("button")).toBeNull();
    });

    it("renders an Illegal trigger with the reason count for an illegal deck", () => {
        const { getByText } = render(
            <DeckLegalityChip
                formatLabel="Limited"
                isLegal={false}
                reasons={REASONS}
            />
        );
        expect(getByText("Illegal (2)")).toBeTruthy();
    });

    it("reveals the reasons list only once the disclosure is opened", () => {
        const { getByText, queryByText } = render(
            <DeckLegalityChip
                formatLabel="Limited"
                isLegal={false}
                reasons={REASONS}
            />
        );
        expect(queryByText("Deck has fewer than 40 cards")).toBeNull();
        fireEvent.click(getByText("Illegal (2)"));
        expect(getByText("Deck has fewer than 40 cards")).toBeTruthy();
        expect(getByText("Contains a banned card")).toBeTruthy();
    });
});
