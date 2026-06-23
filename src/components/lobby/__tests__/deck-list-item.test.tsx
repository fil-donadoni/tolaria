// Lobby deck row: an illegal deck (ADR 0036, issue #512) is flagged "Illegal"
// and its Select button is disabled, so the player can't pick a deck the
// server would only reject at game start. See `../deck-list-item`.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { LobbyDeck } from "~/lib/deckTypes";
import DeckListItem from "../deck-list-item";

function deck(overrides: Partial<LobbyDeck> = {}): LobbyDeck {
    return {
        kind: "preset",
        presetId: "p1",
        name: "Test Deck",
        format: "old-school",
        colors: ["R"],
        cards: [],
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

describe("DeckListItem legality (issue #512)", () => {
    it("renders a Select button enabled for a legal deck", () => {
        const onSelect = vi.fn();
        const { getByText } = render(
            <DeckListItem
                deck={deck()}
                isSelected={false}
                onFocus={vi.fn()}
                onSelect={onSelect}
            />
        );
        const button = getByText("Select") as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        fireEvent.click(button);
        expect(onSelect).toHaveBeenCalledWith("p1");
    });

    it("carries the reduced-motion-gated micro-motion hooks (issue #598)", () => {
        // `data-deck-row` + `data-selected` drive the selected-Deck pulse and
        // `deck-row-liftable` the hover-lift. The CSS that consumes them is
        // gated behind prefers-reduced-motion: no-preference (asserted in
        // src/__tests__/motion-gating.test.ts), so carrying the hooks is the
        // component's whole responsibility here.
        const { container, rerender } = render(
            <DeckListItem deck={deck()} isSelected={false} onFocus={vi.fn()} />
        );
        const row = container.querySelector("[data-deck-row]")!;
        expect(row).not.toBeNull();
        expect(row.className).toContain("deck-row-liftable");
        expect(row.getAttribute("data-selected")).toBe("false");

        rerender(<DeckListItem deck={deck()} isSelected onFocus={vi.fn()} />);
        expect(
            container
                .querySelector("[data-deck-row]")!
                .getAttribute("data-selected")
        ).toBe("true");
    });

    it("flags an illegal deck and disables its Select button", () => {
        const onSelect = vi.fn();
        const { getByText } = render(
            <DeckListItem
                deck={deck({
                    isLegal: false,
                    reasons: [
                        {
                            code: "size-min",
                            message: "Maindeck has 1 cards, minimum is 60.",
                        },
                    ],
                })}
                isSelected={false}
                onFocus={vi.fn()}
                onSelect={onSelect}
            />
        );
        expect(getByText("Illegal")).toBeTruthy();
        const button = getByText("Select") as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
