// CR 609.7a (issue #5601) — "a source of your choice" may be a spell on the
// stack. The stack panel offers exactly the open choice's `candidateIds`, to
// its chooser only, and a click feeds the same pending-choice buffer the
// battlefield's permanents do.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { PendingChoice, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";

const selectTarget = vi.fn();
vi.mock("convex/react", () => ({ useMutation: () => selectTarget }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("~/hooks/use-leader-lines", () => ({
    repositionLeaderLines: () => {},
}));
vi.mock("../../cards/stack-card-image", () => ({
    default: ({ card }: { card: StackItem }) => (
        <div data-testid="stack-card" data-card-id={card.id} />
    ),
}));

import GameStack from "../game-stack";

function spell(id: string): StackItem {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "opp",
        ownerId: "opp",
        zone: "stack",
        isTapped: false,
    } as StackItem;
}

const SOURCE_PICK = {
    stackItemId: "cop-ability",
    step: 0,
    choiceId: "$chosen",
    playerId: "me",
    kind: "pick-source",
    zone: "battlefield-or-stack",
    count: 1,
    prompt: "Choose a red source.",
    candidateIds: ["bolt"],
} as PendingChoice;

function buffer(picked: string[] = []): PendingChoiceBuffer {
    return {
        buffer: picked,
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
        dismissError: vi.fn(),
    };
}

function renderStack(opts: {
    viewer: string;
    choice?: PendingChoice;
    buf: PendingChoiceBuffer;
}) {
    const value = {
        gameId: "game-id" as never,
        playerId: opts.viewer,
        activePlayerId: "opp",
        priorityPlayerId: "opp",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 2,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        pendingChoices: opts.choice ? [opts.choice] : undefined,
        onSwitchGame: () => {},
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={opts.buf}>
                <GameStack stack={[spell("growth"), spell("bolt")]} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

const row = (id: string) =>
    document.querySelector<HTMLButtonElement>(
        `[data-arrow-anchor-stack="${id}"]`
    )!;

beforeEach(() => {
    cleanup();
    selectTarget.mockClear();
});

describe("GameStack — a source of your choice on the stack (CR 609.7a)", () => {
    it("the candidate spell is clickable and feeds the choice buffer; a non-candidate is not", () => {
        const buf = buffer();
        renderStack({ viewer: "me", choice: SOURCE_PICK, buf });
        expect(row("bolt").disabled).toBe(false);
        expect(row("growth").disabled).toBe(true);
        fireEvent.click(row("bolt"));
        expect(buf.toggle).toHaveBeenCalledWith("bolt");
        // A pick is not a targeting move.
        expect(selectTarget).not.toHaveBeenCalled();
    });

    it("the picked spell reads as selected", () => {
        renderStack({
            viewer: "me",
            choice: SOURCE_PICK,
            buf: buffer(["bolt"]),
        });
        expect(row("bolt").dataset.choiceSelected).toBe("true");
        expect(row("growth").dataset.choiceSelected).toBeUndefined();
    });

    it("offers nothing to a viewer who is not the chooser", () => {
        renderStack({ viewer: "opp", choice: SOURCE_PICK, buf: buffer() });
        expect(row("bolt").disabled).toBe(true);
    });
});
