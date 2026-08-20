// `holdPreview` — the switch that removes the touch long-press preview from
// the EDITING surfaces while leaving the board's untouched (PRD #2405 gesture
// model A, issue #2583; the board's model is ADR 0009 and does not change).
//
// This is the census's must-NOT row made executable. On an editing surface a
// 250ms hold is the DRAG, so a preview opening under the finger at 400ms would
// fight it; everywhere else — the board, the piles, the lobby — the hold IS
// the preview and must keep working. Both halves are asserted here, because a
// switch that turns everything off passes a test that only checks the "off"
// case.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import CardPreview from "../card-preview";
import { resetPreviewSingleton } from "../card-preview-singleton";
import { PRESS_SCALE } from "~/hooks/useLongPress";
import { GameContext } from "~/hooks/useGameContext";
import type { Id } from "@convex/_generated/dataModel";

const GAME_CTX = {
    gameId: "g1" as Id<"games">,
    playerId: "p1",
    activePlayerId: "p1",
    priorityPlayerId: "p1",
    phase: "PRECOMBAT_MAIN" as const,
    turn: 1,
    engineTurn: 1,
    stackCount: 0,
    stackItems: [],
    allPlayers: [],
    showAllCards: false,
    debugAllActions: false,
    onSwitchGame: () => {},
};

/** `useLongPress`' own threshold (400ms) — past it the centered overlay is up
 *  on any surface that still has the gesture. */
const PAST_LONG_PRESS_MS = 500;

function renderPreview(holdPreview?: boolean) {
    return render(
        <GameContext value={GAME_CTX}>
            <CardPreview
                cardId="bolt"
                cardName="Lightning Bolt"
                holdPreview={holdPreview}
            >
                <div>face</div>
            </CardPreview>
        </GameContext>
    );
}

const overlay = () => document.querySelector(".fixed.inset-0");
const dock = () => document.querySelector("[data-card-preview-dock]");

function longPress(root: HTMLElement) {
    act(() => {
        fireEvent.touchStart(root, { touches: [{ clientX: 10, clientY: 10 }] });
        vi.advanceTimersByTime(PAST_LONG_PRESS_MS);
    });
}

describe("CardPreview holdPreview (issue #2583)", () => {
    beforeEach(() => {
        resetPreviewSingleton();
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        resetPreviewSingleton();
    });

    it("opens the long-press overlay by default — the board is untouched", () => {
        const { container } = renderPreview();
        longPress(container.firstElementChild as HTMLElement);
        expect(overlay()).toBeTruthy();
    });

    it("still opens it when the surface explicitly asks for the hold", () => {
        const { container } = renderPreview(true);
        longPress(container.firstElementChild as HTMLElement);
        expect(overlay()).toBeTruthy();
    });

    it("opens NOTHING on an editing surface, however long the hold", () => {
        const { container } = renderPreview(false);
        const root = container.firstElementChild as HTMLElement;
        longPress(root);
        expect(overlay()).toBeNull();

        // Not merely late: holding for seconds past the peek-lock threshold
        // must still show nothing, or the drag would end under a preview.
        act(() => {
            vi.advanceTimersByTime(3000);
        });
        expect(overlay()).toBeNull();
    });

    // The two `holdPreview` gates are NOT equivalent, and the PR originally
    // claimed they were: `useLongPress`' phase is driven exclusively by the
    // touch handlers, so the `showOverlay` gate is strictly redundant while
    // the TOUCHSTART gate is load-bearing. It additionally suppresses the
    // press scale-up (`PRESS_SCALE`, applied to the wrapper by
    // `longPress.scaleStyle`) and `useLongPress`' `preventDefault()` on
    // touchend. Neither was asserted anywhere, so removing the touchstart
    // gate alone left 32 tests green (issue #2583 review). This is the
    // assertion that makes it independently provable.
    it("never even enters the pressing phase — no scale-up under the finger", () => {
        const { container } = renderPreview(false);
        const root = container.firstElementChild as HTMLElement;
        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        });
        // `pressing` is the phase the touchstart handler enters, and it is
        // the ONLY thing that scales the wrapper. Still at rest ⇒ the
        // touchstart gate held.
        expect(root.style.transform).toBe("scale(1)");
        expect(root.style.transform).not.toContain(String(PRESS_SCALE));
    });

    it("scales up under the finger when the hold IS the preview — the board", () => {
        // The other half: the assertion above must be able to see the press,
        // or it proves nothing.
        const { container } = renderPreview(true);
        const root = container.firstElementChild as HTMLElement;
        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        });
        expect(root.style.transform).toBe(`scale(${PRESS_SCALE})`);
    });

    it("still records that the pointer was a finger, so no hover path opens", () => {
        // The subtle half: suppressing the hold must NOT suppress
        // `sawTouchRef`. If it did, an editing surface on a phone would start
        // hover-previewing — the mouse fallback firing on a touch device.
        const { container } = renderPreview(false);
        const root = container.firstElementChild as HTMLElement;
        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        });
        act(() => {
            fireEvent.pointerEnter(root, { pointerType: "mouse" });
            vi.advanceTimersByTime(1000);
        });
        expect(dock()).toBeNull();
        expect(overlay()).toBeNull();
    });
});
