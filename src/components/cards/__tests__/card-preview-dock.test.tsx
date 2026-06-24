// Issue #332 — desktop card preview placement.
//
// These render-level tests assert the contract, not pixels:
//  - On the in-game board (under a GameContext provider), the hover preview
//    mounts at the fixed RIGHT-column dock (`data-card-preview-dock`), anchored
//    to the right edge and vertically centered, regardless of which card was
//    hovered.
//  - In the lobby/deck-builder (no GameContext), the preview floats next to the
//    hovered card (`data-card-preview-anchored`) — the original placement.
//  - The mobile long-press centered overlay path (ADR 0009) is untouched: it
//    still opens the centered backdrop overlay and never a dock.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import CardPreview from "../card-preview";
import { resetPreviewSingleton } from "../card-preview-singleton";
import { HOVER_DELAY_MS } from "../card-preview";
import { GameContext } from "~/hooks/useGameContext";
import type { Id } from "@convex/_generated/dataModel";

// Minimal GameContext value — the preview only reads it as a presence signal
// (board vs lobby) and, when a cardInstance is supplied, for effective P/T.
const GAME_CTX = {
    gameId: "g1" as Id<"games">,
    playerId: "p1",
    activePlayerId: "p1",
    priorityPlayerId: "p1",
    phase: "PRECOMBAT_MAIN" as const,
    turn: 1,
    stackCount: 0,
    allPlayers: [],
    showAllCards: false,
    debugAllActions: false,
};

function renderOnBoard(children: ReactNode = <div>face</div>) {
    return render(
        <GameContext value={GAME_CTX}>
            <CardPreview cardId="bolt" cardName="Lightning Bolt">
                {children}
            </CardPreview>
        </GameContext>
    );
}

function renderInLobby(children: ReactNode = <div>face</div>) {
    return render(
        <CardPreview cardId="bolt" cardName="Lightning Bolt">
            {children}
        </CardPreview>
    );
}

describe("CardPreview desktop right-column dock — board (#332)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("mounts the preview at the fixed right-column dock on hover", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        // Before hover, no dock.
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();

        // Hover and let the open delay elapse.
        fireEvent.mouseEnter(root);
        act(() => {
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });

        const dock = document.querySelector<HTMLElement>(
            "[data-card-preview-dock]"
        );
        expect(dock).toBeTruthy();
        // Fixed-position, right-edge anchored — the layout contract (a contract,
        // not a pixel value). The dock now spans a top inset down to a reserved
        // bottom safe-area (clearing the controller pod) and centers the card
        // within that band, so it no longer uses `top-1/2`/`-translate-y-1/2`.
        expect(dock!.className).toContain("fixed");
        expect(dock!.className).toContain("right-2");
        expect(dock!.className).toContain("items-center");
        // Bounded above the controller pod, never the whole viewport.
        expect(dock!.style.top).not.toBe("");
        expect(dock!.style.bottom).toContain("--preview-bottom-safe");
        // It never uses the lobby's anchored surface.
        expect(
            document.querySelector("[data-card-preview-anchored]")
        ).toBeNull();
    });

    it("disappears on mouse-out", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        fireEvent.mouseEnter(root);
        act(() => {
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });
        expect(document.querySelector("[data-card-preview-dock]")).toBeTruthy();

        // Pointer leaves outside the card's rect (jsdom rects are 0×0, so any
        // coordinate is outside) → close.
        fireEvent.mouseLeave(root, { clientX: 999, clientY: 999 });
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
    });

    it("leaves the mobile long-press overlay path untouched (no dock on touch)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        // Drive the touch long-press path (ADR 0009).
        fireEvent.touchStart(root, {
            touches: [{ clientX: 10, clientY: 10 }],
        });
        act(() => {
            vi.advanceTimersByTime(400);
        });

        // The centered overlay (mobile) opens — NOT the right-column dock.
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
        const overlay = document.querySelector(".fixed.inset-0");
        expect(overlay).toBeTruthy();
        // The overlay is the centered backdrop, distinct from the dock.
        expect(overlay!.className).toContain("items-center");
        expect(overlay!.className).toContain("justify-center");
    });

    it("ignores hover after a touch (touch device suppresses the desktop dock)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        // A touch marks the input as touch; subsequent synthetic mouse hover
        // (ghost events) must not open the desktop dock.
        fireEvent.touchStart(root, {
            touches: [{ clientX: 10, clientY: 10 }],
        });
        act(() => {
            fireEvent.mouseEnter(root);
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
    });
});

describe("CardPreview anchored placement — lobby/deck-builder (#332)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("floats the preview next to the card (anchored, not the dock) on hover", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        fireEvent.mouseEnter(root);
        act(() => {
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });

        // No board dock — the anchored beside-the-card surface instead.
        expect(document.querySelector("[data-card-preview-dock]")).toBeNull();
        const anchored = document.querySelector<HTMLElement>(
            "[data-card-preview-anchored]"
        );
        expect(anchored).toBeTruthy();
        expect(anchored!.className).toContain("fixed");
        // Positioned via inline top/left (clamped to the card), not the dock's
        // edge utility classes.
        expect(anchored!.className).not.toContain("right-2");
        expect(anchored!.className).not.toContain("left-2");
        expect(anchored!.style.left).not.toBe("");
        expect(anchored!.style.top).not.toBe("");
    });

    it("disappears on mouse-out", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        fireEvent.mouseEnter(root);
        act(() => {
            vi.advanceTimersByTime(HOVER_DELAY_MS);
        });
        expect(
            document.querySelector("[data-card-preview-anchored]")
        ).toBeTruthy();

        fireEvent.mouseLeave(root, { clientX: 999, clientY: 999 });
        expect(
            document.querySelector("[data-card-preview-anchored]")
        ).toBeNull();
    });
});
