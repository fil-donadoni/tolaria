// Issue #7388: the Decklist view's fixed preview column — card back while
// idle, the hovered card's preview on row hover, back to the card back after
// the shared hover grace.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import DecklistView from "../decklist-view";

const MAIN = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const SIDE = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
const card = (cardId: string) => ({ cardId, cardName: `name-${cardId}` });

describe("DecklistView preview column (issue #7388)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const renderView = () =>
        render(
            <DecklistView maindeck={[card(MAIN)]} sideboard={[card(SIDE)]} />
        );
    const rowOf = (el: HTMLElement) => el.closest("li") as HTMLElement;
    const settle = () => act(() => void vi.advanceTimersByTime(500));

    it("idle: the column holds the card back", () => {
        const { getByTestId, getByAltText } = renderView();
        expect(getByTestId("decklist-preview-column")).toBeTruthy();
        expect(getByAltText("Card back")).toBeTruthy();
    });

    it.each([
        ["Maindeck", MAIN],
        ["Sideboard", SIDE],
    ])(
        "%s row hover shows that card's preview, leave restores the back",
        (_p, id) => {
            const { getByText, queryByAltText, getByTestId } = renderView();
            const row = rowOf(getByText(`name-${id}`));
            fireEvent.mouseEnter(row);
            expect(queryByAltText("Card back")).toBeNull();
            expect(getByTestId("decklist-preview-column").textContent).not.toBe(
                ""
            );
            fireEvent.mouseLeave(row);
            settle();
            expect(queryByAltText("Card back")).toBeTruthy();
        }
    );

    it("moving from the row into the column keeps the preview", () => {
        const { getByText, getByTestId, queryByAltText } = renderView();
        const row = rowOf(getByText(`name-${MAIN}`));
        fireEvent.mouseEnter(row);
        fireEvent.mouseLeave(row);
        fireEvent.pointerEnter(getByTestId("decklist-preview-column"));
        settle();
        expect(queryByAltText("Card back")).toBeNull();
    });
});
