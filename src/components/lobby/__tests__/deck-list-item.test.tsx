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
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...overrides,
    } as LobbyDeck;
}

// A real preset Scryfall printing id (non-token).
const REAL_CARD_ID = "d05b92bd-797e-413f-a8b0-32e0937a1ee0";

describe("DeckListItem featured art (PRD #589, issue #600)", () => {
    it("renders the resolved Featured Card art as the row thumbnail", () => {
        const { container } = render(
            <DeckListItem
                deck={deck({ featuredCardId: REAL_CARD_ID })}
                isSelected={false}
                onFocus={vi.fn()}
            />
        );
        const img = container.querySelector("img[src*='art_crop']");
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toContain(REAL_CARD_ID);
    });

    it("renders the no-art fallback for a deck with no featured card", () => {
        const { container } = render(
            <DeckListItem
                deck={deck({ featuredCardId: null })}
                isSelected={false}
                onFocus={vi.fn()}
            />
        );
        // No art image — mana-symbol <img>s may exist, but no art_crop source.
        expect(container.querySelector("img[src*='art_crop']")).toBeNull();
    });
});

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

// axe `nested-interactive`, serious, 52 nodes on the lobby at every one of the
// five viewports — the single violation that held `scripts/ui-gate/budgets.json`
// above its own `axeSerious 0` floor for this surface. The row was
// `<div role="button" tabIndex={0}>` wrapped around a real `<button>`: an
// interactive role may not contain focusable descendants, because assistive
// tech flattens it to one control and the buttons inside become unreachable.
// Issue #2593 replaced it with the stretched-link pattern.
describe("DeckListItem is not a nested interactive (issue #2593)", () => {
    it("the row itself is inert — no role, no tab stop", () => {
        const { container } = render(
            <DeckListItem
                deck={deck()}
                isSelected={false}
                onFocus={vi.fn()}
                onSelect={vi.fn()}
            />
        );
        const row = container.querySelector("[data-deck-row]")!;
        expect(row.getAttribute("role")).toBeNull();
        expect(row.getAttribute("tabindex")).toBeNull();
    });

    it("no interactive element contains another one", () => {
        const { container } = render(
            <DeckListItem
                deck={deck()}
                isSelected={false}
                onFocus={vi.fn()}
                onSelect={vi.fn()}
                extraActions={<button type="button">Edit</button>}
            />
        );
        // The rule axe applies, restated: nothing focusable inside anything
        // that is itself exposed as a control.
        const interactive =
            "button,a[href],input,select,textarea,[role=button],[tabindex]";
        for (const el of container.querySelectorAll(interactive))
            expect(el.querySelector(interactive)).toBeNull();
    });

    it("the row-wide gesture is a real button sized from the ROW, named by the deck", () => {
        const onFocus = vi.fn();
        const { container, getByText } = render(
            <DeckListItem
                deck={deck()}
                isSelected={false}
                onFocus={onFocus}
                onSelect={vi.fn()}
            />
        );
        const row = container.querySelector("[data-deck-row]")!;
        const overlay = row.querySelector("button")! as HTMLButtonElement;
        // Sized from the row, not from the label: the deck name is a
        // `truncate` flex item and squeezes to sub-4px on a phone, which is
        // how the first cut of this scored `ctrlsZero 52` at 390x844x3.
        expect(overlay.className).toContain("absolute");
        expect(overlay.className).toContain("inset-0");
        expect(row.className).toContain("relative");
        // The pointer path and the keyboard path are the same control, which is
        // what keeps them from drifting.
        fireEvent.click(overlay);
        expect(onFocus).toHaveBeenCalledWith("p1");
        // ...and it is announced as the deck, borrowing the visible text.
        const name = getByText("Test Deck");
        expect(overlay.getAttribute("aria-labelledby")).toBe(name.id);
        expect(name.id).not.toBe("");
    });

    it("keeps the actions cluster above the overlay", () => {
        const { container } = render(
            <DeckListItem
                deck={deck()}
                isSelected={false}
                onFocus={vi.fn()}
                onSelect={vi.fn()}
            />
        );
        const select = container.querySelector("button:not([class*=inset-0])")!;
        expect(select.textContent).toContain("Select");
        expect(select.parentElement!.className).toContain("z-10");
    });
});
