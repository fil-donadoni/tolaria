// Outside-the-game plays (CR 400.11b — "You may play a card you own from
// outside the game this turn"). The pile renders only when the projection
// carries `outsideGamePlayable` (the owner's view, while the permission is
// live); a nonland card gets Cast (announceCast), a land gets Play (playCard),
// both gated on the projected `legalActions`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Player, CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

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
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => {
    const defFor = (id: string) =>
        id.includes("land")
            ? { name: "Forest", types: ["Land"] }
            : { name: "Grizzly Bears", types: ["Creature"] };
    return {
        getInstanceManaCost: (c: ManaCostSource) =>
            mockInstanceManaCost(c, (id: string) => defFor(id)),
        getDefinition: (id: string) => defFor(id),
        tryGetDefinition: (id: string) => defFor(id),
    };
});
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));

import PlayerOutsideGamePlays from "../player-outside-game-plays";

function poolCard(
    id: string,
    defId: string,
    types: string[],
    legalActions: CardInstance["legalActions"]
): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId: "me",
        ownerId: "me",
        zone: "exile",
        isTapped: false,
        types,
        legalActions,
    } as CardInstance;
}

function makePlayer(outsideGamePlayable?: CardInstance[]): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: {},
        ...(outsideGamePlayable ? { outsideGamePlayable } : {}),
    };
}

function renderPlays(player: Player) {
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
        allPlayers: [player],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    <PlayerOutsideGamePlays
                        player={player}
                        open
                        onOpenChange={() => {}}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("PlayerOutsideGamePlays (CR 400.11b)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("renders nothing without the permission (no outsideGamePlayable)", () => {
        renderPlays(makePlayer());
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    });

    it("casts a nonland pool card through announceCast", () => {
        renderPlays(
            makePlayer([
                poolCard("sb-bears", "bears-def", ["Creature"], ["cast"]),
            ])
        );
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "sb-bears",
        });
    });

    it("plays a pool land through playCard", () => {
        renderPlays(
            makePlayer([
                poolCard("sb-forest", "forest-land-def", ["Land"], ["play"]),
            ])
        );
        fireEvent.click(screen.getByRole("button", { name: "Play" }));
        expect(playCard).toHaveBeenCalledTimes(1);
        expect(playCard.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "sb-forest",
        });
    });

    it("disables the action when the projection carries no legal action", () => {
        renderPlays(
            makePlayer([poolCard("sb-bears", "bears-def", ["Creature"], [])])
        );
        const button = screen.getByRole("button", { name: "Cast" });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
        expect(announceCast).not.toHaveBeenCalled();
    });
});
