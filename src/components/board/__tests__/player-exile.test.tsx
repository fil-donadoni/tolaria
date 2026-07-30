import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PlayerExile from "../player-exile";

// Mirrors the PlayerGraveyard choice tests: capture the props CardsPile
// receives so we can assert the exile choice wires forceOpen/grid/eligibleIds
// (QA: Dauthi Voidwalker's sacrifice pick was unreachable — a soft-lock).
const cardsPileSpy = vi.fn();
vi.mock("../cards-pile", () => ({
    default: (props: {
        cards: CardInstance[];
        layout?: "fan" | "grid";
        forceOpen?: boolean;
        selectedIds?: string[];
        eligibleIds?: ReadonlySet<string>;
        onCardClick?: (card: { id: string }) => void;
        title?: string;
    }) => {
        cardsPileSpy(props);
        return <div data-testid="cards-pile" data-count={props.cards.length} />;
    },
}));

const noopMinimized = {
    isMinimized: false,
    minimize: () => {},
    restore: () => {},
};

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

function makeCard(id: string, extra: Partial<CardInstance> = {}): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "opp",
        ownerId: "opp",
        zone: "exile",
        isTapped: false,
        ...extra,
    } as CardInstance;
}

function makePlayer(id: string, exile: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile,
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as unknown as Player;
}

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
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
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

const dauthiChoice = {
    stackItemId: "stk",
    step: 0,
    choiceId: "$picked",
    playerId: "me",
    kind: "choose-exile-card" as const,
    zone: "exile" as const,
    zoneOwnerId: "opp",
    count: 1,
    candidateIds: ["void-1"],
    prompt: "Choose an exiled card your opponent owns with a void counter on it.",
};

describe("PlayerExile — choose-exile-card choice (QA: Dauthi Voidwalker)", () => {
    it("the OPPONENT's pile becomes the selectable one (zoneOwnerId), gated to candidateIds", () => {
        cardsPileSpy.mockClear();
        const opp = makePlayer("opp", [
            makeCard("void-1"),
            makeCard("plain-2"),
        ]);
        const toggle = vi.fn();
        renderWithContext(<PlayerExile player={opp} />, "me", {
            pendingChoices: [dauthiChoice],
            buffer: { ...noopBuffer, toggle },
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.forceOpen).toBe(true);
        expect(pileProps.layout).toBe("grid");
        expect(pileProps.title).toBe(
            "Choose an exiled card your opponent owns with a void counter on it."
        );
        expect(pileProps.eligibleIds).toBeInstanceOf(Set);
        expect(pileProps.eligibleIds.has("void-1")).toBe(true);
        expect(pileProps.eligibleIds.has("plain-2")).toBe(false);
        pileProps.onCardClick({ id: "plain-2" }); // ineligible — no-op
        expect(toggle).not.toHaveBeenCalled();
        pileProps.onCardClick({ id: "void-1" }); // eligible
        expect(toggle).toHaveBeenCalledWith("void-1");
    });

    it("the chooser's OWN pile stays inert when the choice targets the opponent's exile", () => {
        cardsPileSpy.mockClear();
        const me = makePlayer("me", [makeCard("mine-1")]);
        renderWithContext(<PlayerExile player={me} />, "me", {
            pendingChoices: [dauthiChoice],
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        expect(pileProps.forceOpen).toBeFalsy();
        expect(pileProps.onCardClick).toBeUndefined();
        expect(pileProps.title).toBe("Exile");
    });

    it("a card pinned under a host permanent stays a legal pick while the choice owns the pile", () => {
        // Pinned cards (exiledByPermanentId) are normally de-duped from the
        // loose pile — but the choice's candidateIds, not the pin, decides
        // eligibility (a Banishing-Light-exiled card can still carry a void
        // counter? no — but the de-dup must never HIDE a legal pick).
        cardsPileSpy.mockClear();
        const opp = makePlayer("opp", [
            makeCard("void-1", { exiledByPermanentId: "bl-1" } as never),
            makeCard("plain-2"),
        ]);
        const { container } = renderWithContext(
            <PlayerExile player={opp} />,
            "me",
            { pendingChoices: [dauthiChoice] }
        );
        const pile = container.querySelector('[data-testid="cards-pile"]')!;
        expect(pile.getAttribute("data-count")).toBe("2");
    });

    it("max=1 replace semantics: clicking a second eligible card swaps the buffer", () => {
        cardsPileSpy.mockClear();
        const opp = makePlayer("opp", [makeCard("void-1"), makeCard("void-2")]);
        const toggle = vi.fn();
        const clear = vi.fn();
        renderWithContext(<PlayerExile player={opp} />, "me", {
            pendingChoices: [
                { ...dauthiChoice, candidateIds: ["void-1", "void-2"] },
            ],
            buffer: { ...noopBuffer, buffer: ["void-1"], toggle, clear },
        });
        const pileProps = cardsPileSpy.mock.calls.at(-1)?.[0];
        pileProps.onCardClick({ id: "void-2" });
        expect(clear).toHaveBeenCalled();
        expect(toggle).toHaveBeenCalledWith("void-2");
    });

    it("outside any choice, pinned cards are de-duped from the loose pile (baseline)", () => {
        cardsPileSpy.mockClear();
        const me = makePlayer("me", [
            makeCard("loose-1"),
            makeCard("pinned-1", { exiledByPermanentId: "host-1" } as never),
        ]);
        const { container } = renderWithContext(
            <PlayerExile player={me} />,
            "me"
        );
        const pile = container.querySelector('[data-testid="cards-pile"]')!;
        expect(pile.getAttribute("data-count")).toBe("1");
    });
});
