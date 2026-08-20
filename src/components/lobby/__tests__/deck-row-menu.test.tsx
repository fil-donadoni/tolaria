// Compact deck rows move Delete behind a "⋯" overflow (PRD #2405 D15 / ADR
// 0101 §9, issue #2591) instead of an always-visible destructive button.
// See `../deck-row-menu`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import DeckRowMenu from "../deck-row-menu";

describe("DeckRowMenu (issue #2591)", () => {
    it("hides Delete until the '⋯' trigger is opened", () => {
        render(<DeckRowMenu deckName="Mono Red Burn" onDelete={vi.fn()} />);
        expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for Mono Red Burn",
            })
        );
        expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
    });

    it("fires onDelete when the menu's Delete item is clicked", () => {
        const onDelete = vi.fn();
        render(<DeckRowMenu deckName="Mono Red Burn" onDelete={onDelete} />);
        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for Mono Red Burn",
            })
        );
        fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("does not bubble the trigger click to an ancestor's onClick (row stays unselected)", () => {
        const rowClick = vi.fn();
        render(
            // Stand-in for `DeckListItem`'s clickable row (a `div` with
            // `role="button"` + `onClick`, same shape).
            <div role="button" tabIndex={0} onClick={rowClick}>
                <DeckRowMenu deckName="Mono Red Burn" onDelete={vi.fn()} />
            </div>
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for Mono Red Burn",
            })
        );
        expect(rowClick).not.toHaveBeenCalled();
    });
});
