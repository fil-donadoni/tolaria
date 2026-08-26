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

    // happy-dom has no layout, so this cannot assert the RENDERED box — the
    // browser measurement that motivated it is `bun run check:ui`'s `lobby`
    // rows (61 sub-44px triggers at both coarse-pointer tablet viewports
    // before, 0 after). What it CAN guard is that the trigger keeps reading
    // the pointer-aware token instead of the flat `icon-sm` 28px square: a
    // Deck Shelf renders one of these per deck, so dropping the token is 61
    // WCAG 2.5.8 failures at once and the `dom` project would not see it.
    it("sizes the trigger off --control-h so a coarse pointer gets 44px (ADR 0101 §2, issue #2726)", () => {
        render(<DeckRowMenu deckName="Mono Red Burn" onDelete={vi.fn()} />);
        const classes = screen
            .getByRole("button", { name: "More actions for Mono Red Burn" })
            .className.split(/\s+/);
        expect(classes).toContain("min-h-[var(--control-h)]");
        expect(classes).toContain("min-w-[var(--control-h)]");
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
