// Deckbuilder Maindeck/Sideboard section: per-section count, soft-limit
// warning, and the Maindeck↔Sideboard move action (issue #391).
// See `../deck-pile-area`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import type { DeckCard } from "~/types/game";
import DeckPileArea from "../deck-pile-area";

// Real registry ids — `groupDeckIntoPiles` resolves each card via the card
// registry, so synthetic ids would throw.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

describe("DeckPileArea (issue #391)", () => {
    it("renders the section title with its live count", () => {
        const { getByText } = render(
            <DeckPileArea
                title="Maindeck"
                cards={[card(BOLT_ID), card(PLAINS_ID)]}
                onRemove={() => {}}
                emptyMessage="empty"
            />
        );
        expect(getByText(/Maindeck 2/)).toBeTruthy();
    });

    it("renders the Sideboard count with the /15 suffix", () => {
        const { getByText } = render(
            <DeckPileArea
                title="Sideboard"
                cards={[card(BOLT_ID)]}
                onRemove={() => {}}
                countSuffix="/15"
                emptyMessage="empty"
            />
        );
        expect(getByText(/Sideboard 1\/15/)).toBeTruthy();
    });

    it("shows the soft-limit warning only when provided", () => {
        const { queryByText, rerender } = render(
            <DeckPileArea
                title="Sideboard"
                cards={[card(BOLT_ID)]}
                onRemove={() => {}}
                countSuffix="/15"
                warning={null}
                emptyMessage="empty"
            />
        );
        expect(queryByText("over limit")).toBeNull();

        rerender(
            <DeckPileArea
                title="Sideboard"
                cards={[card(BOLT_ID)]}
                onRemove={() => {}}
                countSuffix="/15"
                warning="over limit"
                emptyMessage="empty"
            />
        );
        expect(queryByText("over limit")).toBeTruthy();
    });

    it("renders the empty message when the section has no cards", () => {
        const { getByText } = render(
            <DeckPileArea
                title="Sideboard"
                cards={[]}
                onRemove={() => {}}
                emptyMessage="Move cards here"
            />
        );
        expect(getByText("Move cards here")).toBeTruthy();
    });

    it("fires onMove with the card id when the move action is clicked", () => {
        const onMove = vi.fn();
        const { getByTitle } = render(
            <DeckPileArea
                title="Maindeck"
                cards={[card(BOLT_ID, "Lightning Bolt")]}
                onRemove={() => {}}
                moveLabel="→ Side"
                onMove={onMove}
                emptyMessage="empty"
            />
        );
        fireEvent.click(getByTitle("Move Lightning Bolt → Side"));
        expect(onMove).toHaveBeenCalledWith(BOLT_ID);
    });

    it("fires onRemove with the card id when the card art is clicked", () => {
        const onRemove = vi.fn();
        const { getByTitle } = render(
            <DeckPileArea
                title="Maindeck"
                cards={[card(BOLT_ID, "Lightning Bolt")]}
                onRemove={onRemove}
                emptyMessage="empty"
            />
        );
        fireEvent.click(getByTitle("Remove Lightning Bolt"));
        expect(onRemove).toHaveBeenCalledWith(BOLT_ID);
    });

    it("omits the move button when no moveLabel/onMove is given", () => {
        const { container } = render(
            <DeckPileArea
                title="Maindeck"
                cards={[card(BOLT_ID, "Lightning Bolt")]}
                onRemove={() => {}}
                emptyMessage="empty"
            />
        );
        const scope = within(container);
        expect(scope.queryByText("→ Side")).toBeNull();
    });
});
