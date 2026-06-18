// Drag-commit parity (seam 3, PRD #249, issue #254). Click and drag-to-cast must
// flow through ONE shared commit pipeline (useHandCardCommit), so a committed
// drag dispatches the SAME mutation with the SAME arguments as a click, and a
// sub-threshold release dispatches nothing. These tests render the interactive
// spatial-board hand card, capture the dispatched mutation via a mocked
// useMutation, and compare drag vs click at the UI layer.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

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
            <BoardNextHandCard card={card} />
        </GameContext>
    );
}

function el() {
    return screen.getByTestId("card-image").closest("[data-board-hand-card]")!;
}

/** Simulate a drag that lifts the card UP by `lift` px (negative dy) and
 *  releases. >= 64px commits; below returns to hand. Mirrors the real pointer
 *  sequence: down → move (crosses drag-start) → up. */
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
        drag(120); // well past the 64px commit line
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
        drag(20); // below the 64px commit line
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
