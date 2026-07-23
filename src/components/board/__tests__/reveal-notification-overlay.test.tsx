// Frontend wiring for the transient look/reveal popup (CR 701.18a look /
// CR 701.20 reveal, `SpellContext.notifyReveal`, ADR 0026). The projection
// filters `pendingReveals` to the viewer's audience, so the overlay shows every
// entry it receives — each id once (dismiss on click or after a timeout). This
// is the client surface that was missing: Urza's Bauble / Mishra's Bauble
// enqueued a reveal that no component rendered.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import type { RevealNotification } from "~/types/game";

// Render the card as a testable stub (jsdom can't load the real srcset image).
vi.mock("~/components/cards/card-image", () => ({
    __esModule: true,
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid="reveal-card" data-card-id={card.id} />
    ),
}));

import RevealNotificationOverlay from "~/components/board/reveal-notification-overlay";

afterEach(cleanup);
beforeEach(() => vi.useRealTimers());

const LOOK: RevealNotification = {
    id: "bauble:0:0",
    audience: ["p1"],
    source: "urzas-bauble",
    kind: "look",
    cards: [{ instanceId: "p2-secret", cardId: "card-lightning-bolt" }],
};

function renderOverlay(pendingReveals?: RevealNotification[]) {
    const ctx = {
        gameId: "game-id",
        playerId: "p1",
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        pendingReveals,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={ctx}>
            <RevealNotificationOverlay />
        </GameContext>
    );
}

describe("RevealNotificationOverlay (private look / public reveal popup)", () => {
    it("shows the looked card face-up with a look heading", () => {
        const { getByText, getByTestId } = renderOverlay([LOOK]);
        expect(getByText("You look at this card")).toBeTruthy();
        expect(getByTestId("reveal-card").getAttribute("data-card-id")).toBe(
            "card-lightning-bolt"
        );
    });

    it("renders nothing when there are no pending reveals", () => {
        const { container } = renderOverlay(undefined);
        expect(container.firstChild).toBeNull();
    });

    it("dismisses on click and does not reopen for the same id", () => {
        const { getByRole, queryByText, rerender } = renderOverlay([LOOK]);
        fireEvent.click(getByRole("button"));
        expect(queryByText("You look at this card")).toBeNull();
        // A reactive re-render of the SAME snapshot must not re-pop it.
        const ctx = {
            gameId: "game-id",
            playerId: "p1",
            allPlayers: [],
            showAllCards: false,
            debugAllActions: false,
            pendingReveals: [LOOK],
        } as unknown as React.ContextType<typeof GameContext>;
        rerender(
            <GameContext value={ctx}>
                <RevealNotificationOverlay />
            </GameContext>
        );
        expect(queryByText("You look at this card")).toBeNull();
    });

    it("auto-dismisses after the 5s timeout", () => {
        vi.useFakeTimers();
        const { queryByText } = renderOverlay([LOOK]);
        expect(queryByText("You look at this card")).toBeTruthy();
        act(() => {
            vi.advanceTimersByTime(4999);
        });
        expect(queryByText("You look at this card")).toBeTruthy();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(queryByText("You look at this card")).toBeNull();
    });

    // The overlay div is never focused, so the dismiss key must be handled on a
    // window-level listener — and must not fall through to the global Space
    // hotkey (Pass priority) while the popup is up.
    it("dismisses on Space pressed anywhere and swallows the keystroke", () => {
        const passSpy = vi.fn();
        window.addEventListener("keydown", passSpy);
        const { queryByText } = renderOverlay([LOOK]);
        act(() => {
            fireEvent.keyDown(window, { code: "Space", key: " " });
        });
        expect(queryByText("You look at this card")).toBeNull();
        expect(passSpy).not.toHaveBeenCalled();
        window.removeEventListener("keydown", passSpy);
    });

    it("dismisses on Escape", () => {
        const { queryByText } = renderOverlay([LOOK]);
        act(() => {
            fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
        });
        expect(queryByText("You look at this card")).toBeNull();
    });

    it("uses a plural reveal heading for a multi-card public reveal", () => {
        const { getByText, getAllByTestId } = renderOverlay([
            {
                id: "probe:0:0",
                audience: ["p1"],
                source: "gitaxian-probe",
                kind: "reveal",
                cards: [
                    { instanceId: "h1", cardId: "card-a" },
                    { instanceId: "h2", cardId: "card-b" },
                ],
            },
        ]);
        expect(getByText("Revealed cards")).toBeTruthy();
        expect(getAllByTestId("reveal-card")).toHaveLength(2);
    });
});
