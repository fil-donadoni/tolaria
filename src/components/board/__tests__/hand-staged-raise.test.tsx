// A card STAGED by a touch tap (#1767) must paint ABOVE its neighbours. Both
// hand layouts overlap their cards — the portrait row by 26px of a 76px card
// (~34% of every card covered by the next), the spatial fan likewise — so
// without the raise the second tap that confirms the play lands on the
// NEIGHBOUR: it cancels the stage and stages the neighbour instead, on exactly
// the layout the touch flow exists for.
//
// Driven through the REAL BoardHandCard inside the REAL hand components: the
// two layouts raise the card by DIFFERENT mechanisms (the portrait row by the
// card's own inner z-index over plain flow siblings; the spatial fan by the
// SLOT, because a slot's DOM node never reorders and an inner z-index cannot
// lift it over later-painted siblings), and only the composed tree proves each
// one actually reaches the DOM.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { LIFTED_CARD_Z } from "~/lib/board-motion";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { fanLayout } from "~/lib/board-layout";

const ZONE_W = 1000;
const ZONE_H = 300;
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: ZONE_W, height: ZONE_H },
    }),
}));

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
            activateAbility: { _name: "activateAbility" },
        },
    },
}));
vi.mock("@convex/cards", () => ({
    getDefinition: () => ({ name: "Test Card" }),
    tryGetDefinition: () => ({ name: "Test Card" }),
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BoardHand from "../board-hand";
import BoardHandPortrait from "../board-hand-portrait";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    isPending: false,
    lastError: null,
    reportError: vi.fn(),
    dismissError: vi.fn(),
};

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
        legalActions: ["cast"],
    };
}

function makePlayer(ids: string[]): Player {
    return {
        id: "me",
        name: "Me",
        life: 20,
        hand: ids.map(makeCard),
        battlefield: [],
        graveyard: [],
        exile: [],
        library: { count: 0 },
    } as unknown as Player;
}

function withProviders(node: React.ReactNode) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                {node}
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

function handLayout(count: number, width: number, height: number) {
    return fanLayout({ count, width, baseY: height * 0.6 });
}

function cardRoot(id: string): HTMLElement {
    return document.querySelector<HTMLElement>(
        `[data-board-hand-card="${id}"]`
    )!;
}
function slot(id: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-card-slot="${id}"]`)!;
}

/** One touch tap: the pointerdown that types the gesture, its release, and the
 *  click it produces (below the drag-start deadzone, so it stays a click). */
function touchTap(target: Element) {
    fireEvent.pointerDown(target, {
        button: 0,
        pointerType: "touch",
        clientX: 100,
        clientY: 400,
    });
    fireEvent.pointerUp(target, {
        button: 0,
        pointerType: "touch",
        clientX: 100,
        clientY: 400,
    });
    fireEvent.click(target);
}

beforeEach(() => {
    playCard.mockClear();
    announceCast.mockClear();
    cleanup();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("staged hand card is raised above its neighbours (#1767 review)", () => {
    it("portrait: the staged card carries the lifted stack level, its neighbours do not", () => {
        render(
            withProviders(
                <BoardHandPortrait
                    player={makePlayer(["a", "b", "c"])}
                    interactive
                />
            )
        );
        // Nothing is raised while the hand rests.
        expect(cardRoot("b").style.zIndex).toBe("");

        touchTap(cardRoot("b"));

        expect(cardRoot("b").getAttribute("data-tap-staged")).toBe("true");
        expect(cardRoot("b").style.zIndex).toBe(String(LIFTED_CARD_Z));
        // The overlapping neighbour that would otherwise swallow the confirming
        // second tap stays below.
        expect(cardRoot("c").style.zIndex).toBe("");
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("portrait: the raise is dropped when the stage is cancelled", () => {
        render(
            withProviders(
                <BoardHandPortrait
                    player={makePlayer(["a", "b", "c"])}
                    interactive
                />
            )
        );
        touchTap(cardRoot("b"));
        expect(cardRoot("b").style.zIndex).toBe(String(LIFTED_CARD_Z));
        // Tap away → the stage (and its raise) go.
        fireEvent.pointerDown(document.body, { pointerType: "touch" });
        expect(cardRoot("b").getAttribute("data-tap-staged")).toBeNull();
        expect(cardRoot("b").style.zIndex).toBe("");
    });

    it("spatial: staging a card raises its whole SLOT above the sibling slots", () => {
        render(
            withProviders(
                <BoardHand
                    player={makePlayer(["a", "b", "c"])}
                    interactive
                    layout={handLayout}
                />
            )
        );
        expect(slot("b").style.zIndex).toBe("");

        touchTap(cardRoot("b"));

        expect(cardRoot("b").getAttribute("data-tap-staged")).toBe("true");
        // The SLOT is what must rise here — an inner z-index cannot lift a slot
        // whose DOM node never reorders over its later-painted siblings.
        expect(slot("b").style.zIndex).toBe(String(LIFTED_CARD_Z));
        expect(slot("c").style.zIndex).toBe("");
    });

    it("spatial: the slot raise is dropped when the stage is cancelled", () => {
        render(
            withProviders(
                <BoardHand
                    player={makePlayer(["a", "b", "c"])}
                    interactive
                    layout={handLayout}
                />
            )
        );
        touchTap(cardRoot("b"));
        expect(slot("b").style.zIndex).toBe(String(LIFTED_CARD_Z));
        fireEvent.pointerDown(document.body, { pointerType: "touch" });
        expect(cardRoot("b").getAttribute("data-tap-staged")).toBeNull();
        expect(slot("b").style.zIndex).toBe("");
    });

    it("spatial: staging a different card moves the raise (never two raised slots)", () => {
        render(
            withProviders(
                <BoardHand
                    player={makePlayer(["a", "b", "c"])}
                    interactive
                    layout={handLayout}
                />
            )
        );
        touchTap(cardRoot("b"));
        expect(slot("b").style.zIndex).toBe(String(LIFTED_CARD_Z));
        // A tap on another card cancels the first stage (tap-away) and stages it.
        touchTap(cardRoot("c"));
        expect(slot("b").style.zIndex).toBe("");
        expect(slot("c").style.zIndex).toBe(String(LIFTED_CARD_Z));
        expect(announceCast).not.toHaveBeenCalled();
    });
});
