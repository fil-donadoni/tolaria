// Desktop card preview — hover-intent model (phase 2).
//
// HOVER is the discoverable trigger: dwell 250ms on a card and the board's
// right-column dock opens, leaving closes it after a small grace (board only).
// The RIGHT mouse button is the power path: a quick right-click toggles an
// anchored preview pinned beside the card (board + lobby alike). The mobile
// long-press centered overlay (ADR 0009) is a separate, untouched surface.
// These are render-level contract tests, asserted via the
// `data-card-preview-{anchored,dock}` markers.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import CardPreview, { HOVER_DWELL_MS } from "../card-preview";
import { resetPreviewSingleton } from "../card-preview-singleton";
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
    onSwitchGame: () => {},
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
        fireEvent.pointerDown(root, { button: 2 });
    });
}
function release() {
    act(() => {
        fireEvent(window, new Event("pointerup"));
    });
}
function hoverEnter(root: HTMLElement) {
    act(() => {
        fireEvent.pointerEnter(root, { pointerType: "mouse" });
    });
}
function hoverLeave(root: HTMLElement) {
    act(() => {
        fireEvent.pointerLeave(root, { pointerType: "mouse" });
    });
}
function dwellPast() {
    act(() => {
        vi.advanceTimersByTime(HOVER_DWELL_MS);
    });
}
function gracePast() {
    act(() => {
        // runOnlyPendingTimers: vitest's fake scheduler doesn't reliably fire
        // a timer scheduled mid-test at an advanceTimersByTime boundary (the
        // browser fires plainly — this is a harness quirk, not app logic).
        vi.runOnlyPendingTimers();
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
            fireEvent.pointerDown(root, { button: 0 });
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

    it("hover dwell opens the board dock; leaving closes it after the grace", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        // A brush-by (no dwell) opens nothing.
        hoverEnter(root);
        expect(dock()).toBeNull();
        hoverLeave(root);

        hoverEnter(root);
        dwellPast();
        const d = dock() as HTMLElement;
        expect(d).toBeTruthy();
        expect(d.className).toContain("fixed");
        expect(d.className).toContain("right-2");

        hoverLeave(root);
        // Still up during the grace window, then closes.
        expect(dock()).toBeTruthy();
        gracePast();
        expect(dock()).toBeNull();
    });

    it("a pinned anchored preview supersedes hover (and the pin wins over an open dock)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        // Hover opens the dock.
        hoverEnter(root);
        dwellPast();
        expect(dock()).toBeTruthy();

        // Quick right-click pins the anchored preview: the dock closes.
        rightPress(root);
        release();
        expect(anchored()).toBeTruthy();
        expect(dock()).toBeNull();

        // While pinned, hover never re-opens the dock.
        hoverLeave(root);
        gracePast();
        hoverEnter(root);
        dwellPast();
        expect(dock()).toBeNull();
        expect(anchored()).toBeTruthy();
    });

    it("has no hover dock in the lobby (no board dock), right-click pin still works", () => {
        const { container } = renderInLobby();
        const root = container.firstElementChild as HTMLElement;

        hoverEnter(root);
        dwellPast();
        expect(dock()).toBeNull();
        expect(anchored()).toBeNull();
        hoverLeave(root);

        rightPress(root);
        release();
        expect(anchored()).toBeTruthy();
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

    it("hover never opens the dock on a touch device", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        act(() => {
            fireEvent.touchStart(root, {
                touches: [{ clientX: 10, clientY: 10 }],
            });
        });
        hoverEnter(root);
        dwellPast();

        expect(dock()).toBeNull();
        expect(anchored()).toBeNull();
    });

    it("the printed-card toggle swaps the live-text face for the printed full card (phase 2)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        hoverEnter(root);
        dwellPast();
        expect(dock()).toBeTruthy();

        // Default: the computed live-text face (toggle visible, printed hidden).
        const toggle = document.querySelector(
            '[data-preview-mode="printed"]'
        ) as HTMLElement;
        expect(toggle).toBeTruthy();
        expect(
            document.querySelector(
                '[data-card-preview-dock] img[alt*="(printed)"]'
            )
        ).toBeNull();

        act(() => {
            toggle.click();
        });
        const printedImg = document.querySelector(
            '[data-card-preview-dock] img[alt*="(printed)"]'
        ) as HTMLImageElement;
        expect(printedImg).toBeTruthy();
        expect(printedImg.src).toContain("/grid/");
        expect(printedImg.src).toContain(".webp");

        // Toggling back restores the live-text face.
        act(() => {
            (
                document.querySelector(
                    '[data-preview-mode="computed"]'
                ) as HTMLElement
            ).click();
        });
        expect(
            document.querySelector(
                '[data-card-preview-dock] img[alt*="(printed)"]'
            )
        ).toBeNull();
    });

    // Spatial-board flattening: CardTilt3D wraps the card in
    // `transform-style: preserve-3d` around an `overflow-hidden` box, which
    // flattens the subtree so a real right-click hit-tests to the flattening
    // wrapper — an ANCESTOR of the CardPreview container — never reaching a
    // handler bound on the container. The gesture must therefore bind on the
    // tilt root, to which the flattened event bubbles. jsdom has no 3D
    // hit-testing, so we model the outcome: the event TARGETS an ancestor.
    describe("board tilt flattening — right-press binds on the tilt root", () => {
        function renderInTilt(inTrigger = false) {
            const preview = (
                <div data-card-tilt-root>
                    <div data-card-tilt>
                        <div className="overflow-hidden">
                            <CardPreview
                                cardId="bolt"
                                cardName="Lightning Bolt"
                            >
                                <div>face</div>
                            </CardPreview>
                        </div>
                    </div>
                </div>
            );
            return render(
                <GameContext value={GAME_CTX}>
                    {inTrigger ? (
                        <div data-slot="context-menu-trigger">{preview}</div>
                    ) : (
                        preview
                    )}
                </GameContext>
            );
        }

        it("opens the preview from a right-click that targets the flattening wrapper (ancestor of the container)", () => {
            const { container } = renderInTilt();
            const tiltRoot = container.querySelector(
                "[data-card-tilt-root]"
            ) as HTMLElement;
            const flatWrapper = container.querySelector(
                ".overflow-hidden"
            ) as HTMLElement;

            // The event targets the flattening wrapper — NOT inside the
            // CardPreview container — exactly as the real flattened board does.
            act(() => {
                fireEvent.pointerDown(flatWrapper, { button: 2 });
            });
            release();
            expect(anchored()).toBeTruthy();

            // The tilt root (not the container) is the "inside" boundary: a
            // second right-click on the wrapper toggles it CLOSED instead of the
            // outside-click listener racing it closed-then-reopened.
            act(() => {
                fireEvent.pointerDown(flatWrapper, { button: 2 });
            });
            release();
            expect(anchored()).toBeNull();

            // A pointerdown genuinely OUTSIDE the tilt root still closes it.
            act(() => {
                fireEvent.pointerDown(tiltRoot, { button: 2 });
            });
            release();
            expect(anchored()).toBeTruthy();
            act(() => {
                fireEvent.pointerDown(document.body);
            });
            expect(anchored()).toBeNull();
        });

        it("opens the preview from a right-click even inside a context-menu trigger (ability card)", () => {
            const { container } = renderInTilt(true);
            const flatWrapper = container.querySelector(
                ".overflow-hidden"
            ) as HTMLElement;

            act(() => {
                fireEvent.pointerDown(flatWrapper, { button: 2 });
            });
            release();
            // Right-click is reserved for the preview even on an ability card:
            // the ability ContextMenu opens on LEFT click (a synthesized,
            // untrusted `contextmenu`), so the real right-press no longer
            // collides with it. See ui/context-menu.tsx.
            expect(anchored()).toBeTruthy();
        });
    });
});
