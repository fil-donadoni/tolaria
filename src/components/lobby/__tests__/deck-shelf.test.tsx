// Deck Shelves (ADR 0103 §6, issue #2726): one horizontally-scrolling row of
// art tiles per collection, with a selected ring. What matters here is the
// action budget — the v3 row gave every deck a Select, an Edit and a "⋯";
// a shelf tile gives it ONE gesture plus the overflow, and withholds the
// overflow items the viewer may not perform.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import DeckShelf from "../deck-shelf";

function makeDeck(overrides: Partial<LobbyDeck> = {}): LobbyDeck {
    return {
        kind: "preset",
        presetId: "mono-red-burn",
        name: "Mono Red Burn",
        format: "old-school",
        colors: ["R"],
        cards: [{ id: "card-a", quantity: 4 }],
        sideboard: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

function renderShelf(
    overrides: Partial<React.ComponentProps<typeof DeckShelf>> = {}
) {
    const props: React.ComponentProps<typeof DeckShelf> = {
        title: "Your decks",
        decks: [makeDeck()],
        selectedPresetId: null,
        onSelect: vi.fn(),
        onOpen: vi.fn(),
        emptyLabel: "No saved decks yet.",
        ...overrides,
    };
    return { ...render(<DeckShelf {...props} />), props };
}

describe("DeckShelf (issue #2726)", () => {
    it("selects on the tile's own click — the gesture that swaps the Loadout", () => {
        const onSelect = vi.fn();
        const { getByRole } = renderShelf({ onSelect });
        fireEvent.click(getByRole("button", { name: "Select Mono Red Burn" }));
        expect(onSelect).toHaveBeenCalledWith("mono-red-burn");
    });

    it("marks the selected tile and stops it being re-selected", () => {
        const { container, getByRole } = renderShelf({
            selectedPresetId: "mono-red-burn",
        });
        expect(
            container
                .querySelector("[data-deck-tile]")!
                .getAttribute("data-selected")
        ).toBe("true");
        expect(
            (
                getByRole("button", {
                    name: "Mono Red Burn — already selected",
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
    });

    it("blocks selection of an illegal deck but keeps its overflow live (ADR 0036, issue #512)", () => {
        const { getByRole, getByText } = renderShelf({
            decks: [makeDeck({ isLegal: false })],
            onEdit: vi.fn(),
        });
        expect(
            (
                getByRole("button", {
                    name: "Select Mono Red Burn",
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(getByText("Illegal")).toBeTruthy();
        // ...which is how it gets edited back into legality.
        expect(
            getByRole("button", { name: "More actions for Mono Red Burn" })
        ).toBeTruthy();
    });

    it("routes Open / Edit / Delete through the overflow", () => {
        const onOpen = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        const { getByRole } = renderShelf({ onOpen, onEdit, onDelete });
        const openMenu = () =>
            fireEvent.click(
                getByRole("button", { name: "More actions for Mono Red Burn" })
            );

        openMenu();
        fireEvent.click(getByRole("menuitem", { name: "Open" }));
        expect(onOpen).toHaveBeenCalledWith("mono-red-burn");

        openMenu();
        fireEvent.click(getByRole("menuitem", { name: "Edit" }));
        expect(onEdit).toHaveBeenCalledWith("mono-red-burn");

        openMenu();
        fireEvent.click(getByRole("menuitem", { name: "Delete" }));
        expect(onDelete).toHaveBeenCalledWith("mono-red-burn");
    });

    it("withholds Edit and Delete when the viewer may not perform them", () => {
        const { getByRole, queryByRole } = renderShelf();
        fireEvent.click(
            getByRole("button", { name: "More actions for Mono Red Burn" })
        );
        // Not a menu of dead rows: the items are absent, and Open — which
        // anybody may do — is still there.
        expect(getByRole("menuitem", { name: "Open" })).toBeTruthy();
        expect(queryByRole("menuitem", { name: "Edit" })).toBeNull();
        expect(queryByRole("menuitem", { name: "Delete" })).toBeNull();
    });

    it("shows the caller's empty label instead of an empty scroller", () => {
        const { getByText, container } = renderShelf({ decks: [] });
        expect(getByText("No saved decks yet.")).toBeTruthy();
        expect(container.querySelector("[data-deck-tile]")).toBeNull();
    });

    it("renders the shelf's own controls beside its title", () => {
        const { getByRole } = renderShelf({
            actions: <button type="button">+ New Deck</button>,
        });
        expect(getByRole("heading", { name: "Your decks" })).toBeTruthy();
        expect(getByRole("button", { name: "+ New Deck" })).toBeTruthy();
    });
});
