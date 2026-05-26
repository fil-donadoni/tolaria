import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import PlayerLibrary from "../player-library";

// Capture the props that CardsPile receives so we can assert shape.
const cardsPileSpy = vi.fn();
vi.mock("../cards-pile", () => ({
    default: (props: { cards: CardInstance[]; isFaceDown?: boolean }) => {
        cardsPileSpy(props);
        return <div data-testid="cards-pile" data-count={props.cards.length} />;
    },
}));

// PlayerLibrary calls useMutation — stub with a no-op.
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
}));

function makePlayer(
    library: Player["library"],
    overrides: Partial<Player> = {}
): Player {
    return {
        id: "me",
        name: "me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library,
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
        zone: "library",
        isTapped: false,
    };
}

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    dismissError: () => {},
};

function renderWithContext(ui: React.ReactElement, playerId = "me") {
    const value = {
        gameId: "game-id" as never,
        playerId,
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
                {ui}
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("PlayerLibrary", () => {
    it("accepts CardInstance[] (full state) and forwards them to CardsPile", () => {
        cardsPileSpy.mockClear();
        const player = makePlayer([makeCard("l1"), makeCard("l2")]);
        renderWithContext(<PlayerLibrary player={player} />);
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.cards).toHaveLength(2);
        expect(pileProps.isFaceDown).toBe(true);
    });

    it("accepts { count } (public state) and generates placeholders without crashing", () => {
        // Regression: getPublicState returns library as { count }. PlayerLibrary
        // previously called player.library.length on an object → TypeError in CardsPile.
        cardsPileSpy.mockClear();
        const player = makePlayer({ count: 7 });
        renderWithContext(<PlayerLibrary player={player} />);
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.cards).toHaveLength(7);
        expect(pileProps.isFaceDown).toBe(true);
    });

    it("renders an empty pile when { count: 0 }", () => {
        cardsPileSpy.mockClear();
        const player = makePlayer({ count: 0 });
        renderWithContext(<PlayerLibrary player={player} />);
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.cards).toHaveLength(0);
    });
});
