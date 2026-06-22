// Deckbuilder Maindeck/Sideboard section: per-section count, soft-limit
// warning, empty message, remove-on-click, and the grouped (Maindeck mana-value
// piles) vs single-pile (Sideboard) rendering. Move between zones is now drag &
// drop (not a button) — see `../deck-pile-area`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DeckCard } from "~/types/game";
import DeckPileArea from "../deck-pile-area";
import type { DropZoneId } from "../dnd-types";

// Real registry ids — `groupDeckIntoPiles` resolves each card via the card
// registry, so synthetic ids would throw.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

// useDroppable/useDraggable require a DragDropProvider in context.
function renderArea(ui: React.ReactElement) {
    return render(<DragDropProvider>{ui}</DragDropProvider>);
}

function area(props: Partial<React.ComponentProps<typeof DeckPileArea>> = {}) {
    const base = {
        title: "Maindeck",
        zone: "main" as DropZoneId,
        grouped: true,
        cards: [] as DeckCard[],
        onRemove: () => {},
        emptyMessage: "empty",
    };
    return <DeckPileArea {...base} {...props} />;
}

describe("DeckPileArea", () => {
    it("renders the section title with its live count", () => {
        const { getByText } = renderArea(
            area({ cards: [card(BOLT_ID), card(PLAINS_ID)] })
        );
        expect(getByText(/Maindeck 2/)).toBeTruthy();
    });

    it("renders the Sideboard count with the /15 suffix", () => {
        const { getByText } = renderArea(
            area({
                title: "Sideboard",
                zone: "side",
                grouped: false,
                cards: [card(BOLT_ID)],
                countSuffix: "/15",
            })
        );
        expect(getByText(/Sideboard 1\/15/)).toBeTruthy();
    });

    it("shows the soft-limit warning only when provided", () => {
        const { queryByText, rerender } = renderArea(
            area({
                title: "Sideboard",
                zone: "side",
                grouped: false,
                cards: [card(BOLT_ID)],
                countSuffix: "/15",
                warning: null,
            })
        );
        expect(queryByText("over limit")).toBeNull();

        rerender(
            <DragDropProvider>
                {area({
                    title: "Sideboard",
                    zone: "side",
                    grouped: false,
                    cards: [card(BOLT_ID)],
                    countSuffix: "/15",
                    warning: "over limit",
                })}
            </DragDropProvider>
        );
        expect(queryByText("over limit")).toBeTruthy();
    });

    it("renders the empty message when the section has no cards", () => {
        const { getByText } = renderArea(
            area({ emptyMessage: "Move cards here", cards: [] })
        );
        expect(getByText("Move cards here")).toBeTruthy();
    });

    it("fires onRemove with the card id when the card art is clicked", () => {
        const onRemove = vi.fn();
        const { getByTitle } = renderArea(
            area({ cards: [card(BOLT_ID, "Lightning Bolt")], onRemove })
        );
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onRemove).toHaveBeenCalledWith(BOLT_ID);
    });

    it("groups the Maindeck into mana-value piles (lands first)", () => {
        const { getByText } = renderArea(
            area({ grouped: true, cards: [card(BOLT_ID), card(PLAINS_ID)] })
        );
        // Lands pile + MV 1 pile labels appear only in grouped mode.
        expect(getByText("Lands")).toBeTruthy();
        expect(getByText("MV 1")).toBeTruthy();
    });

    it("renders the Sideboard as a single ungrouped pile (no MV labels)", () => {
        const { queryByText } = renderArea(
            area({
                title: "Sideboard",
                zone: "side",
                grouped: false,
                cards: [card(BOLT_ID), card(PLAINS_ID)],
            })
        );
        expect(queryByText("Lands")).toBeNull();
        expect(queryByText("MV 1")).toBeNull();
    });
});
