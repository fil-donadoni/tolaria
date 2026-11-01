// Frontend wiring for the PLOT special action on a hand card (CR 116.2k /
// 702.170a, issue #3219).
//
// Plot is not a cast: it reaches the server through its own `plotCard`
// mutation, offered from the projection's `canPlot`. A card that can be both
// cast and plotted routes through the menu that names each; a card that can
// ONLY be plotted takes the plot on a plain click. Driven through the REAL
// projection, the REAL hand card and the REAL menu, asserting on what the
// mutations receive.
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

const plotCard = vi.fn().mockResolvedValue(undefined);
const announceCast = vi.fn();
const other = vi.fn().mockResolvedValue(undefined);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "plotCard"
            ? plotCard
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
import { pillageTheBog } from "@convex/cards/sets/otj/multicolor.cards";

/** `me` holds `cardId` in their own precombat main with priority, an empty
 *  stack and the given lands; projected through the REAL wire reducer. */
function projected(cardId: string, landNames: string[]) {
    const state = makeState({
        players: [
            makePlayer("me", {
                hand: [
                    makeInstance(cardId, {
                        id: "plotter",
                        controllerId: "me",
                        ownerId: "me",
                        zone: "hand",
                    }),
                ],
                battlefield: landNames.map((name, i) =>
                    makeInstance(getCardByName(name).id, {
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

beforeEach(() => {
    plotCard.mockClear();
    announceCast.mockClear();
    cleanup();
    resetPendingGameIntents();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.releasePointerCapture = vi.fn();
});

describe("the plot special action on a hand card (CR 702.170a)", () => {
    it("a castable AND plottable card opens a menu naming both; Plot sends plotCard", () => {
        // Pillage the Bog: {B}{G} to cast, {1}{B}{G} to plot — three lands
        // open both windows.
        const p = projected(pillageTheBog().id, ["Swamp", "Forest", "Swamp"]);
        expect(p.card.canPlot).toBe(true);
        expect(p.card.legalActions).toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        const items = within(document.body).getAllByRole("menuitem");
        expect(items.map((i) => i.textContent)).toEqual(["Cast", "Plot"]);
        expect(plotCard).not.toHaveBeenCalled();

        fireEvent.click(items[1]);
        expect(plotCard).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "plotter",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("a card that can ONLY be plotted takes the plot on a plain click", () => {
        // Djinn of Fool's Fall: {4}{U} to cast, {3}{U} to plot — four Islands
        // open only the plot.
        const p = projected(getCardByName("Djinn of Fool's Fall").id, [
            "Island",
            "Island",
            "Island",
            "Island",
        ]);
        expect(p.card.canPlot).toBe(true);
        expect(p.card.legalActions ?? []).not.toContain("cast");
        renderCard(p);
        fireEvent.click(el());

        expect(within(document.body).queryAllByRole("menuitem")).toEqual([]);
        expect(plotCard).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "plotter",
        });
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("offers no Plot entry when plotting is not legal", () => {
        // Two lands: the cast is legal, the plot cost is not payable — the
        // card keeps its direct click-to-cast, with no menu.
        const p = projected(pillageTheBog().id, ["Swamp", "Forest"]);
        expect(p.card.canPlot).toBeUndefined();
        renderCard(p);
        fireEvent.click(el());
        expect(within(document.body).queryAllByRole("menuitem")).toEqual([]);
        expect(plotCard).not.toHaveBeenCalled();
    });
});
