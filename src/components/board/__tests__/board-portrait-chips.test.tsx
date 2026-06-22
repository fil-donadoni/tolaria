// Portrait chips (#336): on a narrow viewport the pile columns and the always-on
// stack panel collapse to tappable chips (zone label + count). These tests
// assert the acceptance criteria as external behavior: each chip shows its
// count, and TAPPING a chip opens the EXISTING reveal / stack view (the same
// dialog / panel the desktop board uses) — nothing is rebuilt.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    cleanup,
    fireEvent,
    within,
} from "@testing-library/react";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import BoardPortraitChips from "../board-portrait-chips";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("../../cards/card-image", () => ({
    default: ({ card }: { card: CardInstance }) => (
        <div data-testid="card-image" data-card-id={card.id} />
    ),
}));
vi.mock("../../cards/card-back", () => ({
    default: () => <div data-testid="card-back" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: ({ cardInstance }: { cardInstance: CardInstance }) => (
        <div data-testid="selectable-card" data-card-id={cardInstance.id} />
    ),
}));
// The stack panel pulls in draggable / arrow-highlight wiring irrelevant here;
// stub it down to a marker that surfaces the item count it was handed.
vi.mock("../game-stack", () => ({
    default: ({ stack }: { stack: StackItem[] }) => (
        <div data-testid="stack-view" data-count={stack.length} />
    ),
}));

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    dismissError: () => {},
};

function makeCard(id: string, zone: CardInstance["zone"]): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone,
        isTapped: false,
    };
}

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function renderChips(
    opponent: Player,
    me: Player,
    stackItems: StackItem[] = []
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: stackItems.length,
        allPlayers: [opponent, me],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    <BoardPortraitChips
                        orderedPlayers={[opponent, me]}
                        stackItems={stackItems}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("BoardPortraitChips (#336)", () => {
    it("renders a pile-chip row for each seat with zone labels + counts", () => {
        const me = makePlayer("me", {
            graveyard: [makeCard("g1", "graveyard")],
            library: { count: 24 },
        });
        const opp = makePlayer("opp", { exile: [makeCard("x1", "exile")] });
        renderChips(opp, me);

        expect(screen.getByTestId("pile-chips-me")).toBeTruthy();
        expect(screen.getByTestId("pile-chips-opp")).toBeTruthy();

        // Counts come from the projected zones (graveyard/exile arrays;
        // library via libraryCount).
        const myChips = screen.getByTestId("pile-chips-me");
        expect(
            within(myChips).getByTestId("chip-graveyard-me").textContent
        ).toContain("1");
        expect(
            within(myChips).getByTestId("chip-library-me").textContent
        ).toContain("24");
        const oppChips = screen.getByTestId("pile-chips-opp");
        expect(
            within(oppChips).getByTestId("chip-exile-opp").textContent
        ).toContain("1");
    });

    it("no reveal dialog is open until a chip is tapped", () => {
        const me = makePlayer("me", {
            graveyard: [makeCard("g1", "graveyard")],
        });
        const opp = makePlayer("opp");
        renderChips(opp, me);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("tapping the graveyard chip opens the EXISTING graveyard reveal view", () => {
        const me = makePlayer("me", {
            graveyard: [
                makeCard("g1", "graveyard"),
                makeCard("g2", "graveyard"),
            ],
        });
        const opp = makePlayer("opp");
        renderChips(opp, me);

        fireEvent.click(screen.getByTestId("chip-graveyard-me"));

        const dialog = screen.getByRole("dialog");
        // The reveal dialog is the same one the desktop pile opens — titled with
        // the zone + count.
        expect(
            within(dialog).getAllByText(/Graveyard \(2\)/).length
        ).toBeGreaterThan(0);
    });

    it("tapping the opponent's library chip opens its reveal view", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp", {
            library: { count: 3 },
        });
        renderChips(opp, me);

        fireEvent.click(screen.getByTestId("chip-library-opp"));
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("renders the stack chip only when the stack is non-empty and toggles the EXISTING stack view", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp");

        // Empty stack: no chip.
        const { unmount } = renderChips(opp, me, []);
        expect(screen.queryByTestId("chip-stack")).toBeNull();
        expect(screen.queryByTestId("stack-view")).toBeNull();
        unmount();

        const stack = [
            { id: "s1", card: { id: "def-s1" } },
            { id: "s2", card: { id: "def-s2" } },
        ] as unknown as StackItem[];
        renderChips(opp, me, stack);

        // Chip present, stack view hidden until tapped.
        const chip = screen.getByTestId("chip-stack");
        expect(chip.textContent).toContain("2");
        expect(screen.queryByTestId("stack-view")).toBeNull();

        // Tap opens the existing stack panel with the same items.
        fireEvent.click(chip);
        const view = screen.getByTestId("stack-view");
        expect(view.getAttribute("data-count")).toBe("2");

        // Tap again closes it.
        fireEvent.click(screen.getByTestId("chip-stack"));
        expect(screen.queryByTestId("stack-view")).toBeNull();
    });
});
