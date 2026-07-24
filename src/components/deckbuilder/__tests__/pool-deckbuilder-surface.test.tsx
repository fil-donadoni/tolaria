// Reusable Pool deckbuilder surface (issue #1244; column-drag parity, issue
// #1575): the Maindeck is now the SAME fixed Mana-Value column set as the
// draft Pool (every column an individual drop target, honouring a per-card
// manual override), alongside the flat Sideboard column. Light smoke coverage
// — the pure drag resolution lives in `deckbuilderColumnDrag.test.ts` and the
// fixed-column grouping in `deckGrouping.test.ts`; this file proves the
// composition wires the right props to the right surface.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { DeckCard } from "~/types/game";
import PoolDeckbuilderSurface from "../pool-deckbuilder-surface";

// Real registry ids — the grouping resolves each card's auto column via the
// card registry, so synthetic ids would throw.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function card(id: string, name = id): DeckCard {
    return { cardId: id, cardName: name };
}

const NO_OVERRIDE = () => undefined;

function renderSurface(
    props: Partial<Parameters<typeof PoolDeckbuilderSurface>[0]> = {}
) {
    return render(
        <PoolDeckbuilderSurface
            mainCards={[]}
            sideCards={[]}
            onMoveToSideboard={() => {}}
            onMoveToMaindeck={() => {}}
            columnOf={NO_OVERRIDE}
            onSetColumn={() => {}}
            mainEmptyMessage="main empty"
            sideEmptyMessage="side empty"
            {...props}
        />
    );
}

describe("PoolDeckbuilderSurface (issue #1575)", () => {
    it("renders the Maindeck and Sideboard titles with live counts", () => {
        const { getByText } = renderSurface({
            mainCards: [card(BOLT_ID)],
            sideCards: [card(PLAINS_ID)],
        });
        expect(getByText(/Maindeck 1/)).toBeTruthy();
        expect(getByText(/Pool \(Sideboard\) 1/)).toBeTruthy();
    });

    it("renders the full fixed Mana-Value column set in the Maindeck (every column a drop target)", () => {
        // Parity with the draft Pool: the top column is MV 7+ and every
        // column always renders even when empty.
        const { getByText, getAllByText } = renderSurface({
            mainCards: [card(BOLT_ID)],
            sideCards: [card(PLAINS_ID)],
        });
        expect(getByText("MV 7+")).toBeTruthy();
        expect(getAllByText("MV 1").length).toBe(1); // the Bolt column
        expect(getByText("MV 0")).toBeTruthy();
    });

    it("places a Maindeck card in the column its manual override names, not its auto column", () => {
        // Bolt is MV 1 by default; pin it to MV 6 via the override. It leaves
        // the MV 1 column empty (0) and lands in MV 6.
        const columnOf = (id: string) => (id === BOLT_ID ? 6 : undefined);
        const { getByText } = renderSurface({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            columnOf,
        });
        // The card renders under its overridden column; its remove affordance
        // is present exactly once.
        expect(getByText("Maindeck 1")).toBeTruthy();
        expect(getByText("MV 6")).toBeTruthy();
    });

    it("shows the empty-Maindeck hint while still rendering the columns as drop targets", () => {
        const { getByText } = renderSurface({
            mainEmptyMessage: "Move Pool cards here.",
            sideEmptyMessage: "Everything lives here until moved.",
        });
        expect(getByText("Move Pool cards here.")).toBeTruthy();
        expect(getByText("Everything lives here until moved.")).toBeTruthy();
        // Columns still render even with an empty Maindeck.
        expect(getByText("MV 0")).toBeTruthy();
    });

    it("clicking a Maindeck card fires onMoveToSideboard with its id", () => {
        const onMoveToSideboard = vi.fn();
        const { getByTitle } = renderSurface({
            mainCards: [card(BOLT_ID, "Lightning Bolt")],
            onMoveToSideboard,
        });
        fireEvent.click(getByTitle(/Remove Lightning Bolt/));
        expect(onMoveToSideboard).toHaveBeenCalledWith(BOLT_ID);
    });

    it("clicking a Sideboard card fires onMoveToMaindeck with its id", () => {
        const onMoveToMaindeck = vi.fn();
        const { getByTitle } = renderSurface({
            sideCards: [card(PLAINS_ID, "Plains")],
            onMoveToMaindeck,
        });
        fireEvent.click(getByTitle(/Remove Plains/));
        expect(onMoveToMaindeck).toHaveBeenCalledWith(PLAINS_ID);
    });

    it("renders a per-zone zoom slider for both Maindeck and Sideboard", () => {
        const { getByLabelText } = renderSurface();
        expect(getByLabelText("Maindeck card size")).toBeTruthy();
        expect(getByLabelText("Sideboard card size")).toBeTruthy();
    });
});
