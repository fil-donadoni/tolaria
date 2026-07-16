// Reusable Pool deckbuilder surface (issue #1244, prefactor for PRD #1241):
// Mana-Value column piles + Sideboard column + drag-and-drop + zoom slider,
// extracted from `PoolDeckBuilderForm` so the draft-time Pool view can reuse
// it later (ADR 0060). Light smoke coverage only — the underlying pile
// rendering/dnd/zoom behavior is already exercised by `DeckPileArea`'s own
// test suite; this file just proves the extracted composition wires the
// right props to the right zone.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { DeckCard } from "~/types/game";
import PoolDeckbuilderSurface from "../pool-deckbuilder-surface";

// Real registry ids — `groupDeckIntoPiles` resolves each card via the card
// registry, so synthetic ids would throw.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

describe("PoolDeckbuilderSurface", () => {
    it("renders the Maindeck and Sideboard titles with live counts", () => {
        const { getByText } = render(
            <PoolDeckbuilderSurface
                mainCards={[card(BOLT_ID)]}
                sideCards={[card(PLAINS_ID)]}
                onMoveToSideboard={() => {}}
                onMoveToMaindeck={() => {}}
                mainEmptyMessage="main empty"
                sideEmptyMessage="side empty"
            />
        );
        expect(getByText(/Maindeck 1/)).toBeTruthy();
        expect(getByText(/Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("groups both the Maindeck and Sideboard into mana-value piles", () => {
        // The Limited build view groups both columns (unlike the catalogue
        // DeckBuilder, whose Sideboard is a single ungrouped pile) —
        // preserved verbatim by the extraction.
        const { getAllByText } = render(
            <PoolDeckbuilderSurface
                mainCards={[card(BOLT_ID)]}
                sideCards={[card(PLAINS_ID)]}
                onMoveToSideboard={() => {}}
                onMoveToMaindeck={() => {}}
                mainEmptyMessage="main empty"
                sideEmptyMessage="side empty"
            />
        );
        expect(getAllByText("MV 1").length).toBe(1);
        expect(getAllByText("Lands").length).toBe(1);
    });

    it("renders each column's empty message when it has no cards", () => {
        const { getByText } = render(
            <PoolDeckbuilderSurface
                mainCards={[]}
                sideCards={[]}
                onMoveToSideboard={() => {}}
                onMoveToMaindeck={() => {}}
                mainEmptyMessage="Move Pool cards here."
                sideEmptyMessage="Everything lives here until moved."
            />
        );
        expect(getByText("Move Pool cards here.")).toBeTruthy();
        expect(getByText("Everything lives here until moved.")).toBeTruthy();
    });

    it("clicking a Maindeck card fires onMoveToSideboard with its id", () => {
        const onMoveToSideboard = vi.fn();
        const { getByTitle } = render(
            <PoolDeckbuilderSurface
                mainCards={[card(BOLT_ID, "Lightning Bolt")]}
                sideCards={[]}
                onMoveToSideboard={onMoveToSideboard}
                onMoveToMaindeck={() => {}}
                mainEmptyMessage="main empty"
                sideEmptyMessage="side empty"
            />
        );
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID);
    });

    it("clicking a Sideboard card fires onMoveToMaindeck with its id", () => {
        const onMoveToMaindeck = vi.fn();
        const { getByTitle } = render(
            <PoolDeckbuilderSurface
                mainCards={[]}
                sideCards={[card(PLAINS_ID, "Plains")]}
                onMoveToSideboard={() => {}}
                onMoveToMaindeck={onMoveToMaindeck}
                mainEmptyMessage="main empty"
                sideEmptyMessage="side empty"
            />
        );
        fireEvent.click(getByTitle(/Remove Plains/));
        expect(onMoveToMaindeck).toHaveBeenCalledWith(PLAINS_ID);
    });

    it("renders a per-zone zoom slider for both Maindeck and Sideboard", () => {
        const { getByLabelText } = render(
            <PoolDeckbuilderSurface
                mainCards={[]}
                sideCards={[]}
                onMoveToSideboard={() => {}}
                onMoveToMaindeck={() => {}}
                mainEmptyMessage="main empty"
                sideEmptyMessage="side empty"
            />
        );
        expect(getByLabelText("Maindeck card size")).toBeTruthy();
        expect(getByLabelText("Sideboard card size")).toBeTruthy();
    });
});
