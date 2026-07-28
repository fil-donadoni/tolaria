// Slice #255 (PRD #249): the card piles (graveyard / library / exile) render on
// the spatial Board for both seats, reusing the existing pile components so
// their collapsed stack AND expanded reveal dialog come along unchanged. These
// tests assert external behavior: which piles are present per seat, that they
// carry their target-arrow anchors, and that clicking a non-empty pile opens
// the reveal (expanded form).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    cleanup,
    fireEvent,
    within,
} from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import BoardPiles from "../board-piles";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

// Pile components call useMutation; the card image components hit the card
// registry / image worker. Stub the data seams, keep the pile structure real.
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

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: async () => {},
    isPending: false,
    lastError: null,
    reportError: () => {},
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

function renderPiles(opponent: Player, me: Player) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [opponent, me],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    <BoardPiles orderedPlayers={[opponent, me]} />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("BoardPiles (slice #255)", () => {
    it("renders graveyard, library and exile for both seats", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp");
        const { container } = renderPiles(opp, me);

        expect(screen.getByTestId("piles-player")).toBeTruthy();
        expect(screen.getByTestId("piles-opponent")).toBeTruthy();

        // Anchors prove the real pile components (not placeholders) mounted for
        // each seat — these are what target arrows attach to.
        expect(
            container.querySelector('[data-arrow-anchor-graveyard="me"]')
        ).toBeTruthy();
        expect(
            container.querySelector('[data-arrow-anchor-exile="me"]')
        ).toBeTruthy();
        expect(
            container.querySelector('[data-arrow-anchor-graveyard="opp"]')
        ).toBeTruthy();
        expect(
            container.querySelector('[data-arrow-anchor-exile="opp"]')
        ).toBeTruthy();
    });

    it("renders opponent piles top-right and viewer piles bottom-right (#334 symmetry)", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp");
        renderPiles(opp, me);

        const opponentPiles = screen.getByTestId("piles-opponent");
        const playerPiles = screen.getByTestId("piles-player");

        // Opponent piles mirror the viewer's bottom-right column to the
        // top-right, so the board's right edge reads as one symmetric column.
        expect(opponentPiles.className).toContain("top-3");
        expect(opponentPiles.className).toContain("right-3");
        expect(opponentPiles.className).not.toContain("left-3");
        expect(opponentPiles.className).not.toContain("bottom-3");

        // Viewer piles stay bottom-right.
        expect(playerPiles.className).toContain("bottom-3");
        expect(playerPiles.className).toContain("right-3");

        // Both columns reverse their flex so graveyard/library/exile read in the
        // same order on each seat — the column is a true mirror.
        expect(opponentPiles.className).toContain("flex-row-reverse");
        expect(playerPiles.className).toContain("flex-row-reverse");
    });

    it("shows the collapsed (empty) form when zones are empty", () => {
        const me = makePlayer("me");
        const opp = makePlayer("opp");
        renderPiles(opp, me);

        const playerPiles = screen.getByTestId("piles-player");
        // Collapsed empty piles render their zone icon (labelled for a11y) in
        // place of the text label, not a reveal dialog.
        expect(within(playerPiles).getByLabelText("Graveyard")).toBeTruthy();
        expect(within(playerPiles).getByLabelText("Exile")).toBeTruthy();
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens the expanded reveal when a non-empty graveyard is clicked", () => {
        const me = makePlayer("me", {
            graveyard: [
                makeCard("g1", "graveyard"),
                makeCard("g2", "graveyard"),
            ],
        });
        const opp = makePlayer("opp");
        renderPiles(opp, me);

        // Collapsed: no reveal dialog yet.
        expect(screen.queryByRole("dialog")).toBeNull();

        // The collapsed pile is an OPEN-ONLY clickable stack of plain card
        // images — clicking it expands the reveal, it never fires a card action.
        const playerPiles = screen.getByTestId("piles-player");
        const stack = within(playerPiles).getAllByTestId("card-image")[0];
        fireEvent.click(stack);

        // Expanded reveal: dialog titled with the zone + count.
        const dialog = screen.getByRole("dialog");
        expect(
            within(dialog).getAllByText(/Graveyard \(2\)/).length
        ).toBeGreaterThan(0);
    });
});

// Flex's default `stretch` overrides each tile's aspect-derived height with the
// ROW's height, so one taller tile silently re-shaped every other one — and the
// art is `object-cover`, so re-shaping crops it (the companion rendered
// squashed next to a fanned emblem stack).
describe("pile rows never stretch their tiles (companion crop)", () => {
    it("pins both rows to the cross-axis start", () => {
        renderPiles(makePlayer("opp"), makePlayer("me"));
        for (const id of ["piles-player", "piles-opponent"]) {
            expect(screen.getByTestId(id).className).toContain("items-start");
        }
    });
});
