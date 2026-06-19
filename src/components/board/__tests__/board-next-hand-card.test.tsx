// Drag-commit parity (seam 3, PRD #249, issue #254). Click and drag-to-cast must
// flow through ONE shared commit pipeline (useHandCardCommit), so a committed
// drag dispatches the SAME mutation with the SAME arguments as a click, and a
// sub-threshold release dispatches nothing. These tests render the interactive
// spatial-board hand card, capture the dispatched mutation via a mocked
// useMutation, and compare drag vs click at the UI layer.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { COMMIT_LIFT_PX } from "~/hooks/useDragToCommit";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

// A no-op buffer so the hand card's unconditional `usePendingChoiceBuffer()`
// has a provider in these drag/cast tests (no choice is active here).
const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    isPending: false,
    lastError: null,
    dismissError: vi.fn(),
};

// Capture mutation dispatches. useMutation(api.game.playCard / announceCast)
// returns one of these spies keyed by the function reference's marker.
const playCard = vi.fn();
const announceCast = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
        },
    },
}));

// Controllable card definition: default = vanilla (no X, no modes) so the simple
// parity path runs without a prompt or picker. Individual tests override.
let cardDef: { name: string; manaCost?: { X?: string }; modes?: unknown[] } = {
    name: "Test Card",
};
vi.mock("@convex/cards", () => ({
    getCardById: () => cardDef,
}));

// Inert visuals / tilt / picker so the test sees only the gesture + dispatch.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// Real ModePicker uses variant="portal" → renders outside the card subtree.
// Mirror that with createPortal so the picker click is NOT inside the card's
// onClickCapture path (which would otherwise be swallowed after a drag).
vi.mock("../../cards/mode-picker", async () => {
    const { createPortal } = await import("react-dom");
    return {
        default: ({ onSelect }: { onSelect: (id: string) => void }) =>
            createPortal(
                <button
                    data-testid="mode-pick"
                    onClick={() => onSelect("mode-1")}
                >
                    pick
                </button>,
                document.body
            ),
    };
});

import BoardNextHandCard from "../board-next-hand-card";

function makeCard(
    id: string,
    legalActions: CardInstance["legalActions"]
): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
        legalActions,
    };
}

function renderCard(card: CardInstance) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardNextHandCard card={card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function el() {
    return screen.getByTestId("card-image").closest("[data-board-hand-card]")!;
}

/** Simulate a drag that lifts the card UP by `lift` px (negative dy) and
 *  releases. past COMMIT_LIFT_PX commits (#271/#294 fix 3); below returns to hand. Mirrors the
 *  real pointer sequence: down → move (crosses drag-start) → up. */
function drag(lift: number) {
    const target = el();
    fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 400 });
    fireEvent.pointerMove(target, { clientX: 100, clientY: 400 - lift });
    fireEvent.pointerUp(target, { clientX: 100, clientY: 400 - lift });
}

beforeEach(() => {
    playCard.mockClear();
    announceCast.mockClear();
    cardDef = { name: "Test Card" };
    cleanup();
});

// jsdom elements lack pointer-capture; stub so setPointerCapture is a no-op.
beforeEach(() => {
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("BoardNextHandCard drag-commit parity (seam 3, #254)", () => {
    it("a committed land drag dispatches the SAME playCard args as a click", () => {
        const card = makeCard("land1", ["play"]);

        renderCard(card);
        fireEvent.click(el());
        const clickArgs = playCard.mock.calls[0][0];

        playCard.mockClear();
        cleanup();

        renderCard(card);
        drag(120); // well past the commit line
        const dragArgs = playCard.mock.calls[0][0];

        expect(announceCast).not.toHaveBeenCalled();
        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "land1",
        });
    });

    it("a committed spell drag dispatches the SAME announceCast args as a click", () => {
        const card = makeCard("spell1", ["cast"]);

        renderCard(card);
        fireEvent.click(el());
        const clickArgs = announceCast.mock.calls[0][0];

        announceCast.mockClear();
        cleanup();

        renderCard(card);
        drag(120);
        const dragArgs = announceCast.mock.calls[0][0];

        expect(playCard).not.toHaveBeenCalled();
        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "spell1",
        });
    });

    it("a sub-threshold release dispatches nothing (returns to hand)", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        drag(20); // below the commit line
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a committed drag does NOT also fire the trailing click (single dispatch)", () => {
        const card = makeCard("land1", ["play"]);
        renderCard(card);
        // Full drag THEN the browser's synthetic click on the same element.
        drag(120);
        fireEvent.click(el());
        expect(playCard).toHaveBeenCalledTimes(1);
    });

    it("click still plays/casts a card exactly as before", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "spell1",
        });
    });

    it("dragging the X-prompt path passes the same chosen X for click and drag", () => {
        cardDef = { name: "X Spell", manaCost: { X: "X" } };
        const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("3");
        const card = makeCard("xspell", ["cast"]);

        renderCard(card);
        fireEvent.click(el());
        const clickArgs = announceCast.mock.calls[0][0];

        announceCast.mockClear();
        cleanup();

        renderCard(card);
        drag(120);
        const dragArgs = announceCast.mock.calls[0][0];

        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({ chosenX: 3 });
        promptSpy.mockRestore();
    });

    it("a modal-spell drag opens the SAME mode picker as a click, dispatching the chosen mode", () => {
        cardDef = { name: "Modal Spell", modes: [{ id: "mode-1" }] };
        const card = makeCard("modal", ["cast"]);

        // Click → picker opens → choosing a mode dispatches with chosenModeId.
        renderCard(card);
        fireEvent.click(el());
        expect(announceCast).not.toHaveBeenCalled(); // deferred to mode pick
        fireEvent.click(screen.getByTestId("mode-pick"));
        const clickArgs = announceCast.mock.calls[0][0];

        announceCast.mockClear();
        cleanup();

        // Drag past the line → same picker → same dispatch shape.
        renderCard(card);
        drag(120);
        expect(announceCast).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId("mode-pick"));
        const dragArgs = announceCast.mock.calls[0][0];

        expect(dragArgs).toEqual(clickArgs);
        expect(dragArgs).toMatchObject({
            cardInstanceId: "modal",
            chosenModeId: "mode-1",
        });
    });

    it("a card with no legal play/cast action is inert (drag commits nothing)", () => {
        const card = makeCard("inert", []);
        renderCard(card);
        drag(120);
        fireEvent.click(el());
        expect(playCard).not.toHaveBeenCalled();
        expect(announceCast).not.toHaveBeenCalled();
    });
});

describe("BoardNextHandCard commit threshold (#271 fix 3, #294 fix 3)", () => {
    it("commits a modest upward flick just past the lowered threshold", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        drag(COMMIT_LIFT_PX + 6); // just past the (lowered) commit line
        expect(announceCast).toHaveBeenCalledTimes(1);
    });

    it("does NOT commit an accidental small nudge below the threshold", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        drag(COMMIT_LIFT_PX - 6); // past drag-start (6px) but below commit line
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });
});

describe("BoardNextHandCard drag is up-only / gated (#294 fix 2-3)", () => {
    it("pins downward drag to 0 — the card never floats below its slot", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        const target = el() as HTMLElement;
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        // Drag DOWN 120px and sideways 40px.
        fireEvent.pointerMove(target, { clientX: 140, clientY: 520 });
        const m = target.style.transform.match(
            /translate\(([^,]+),\s*(-?\d+(?:\.\d+)?)px\)/
        );
        expect(m).toBeTruthy();
        // Horizontal tracks the pointer (reorder), vertical is pinned to 0.
        expect(Number(m![2])).toBe(0);
        fireEvent.pointerUp(target, { clientX: 140, clientY: 520 });
    });

    it("an unplayable card gets no lift and never arms", () => {
        const card = makeCard("dead1", []); // no legal play/cast
        renderCard(card);
        const target = el() as HTMLElement;
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, { clientX: 100, clientY: 400 - 200 });
        const m = target.style.transform?.match(
            /translate\([^,]+,\s*(-?\d+(?:\.\d+)?)px\)/
        );
        // No vertical lift even when yanked far up.
        if (m) expect(Number(m![1])).toBe(0);
        expect(target.getAttribute("data-drag-armed")).toBeNull();
        fireEvent.pointerUp(target, { clientX: 100, clientY: 200 });
        expect(announceCast).not.toHaveBeenCalled();
        expect(playCard).not.toHaveBeenCalled();
    });
});

describe("BoardNextHandCard hover-zoom preview (#271 fix 1)", () => {
    it("mounts the CardImage (hover-zoom vehicle) when idle", () => {
        renderCard(makeCard("spell1", ["cast"]));
        // CardImage owns CardPreview; its presence is the hover vehicle, same
        // as the battlefield card.
        expect(screen.getByTestId("card-image")).toBeTruthy();
    });

    it("keeps the CardImage mounted DURING a drag (preview never torn down)", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        const target = el();
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        fireEvent.pointerMove(target, { clientX: 100, clientY: 350 });
        // Mid-drag the same hover vehicle is still mounted (not swapped for a
        // plain image), so hover keeps working after the gesture ends.
        expect(screen.getByTestId("card-image")).toBeTruthy();
        fireEvent.pointerUp(target, { clientX: 100, clientY: 350 });
    });
});

describe("BoardNextHandCard drag containment (#271 fix 4)", () => {
    it("clamps the rendered upward lift so the card stays visible", () => {
        const card = makeCard("spell1", ["cast"]);
        renderCard(card);
        const target = el() as HTMLElement;
        fireEvent.pointerDown(target, {
            button: 0,
            clientX: 100,
            clientY: 400,
        });
        // Yank the card 400px up — far past the band above the hand.
        fireEvent.pointerMove(target, { clientX: 100, clientY: 0 });
        const transform = target.style.transform;
        // Pull out the translate Y (px) from `translate(0px, -Npx) scale(...)`.
        const match = transform.match(/translate\([^,]+,\s*(-?\d+)px\)/);
        expect(match).toBeTruthy();
        const renderedLiftPx = Math.abs(Number(match![1]));
        // Clamped well below the raw 400px so it can't escape into the clipped
        // band above the hand (MAX_LIFT_PX = COMMIT_LIFT_PX + 18).
        expect(renderedLiftPx).toBeLessThanOrEqual(COMMIT_LIFT_PX + 18);
        // Still armed (the RAW lift past the commit line arms the commit
        // regardless of the visual clamp).
        expect(target.getAttribute("data-drag-armed")).toBe("true");
        fireEvent.pointerUp(target, { clientX: 100, clientY: 0 });
    });
});

// ADR 0026 / PRD #338 (slice 3) — the eye icon renders per-card ONLY on the
// viewer's own hand cards that an opponent legitimately knows (derived
// `seenByOpponent` flag), never generically on the whole hand.
describe("BoardNextHandCard seenByOpponent eye icon (ADR 0026)", () => {
    it("renders the eye badge when the card is seenByOpponent", () => {
        const card = { ...makeCard("seen", ["cast"]), seenByOpponent: true };
        renderCard(card);
        expect(
            document.querySelector("[data-seen-by-opponent]")
        ).not.toBeNull();
    });

    it("does NOT render the eye badge when the card is not seenByOpponent", () => {
        const card = makeCard("secret", ["cast"]);
        renderCard(card);
        expect(document.querySelector("[data-seen-by-opponent]")).toBeNull();
    });
});
