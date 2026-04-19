import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import PlayerHand from "../player-hand";

// Isolate PlayerHand from children that require Convex / router / dnd-kit setup.
vi.mock("../../cards/selectable-card", () => ({
    default: ({ cardInstance }: { cardInstance: CardInstance }) => (
        <div data-testid="selectable-card" data-card-id={cardInstance.id} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));

function makePlayer(
    id: string,
    hand: (CardInstance | null)[],
    overrides: Partial<Player> = {}
): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        deck: { id: "d", name: "d", cards: [], format: "standard" },
        hand,
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeCard(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
    };
}

function renderWithContext(
    ui: React.ReactElement,
    ctx: Partial<React.ContextType<typeof GameContext>> = {}
) {
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
        ...ctx,
    } as React.ContextType<typeof GameContext>;
    return render(<GameContext value={value}>{ui}</GameContext>);
}

describe("PlayerHand", () => {
    it("renders SelectableCard for each card in the player's own hand", () => {
        const me = makePlayer("me", [makeCard("c1"), makeCard("c2")]);
        renderWithContext(<PlayerHand player={me} />);
        expect(screen.getAllByTestId("selectable-card")).toHaveLength(2);
        expect(screen.queryAllByTestId("card-back")).toHaveLength(0);
    });

    it("renders CardBack for every null slot in the opponent's hand without crashing", () => {
        // Regression: getPublicState returns null for each opponent hand slot.
        // Previously PlayerHand called cardInstance.id unconditionally → TypeError.
        const opponent = makePlayer("opp", [null, null, null]);
        renderWithContext(<PlayerHand player={opponent} />);
        expect(screen.getAllByTestId("card-back")).toHaveLength(3);
        expect(screen.queryAllByTestId("selectable-card")).toHaveLength(0);
    });

    it("renders a mixed opponent hand when showAllCards is true (all null → all backs)", () => {
        const opponent = makePlayer("opp", [null, null]);
        renderWithContext(<PlayerHand player={opponent} />, {
            showAllCards: true,
            playerId: "me",
        });
        // Even with showAllCards, nulls stay as backs (nothing to display).
        expect(screen.getAllByTestId("card-back")).toHaveLength(2);
    });
});
