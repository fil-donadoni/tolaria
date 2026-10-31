// Frontend wiring for the FORETELL special action on a hand card (CR 116.2h /
// 702.143a, issue #2096).
//
// Foretell is not a cast: it reaches the server through its own
// `foretellCard` mutation, offered from the projection's `canForetell`. A card
// that can be both cast and foretold routes through the menu that names each;
// a card that can ONLY be foretold takes the foretell on a plain click. Driven
// through the REAL projection, the REAL hand card and the REAL menu, asserting
// on what the mutations receive.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    within,
} from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

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

const foretellCard = vi.fn().mockResolvedValue(undefined);
const announceCast = vi.fn();
const other = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "foretellCard"
            ? foretellCard
            : ref._name === "announceCast"
              ? announceCast
              : other,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
            activateAbility: { _name: "activateAbility" },
            activateManaAbility: { _name: "activateManaAbility" },
            plotCard: { _name: "plotCard" },
            foretellCard: { _name: "foretellCard" },
        },
    },
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BoardHandCard from "../board-hand-card";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";

/** `me` holds `cardId` in their own precombat main with priority, an empty
 *  stack and `islands` Islands; projected through the REAL wire reducer. */
function projected(cardId: string, islands: number) {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(cardId, {
                        id: "omen",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: islands }, (_, i) =>
                    makeInstance(getCardByName("Island").id, {
                        id: `land-${i}`,
                        controllerId: "me",
                        ownerId: "me",
                    })
                ),
            }),
            makePlayer("them"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const view = projectPublicState(state, 1, "me") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    return {
        card: view.players[0].hand[0] as unknown as CardInstance,
        allPlayers: view.players,
        activePlayerId: view.activePlayerId,
    };
}

function renderCard(p: ReturnType<typeof projected>) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: p.activePlayerId,
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: p.allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <BoardHandCard card={p.card} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const el = () =>
    screen.getByTestId("card-image").closest("[data-board-hand-card]")!;

// Behold the Multiverse — {3}{U} instant, Foretell {1}{U}.
const BEHOLD = getCardByName("Behold the Multiverse").id;

beforeEach(() => {
    foretellCard.mockClear();
    announceCast.mockClear();
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("the foretell special action on a hand card (CR 702.143a)", () => {
    it("a castable AND foretellable card opens a menu naming both; Foretell sends foretellCard", () => {
        const p = projected(BEHOLD, 4);
        expect(p.card.canForetell).toBe(true);
        expect(p.card.legalActions).toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        const items = within(document.body).getAllByRole("menuitem");
        expect(items.map((i) => i.textContent)).toEqual(["Cast", "Foretell"]);
        expect(foretellCard).not.toHaveBeenCalled();

        fireEvent.click(items[1]);
        expect(foretellCard).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "omen",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a card that can ONLY be foretold takes the foretell on a plain click", () => {
        // Two Islands: {2} for the foretell, not the {3}{U} cast.
        const p = projected(BEHOLD, 2);
        expect(p.card.canForetell).toBe(true);
        expect(p.card.legalActions ?? []).not.toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        expect(within(document.body).queryAllByRole("menuitem")).toEqual([]);
        expect(foretellCard).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "omen",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("offers no Foretell entry when foretelling is not legal", () => {
        // One Island: {2} is not payable.
        const p = projected(BEHOLD, 1);
        expect(p.card.canForetell).toBeUndefined();
        renderCard(p);
        fireEvent.click(el());
        expect(within(document.body).queryAllByRole("menuitem")).toEqual([]);
        expect(foretellCard).not.toHaveBeenCalled();
    });
});
