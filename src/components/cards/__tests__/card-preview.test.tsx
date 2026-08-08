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
import { makeManualGameContext } from "~/lib/manual-game-context";
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
    engineTurn: 1,
    stackCount: 0,
    stackItems: [],
    allPlayers: [],
    showAllCards: false,
    debugAllActions: false,
    onSwitchGame: () => {},
};

// The REAL seam Manual Mode owns (issue #2346) — built through
// `makeManualGameContext`, exactly as `manual-board-view.tsx` builds the
// value it hands to `<GameContext value={...}>`, so this test exercises the
// actual wiring rather than a hand-rolled stand-in that could drift from it.
const MANUAL_GAME_CTX = makeManualGameContext({
    gameId: "g1" as Id<"games">,
    viewerId: "p1",
    state: { players: [], turn: 1, activePlayerId: "p1" },
    allPlayers: [],
    onSwitchGame: () => {},
});

function renderOnBoard(children: ReactNode = <div>face</div>) {
    return render(
        <GameContext value={GAME_CTX}>
            <CardPreview cardId="bolt" cardName="Lightning Bolt">
                {children}
            </CardPreview>
        </GameContext>
    );
}

function renderOnManualBoard(children: ReactNode = <div>face</div>) {
    return render(
        <GameContext value={MANUAL_GAME_CTX}>
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

    it("keeps the dock open while the pointer is on the panel, and the panel takes clicks (QA)", () => {
        // The dock panel used to be `pointer-events-none`, so its Live text /
        // Printed card toggle was unreachable on desktop — and leaving the card
        // closed the dock before the pointer could get there. The panel now
        // takes pointer events and holds itself open while hovered.
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;

        hoverEnter(root);
        dwellPast();
        const panel = document.querySelector(
            "[data-card-preview-dock] .card-preview-dock"
        ) as HTMLElement;
        expect(panel).toBeTruthy();
        expect(panel.className).toContain("pointer-events-auto");

        // Pointer travels card → panel: the close grace is cancelled.
        hoverLeave(root);
        act(() => {
            fireEvent.pointerEnter(panel, { pointerType: "mouse" });
        });
        gracePast();
        expect(dock()).toBeTruthy();

        // Leaving the panel finally closes it.
        act(() => {
            fireEvent.pointerLeave(panel, { pointerType: "mouse" });
        });
        gracePast();
        expect(dock()).toBeNull();
    });

    it("a click inside the pinned preview does not dismiss it (QA)", () => {
        const { container } = renderOnBoard();
        const root = container.firstElementChild as HTMLElement;
        rightPress(root);
        release();
        const panel = anchored() as HTMLElement;
        expect(panel).toBeTruthy();
        expect(panel.className).toContain("pointer-events-auto");

        act(() => {
            fireEvent.pointerDown(panel, { button: 0 });
        });
        expect(anchored()).toBeTruthy();
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

    // Issue #2346 — a Manual card is a bare `card: { id }` with no hydrated
    // CardDefinition (ADR 0080), so the "live text" face has nothing to show:
    // no oracle text, no granted abilities, no effective P/T. In a Manual
    // Game the preview must open directly on the printed card image, on all
    // THREE surfaces, with no toggle to switch away from it. The flag comes
    // from the real `makeManualGameContext` seam, not a per-surface prop.
    describe("Manual Game — printed-image-only face, no toggle (issue #2346)", () => {
        it("hover dock opens on the printed image with no toggle", () => {
            const { container } = renderOnManualBoard();
            const root = container.firstElementChild as HTMLElement;

            hoverEnter(root);
            dwellPast();
            const d = dock() as HTMLElement;
            expect(d).toBeTruthy();

            const printedImg = document.querySelector(
                "[data-card-preview-dock] img"
            ) as HTMLImageElement;
            expect(printedImg).toBeTruthy();
            expect(printedImg.src).toContain("/grid/");
            expect(printedImg.src).toContain(".webp");
            // No Live text / Printed card toggle in a Manual Game.
            expect(
                document.querySelector(
                    "[data-card-preview-dock] [data-preview-mode]"
                )
            ).toBeNull();
        });

        it("the anchored pin opens on the printed image with no toggle", () => {
            const { container } = renderOnManualBoard();
            const root = container.firstElementChild as HTMLElement;

            rightPress(root);
            release();
            const panel = anchored() as HTMLElement;
            expect(panel).toBeTruthy();

            const printedImg = document.querySelector(
                "[data-card-preview-anchored] img"
            ) as HTMLImageElement;
            expect(printedImg).toBeTruthy();
            expect(printedImg.src).toContain("/grid/");
            expect(
                document.querySelector(
                    "[data-card-preview-anchored] [data-preview-mode]"
                )
            ).toBeNull();
        });

        it("the mobile long-press overlay opens on the printed image with no toggle", () => {
            const { container } = renderOnManualBoard();
            const root = container.firstElementChild as HTMLElement;

            act(() => {
                fireEvent.touchStart(root, {
                    touches: [{ clientX: 10, clientY: 10 }],
                });
                vi.advanceTimersByTime(400);
            });

            const overlay = document.querySelector(".fixed.inset-0");
            expect(overlay).toBeTruthy();
            const printedImg = overlay!.querySelector(
                "img"
            ) as HTMLImageElement;
            expect(printedImg).toBeTruthy();
            expect(printedImg.src).toContain("/grid/");
            expect(overlay!.querySelector("[data-preview-mode]")).toBeNull();
        });
    });

    // A GRE game (no `isManualGame` field on its context) must render exactly
    // as before — the toggle stays, on every surface. Companion assertion to
    // the Manual-only suite above: pins the "byte-identical" acceptance
    // criterion on the two surfaces the pre-existing dock test doesn't cover.
    describe("GRE game preview stays unchanged (issue #2346 regression guard)", () => {
        it("the anchored pin still shows the Live text / Printed card toggle", () => {
            const { container } = renderInLobby();
            const root = container.firstElementChild as HTMLElement;

            rightPress(root);
            release();
            expect(anchored()).toBeTruthy();
            expect(
                document.querySelector(
                    '[data-card-preview-anchored] [data-preview-mode="printed"]'
                )
            ).toBeTruthy();
        });

        it("the mobile long-press overlay still shows the toggle", () => {
            const { container } = renderOnBoard();
            const root = container.firstElementChild as HTMLElement;

            act(() => {
                fireEvent.touchStart(root, {
                    touches: [{ clientX: 10, clientY: 10 }],
                });
                vi.advanceTimersByTime(400);
            });

            const overlay = document.querySelector(".fixed.inset-0");
            expect(overlay).toBeTruthy();
            expect(
                overlay!.querySelector('[data-preview-mode="printed"]')
            ).toBeTruthy();
        });
    });

    // Portal ≠ React tree: all three preview surfaces are portal'd to
    // document.body but stay REACT descendants of the card instance, so their
    // events used to bubble into the card's own handlers — clicking the
    // `Printed card` toggle also tapped the card and synthesized the left-click
    // `contextmenu` that opens the activated-ability menu. The context menu
    // must fire from the CARD INSTANCE only, never from the preview area.
    describe("preview surfaces never drive the card's own interactions", () => {
        function renderWithCardHandlers() {
            const onClick = vi.fn();
            const onContextMenu = vi.fn();
            const onPointerDown = vi.fn();
            const utils = render(
                <GameContext value={GAME_CTX}>
                    {/* Mirrors the real nesting: the card's click/context-menu
                        affordances wrap CardPreview (ActivatableAbilityMenu's
                        ContextMenuTrigger, the hand card's cast onClick). */}
                    <div
                        data-slot="context-menu-trigger"
                        onClick={onClick}
                        onContextMenu={onContextMenu}
                        onPointerDown={onPointerDown}
                    >
                        <CardPreview cardId="bolt" cardName="Lightning Bolt">
                            <div>face</div>
                        </CardPreview>
                    </div>
                </GameContext>
            );
            return { ...utils, onClick, onContextMenu, onPointerDown };
        }

        it("a click on the dock's printed toggle does not reach the card", () => {
            const { container, onClick, onContextMenu, onPointerDown } =
                renderWithCardHandlers();
            const root = container.querySelector(
                "[data-slot=context-menu-trigger]"
            )!.firstElementChild as HTMLElement;

            hoverEnter(root);
            dwellPast();
            expect(dock()).toBeTruthy();

            const toggle = document.querySelector(
                '[data-card-preview-dock] [data-preview-mode="printed"]'
            ) as HTMLElement;
            act(() => {
                fireEvent.pointerDown(toggle, { button: 0 });
                toggle.click();
            });

            // The toggle still works…
            expect(
                document.querySelector(
                    '[data-card-preview-dock] img[alt*="(printed)"]'
                )
            ).toBeTruthy();
            // …and the card saw nothing.
            expect(onClick).not.toHaveBeenCalled();
            expect(onPointerDown).not.toHaveBeenCalled();
            expect(onContextMenu).not.toHaveBeenCalled();
        });

        it("a click on the pinned preview's printed toggle does not reach the card", () => {
            const { container, onClick, onContextMenu, onPointerDown } =
                renderWithCardHandlers();
            const root = container.querySelector(
                "[data-slot=context-menu-trigger]"
            )!.firstElementChild as HTMLElement;

            rightPress(root);
            release();
            onPointerDown.mockClear();
            expect(anchored()).toBeTruthy();

            const toggle = document.querySelector(
                '[data-card-preview-anchored] [data-preview-mode="printed"]'
            ) as HTMLElement;
            act(() => {
                fireEvent.pointerDown(toggle, { button: 0 });
                toggle.click();
            });

            expect(
                document.querySelector(
                    '[data-card-preview-anchored] img[alt*="(printed)"]'
                )
            ).toBeTruthy();
            expect(anchored()).toBeTruthy();
            expect(onClick).not.toHaveBeenCalled();
            expect(onPointerDown).not.toHaveBeenCalled();
            expect(onContextMenu).not.toHaveBeenCalled();
        });

        it("a right-click inside a preview surface does not reach the card", () => {
            const { container, onContextMenu } = renderWithCardHandlers();
            const root = container.querySelector(
                "[data-slot=context-menu-trigger]"
            )!.firstElementChild as HTMLElement;

            rightPress(root);
            release();
            const panel = anchored() as HTMLElement;
            act(() => {
                fireEvent.contextMenu(panel);
            });
            expect(onContextMenu).not.toHaveBeenCalled();
        });
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

    // Issue #1994 (PR #2279 review round 4): a TAPPED battlefield permanent
    // rotates its visual and sets `pointer-events: none` on an INNER layer
    // (`[data-tap-visual]`, `board-battlefield-card.tsx`) that sits between
    // the tilt root and CardPreview's own container — so a real touch
    // landing on the rotated art hit-tests to the tilt root (an ancestor of
    // this container, same reasoning as the right-press binding above), not
    // to this container itself. The mobile long-press gesture used to be
    // bound as plain React `onTouch*` props directly on the container, which
    // would never receive that touch. It now binds imperatively on the same
    // `[data-card-tilt-root]` ancestor.
    describe("tap inert layer — long-press binds on the tilt root (#1994 round 4)", () => {
        function renderTapped() {
            const preview = (
                <div data-card-tilt-root>
                    <div data-card-tilt>
                        <div data-tap-visual style={{ pointerEvents: "none" }}>
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
                </div>
            );
            return render(
                <GameContext value={GAME_CTX}>{preview}</GameContext>
            );
        }

        it("opens the mobile long-press overlay from a touch that targets the tilt root, not the inert container beneath it", () => {
            const { container } = renderTapped();
            const tiltRoot = container.querySelector(
                "[data-card-tilt-root]"
            ) as HTMLElement;

            act(() => {
                fireEvent.touchStart(tiltRoot, {
                    touches: [{ clientX: 10, clientY: 10 }],
                });
                vi.advanceTimersByTime(400);
            });

            const overlay = document.querySelector(".fixed.inset-0");
            expect(overlay).toBeTruthy();
        });

        it("suppresses the right-button path after a touch on the tilt root (sawTouchRef still set from the imperative binding)", () => {
            const { container } = renderTapped();
            const tiltRoot = container.querySelector(
                "[data-card-tilt-root]"
            ) as HTMLElement;

            act(() => {
                fireEvent.touchStart(tiltRoot, {
                    touches: [{ clientX: 10, clientY: 10 }],
                });
            });
            rightPress(tiltRoot);
            release();

            expect(anchored()).toBeNull();
        });
    });
});
