import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PendingChoice } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PendingChoicePrompt from "../pending-choice-prompt";

// The prompt fires Convex mutations through useMutation — stub with no-ops.
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
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

function renderPrompt(choice: PendingChoice, playerId = "me") {
    const value = {
        gameId: "game-id" as never,
        playerId,
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [{ id: "me", name: "Me" }],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
        pendingChoices: [choice],
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <MinimizedChoiceContext
                    value={{
                        isMinimized: false,
                        minimize: () => {},
                        restore: () => {},
                    }}
                >
                    <PendingChoicePrompt
                        choice={choice}
                        playerId={playerId}
                        gameId={"game-id" as never}
                    />
                </MinimizedChoiceContext>
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("PendingChoicePrompt suppression", () => {
    // reorder-library owns the full-screen LibraryOrderPicker (mounted by
    // PlayerLibrary). The generic banner must NOT double up — its buffered
    // "N / max selected" Done would submit an empty (illegal) selection.
    it("renders nothing for a reorder-library choice (the drag picker owns it)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "reorder-library",
            zone: "library",
            count: 3,
            prompt: "Put these cards back in any order (rightmost = top).",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).toBeNull();
    });

    it("still renders the generic banner for a non-picker choice (control)", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "search-library",
            zone: "library",
            count: 1,
            prompt: "Search your library for a card.",
        } as PendingChoice;
        const { container } = renderPrompt(choice);
        expect(container.firstChild).not.toBeNull();
    });
});

describe("PendingChoicePrompt — pick-pile (ADR 0053, pile division)", () => {
    it("renders two pile-option buttons sized from pileA/pileB, for the chooser", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "me",
            playerId: "me",
            kind: "pick-pile",
            count: 1,
            prompt: "Choose a pile.",
            pileA: ["c1", "c2"],
            pileB: ["c3"],
        } as PendingChoice;
        const { getByText } = renderPrompt(choice);
        expect(getByText(/Pile A \(2 cards\)/)).toBeTruthy();
        expect(getByText(/Pile B \(1 card\)/)).toBeTruthy();
    });

    it("shows the waiting banner (not the option buttons) for the non-chooser viewer", () => {
        const choice: PendingChoice = {
            stackItemId: "stk",
            step: 0,
            choiceId: "opponent",
            playerId: "opponent",
            kind: "pick-pile",
            count: 1,
            prompt: "Choose a pile.",
            pileA: ["c1"],
            pileB: ["c2"],
        } as PendingChoice;
        const { queryByText, getByText } = renderPrompt(choice, "me");
        expect(queryByText(/Pile A/)).toBeNull();
        expect(getByText(/Waiting for/)).toBeTruthy();
    });
});
