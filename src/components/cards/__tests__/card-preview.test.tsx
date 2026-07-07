// Desktop card preview — Arena click model (#332).
//
// The preview is driven entirely by the RIGHT mouse button; left-click stays a
// gameplay action and never opens a preview. A quick right-click toggles an
// anchored preview beside the card (board + lobby alike); holding the right
// button past the threshold shows the big preview in the board's right-column
// dock while held (board only). The mobile long-press centered overlay (ADR
// 0009) is a separate, untouched surface. These are render-level contract
// tests, asserted via the `data-card-preview-{anchored,dock}` markers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import CardPreview from "../card-preview";
import { resetPreviewSingleton } from "../card-preview-singleton";
import { RIGHT_HOLD_ZOOM_MS } from "~/hooks/useRightPressPreview";
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

const anchored = () => document.querySelector("[data-card-preview-anchored]");
const dock = () => document.querySelector("[data-card-preview-dock]");

function rightPress(root: HTMLElement) {
    act(() => {
        fireEvent.mouseDown(root, { button: 2 });
    });
}
function release() {
    act(() => {
        fireEvent(window, new MouseEvent("mouseup"));
    });
}
function holdPastThreshold() {
    act(() => {
        vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS);
    });
}

describe("CardPreview — Arena click model (#332)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetPreviewSingleton();
    });
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        cleanup();
    });

    it("left-click never opens a preview", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        act(() => {
            fireEvent.mouseDown(root, { button: 0 });
        });
        release();

        expect(anchored()).toBeNull();
        expect(dock()).toBeNull();
    });

    it("quick right-click toggles the anchored preview beside the card", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        expect(anchored()).toBeNull();

        // Quick right-click (release before the hold threshold) opens anchored.
        rightPress(root);
        release();
        const panel = anchored() as HTMLElement;
        expect(panel).toBeTruthy();
        expect(panel.className).toContain("fixed");
        // Anchored placement uses inline top/left, never the dock's edge utils.
        expect(panel.style.left).not.toBe("");
        expect(panel.style.top).not.toBe("");
        expect(dock()).toBeNull();

        // A second quick right-click on the same card closes it.
        rightPress(root);
        release();
        expect(anchored()).toBeNull();
    });

    it("closes the anchored preview on an outside pointerdown", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        rightPress(root);
        release();
        expect(anchored()).toBeTruthy();

        act(() => {
            fireEvent.pointerDown(document.body);
        });
        expect(anchored()).toBeNull();
    });

    it("closes the anchored preview on Escape", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        rightPress(root);
        release();
        expect(anchored()).toBeTruthy();

        act(() => {
            fireEvent.keyDown(document, { key: "Escape" });
        });
        expect(anchored()).toBeNull();
    });

    it("holding the right button shows the dock zoom on the board, release closes it", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        rightPress(root);
        holdPastThreshold();

        const d = dock() as HTMLElement;
        expect(d).toBeTruthy();
        expect(d.className).toContain("fixed");
        expect(d.className).toContain("right-2");
        // The zoom supersedes the anchored surface — only one shows at a time.
        expect(anchored()).toBeNull();

        release();
        expect(dock()).toBeNull();
    });

    it("hold-zoom supersedes an already-open anchored preview", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        // Open the anchored preview first.
        rightPress(root);
        release();
        expect(anchored()).toBeTruthy();

        // Now hold: the dock zoom appears and the anchored is hidden.
        rightPress(root);
        holdPastThreshold();
        expect(dock()).toBeTruthy();
        expect(anchored()).toBeNull();

        release();
        expect(dock()).toBeNull();
        expect(anchored()).toBeNull();
    });

    it("has no hold-zoom in the lobby (no board dock)", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        rightPress(root);
        holdPastThreshold();

        expect(dock()).toBeNull();
        expect(anchored()).toBeNull();

        release();
        expect(dock()).toBeNull();
    });

    it("suppresses the right-button path after a touch (touch device)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        });
        rightPress(root);
        release();

        expect(anchored()).toBeNull();
        expect(dock()).toBeNull();
    });

    it("leaves the mobile long-press overlay untouched (no dock on touch)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
            vi.advanceTimersByTime(400);
        });

        expect(dock()).toBeNull();
        const overlay = document.querySelector(".fixed.inset-0");
        expect(overlay).toBeTruthy();
        expect(overlay!.className).toContain("items-center");
        expect(overlay!.className).toContain("justify-center");
    });
});
