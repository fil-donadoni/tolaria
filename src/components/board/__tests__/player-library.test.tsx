import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PlayerLibrary from "../player-library";

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

// Capture the props that CardsPile receives so we can assert shape.
const cardsPileSpy = vi.fn();
vi.mock("../cards-pile", () => ({
    default: (props: {
        cards: CardInstance[];
        isFaceDown?: boolean;
        faceUpIds?: ReadonlySet<string>;
        layout?: "fan" | "grid";
        forceOpen?: boolean;
        selectedIds?: string[];
        eligibleIds?: ReadonlySet<string>;
        onCardClick?: (card: { id: string }) => void;
    }) => {
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

function renderWithContext(
    ui: React.ReactElement,
    playerId = "me",
    extra: {
        pendingChoices?: NonNullable<
            React.ContextType<typeof GameContext>
        >["pendingChoices"];
        buffer?: PendingChoiceBuffer;
    } = {}
) {
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
        pendingChoices: extra.pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={extra.buffer ?? noopBuffer}>
                <MinimizedChoiceContext value={noopMinimized}>
                    {ui}
                </MinimizedChoiceContext>
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

    it("marks a viewer-known library position face-up via faceUpIds (ADR 0026)", () => {
        // Public-state sparse library: index 0 is known to the viewer.
        cardsPileSpy.mockClear();
        const player = makePlayer({
            count: 3,
            known: [{ index: 0, card: makeCard("known-top") }],
        });
        renderWithContext(<PlayerLibrary player={player} />);
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.cards).toHaveLength(3);
        // The known card sits at the top; the rest are placeholders.
        expect(pileProps.cards[0].id).toBe("known-top");
        // Pile is hidden by default, but the known position is overridden.
        expect(pileProps.isFaceDown).toBe(true);
        expect(pileProps.faceUpIds.has("known-top")).toBe(true);
        expect(pileProps.faceUpIds.size).toBe(1);
    });

    it("exposes the search-library picker as a face-up grid with per-card selection", () => {
        // Regression: the fan layout overlapped library cards 50%, merging
        // every amber ring into one strip and leaving no card selectable.
        // While a `search-library` choice is active for the viewer, the picker
        // must be a non-overlapping grid, face-up, with buffered ids surfaced
        // as `selectedIds` and clicks routed to the buffer's toggle.
        cardsPileSpy.mockClear();
        const search = [makeCard("s1"), makeCard("s2"), makeCard("s3")];
        const player = makePlayer({ count: 3 }, {
            librarySearch: search,
        } as Partial<Player>);
        const toggle = vi.fn();
        const buffer: PendingChoiceBuffer = {
            ...noopBuffer,
            buffer: ["s2"],
            toggle,
        };
        renderWithContext(<PlayerLibrary player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "me",
                    playerId: "me",
                    kind: "search-library",
                    zone: "library",
                    count: 1,
                    prompt: "Search your library for a card.",
                },
            ],
            buffer,
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.cards).toHaveLength(3);
        expect(pileProps.isFaceDown).toBe(false);
        expect(pileProps.layout).toBe("grid");
        expect(pileProps.forceOpen).toBe(true);
        expect(pileProps.selectedIds).toEqual(["s2"]);
        // Unfiltered search (no candidateIds): every card stays selectable,
        // so no allow-list is forwarded (issue #933).
        expect(pileProps.eligibleIds).toBeUndefined();
        // Confirm control is hosted inside the (modal) dialog, not the
        // board-level prompt the dialog would otherwise cover.
        expect(pileProps.footer).toBeTruthy();
        // count=1 is already at max: picking a different card replaces it.
        pileProps.onCardClick({ id: "s1" });
        expect(toggle).toHaveBeenCalledWith("s1");
    });

    it("renders exactly the looked-at top N as a face-up grid for a look-top pick (Stock Up, #942)", () => {
        // Stock Up looks at the top five and keeps two. The projection exposes
        // ONLY those five as `libraryPeek` (never the whole library), and the
        // picker renders exactly them face-up with clicks routed to the buffer.
        cardsPileSpy.mockClear();
        const peek = [
            makeCard("t1"),
            makeCard("t2"),
            makeCard("t3"),
            makeCard("t4"),
            makeCard("t5"),
        ];
        const player = makePlayer({ count: 7 }, {
            libraryPeek: peek,
        } as Partial<Player>);
        const toggle = vi.fn();
        renderWithContext(<PlayerLibrary player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "stock-up",
                    playerId: "me",
                    kind: "look-top",
                    zone: "library",
                    candidateIds: ["t1", "t2", "t3", "t4", "t5"],
                    count: 2,
                    prompt: "Put up to two of these cards into your hand.",
                },
            ],
            buffer: { ...noopBuffer, toggle },
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        // Exactly the five looked-at cards — not the seven-card library.
        expect(pileProps.cards.map((c: CardInstance) => c.id)).toEqual([
            "t1",
            "t2",
            "t3",
            "t4",
            "t5",
        ]);
        expect(pileProps.isFaceDown).toBe(false);
        expect(pileProps.layout).toBe("grid");
        expect(pileProps.forceOpen).toBe(true);
        // Clicks route to the choice submission buffer.
        pileProps.onCardClick({ id: "t3" });
        expect(toggle).toHaveBeenCalledWith("t3");
    });

    it("renders the looked-at top N for a look-top pick with a range count (Preordain scry, #942)", () => {
        // Preordain scries the top two (put 0..2 on the bottom). The picker
        // renders exactly the two looked-at cards; a 0..2 range must not gate
        // any of them out of the grid.
        cardsPileSpy.mockClear();
        const peek = [makeCard("s1"), makeCard("s2")];
        const player = makePlayer({ count: 4 }, {
            libraryPeek: peek,
        } as Partial<Player>);
        const toggle = vi.fn();
        renderWithContext(<PlayerLibrary player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "preordain-scry",
                    playerId: "me",
                    kind: "look-top",
                    zone: "library",
                    candidateIds: ["s1", "s2"],
                    count: { min: 0, max: 2 },
                    prompt: "Scry 2 — choose any number to put on the bottom.",
                },
            ],
            buffer: { ...noopBuffer, toggle },
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.cards.map((c: CardInstance) => c.id)).toEqual([
            "s1",
            "s2",
        ]);
        expect(pileProps.isFaceDown).toBe(false);
        expect(pileProps.layout).toBe("grid");
        pileProps.onCardClick({ id: "s1" });
        expect(toggle).toHaveBeenCalledWith("s1");
    });

    it("gates clicks to the candidateIds allow-list on a filtered search (Transmute Artifact)", () => {
        // A filtered search ("an artifact card") carries `candidateIds`; only
        // those cards are pickable. Clicking an ineligible card is a no-op.
        cardsPileSpy.mockClear();
        const search = [makeCard("artifact-1"), makeCard("creature-2")];
        const player = makePlayer({ count: 2 }, {
            librarySearch: search,
        } as Partial<Player>);
        const toggle = vi.fn();
        renderWithContext(<PlayerLibrary player={player} />, "me", {
            pendingChoices: [
                {
                    stackItemId: "stk",
                    step: 0,
                    choiceId: "transmute-search",
                    playerId: "me",
                    kind: "search-library",
                    zone: "library",
                    count: { min: 0, max: 1 },
                    candidateIds: ["artifact-1"],
                    prompt: "Search your library for an artifact card.",
                },
            ],
            buffer: { ...noopBuffer, toggle },
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        pileProps.onCardClick({ id: "creature-2" }); // ineligible — no-op
        expect(toggle).not.toHaveBeenCalled();
        pileProps.onCardClick({ id: "artifact-1" }); // eligible
        expect(toggle).toHaveBeenCalledWith("artifact-1");
        // The allow-list itself must reach CardsPile so it can gate the ring
        // and click affordance per card, not just the click handler
        // (issue #933 — every card rendered the amber ring before this fix).
        expect(pileProps.eligibleIds).toBeInstanceOf(Set);
        expect(pileProps.eligibleIds.has("artifact-1")).toBe(true);
        expect(pileProps.eligibleIds.has("creature-2")).toBe(false);
    });
});
