import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import PlayerLife from "../player-life";

// PlayerLife calls useMutation(api.game.selectTarget) — capture the mock so we
// can assert it is NOT used for the choose-damage-target (opponent's choice)
// path, which routes through the pending-choice buffer instead.
const selectTargetSpy = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => selectTargetSpy,
}));

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeBuffer(overrides: Partial<PendingChoiceBuffer> = {}) {
    return {
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(async () => {}),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
        ...overrides,
    } as PendingChoiceBuffer;
}

function renderWithContext(
    player: Player,
    {
        viewerId = "p2",
        pendingChoices,
        buffer,
    }: {
        viewerId?: string;
        pendingChoices?: NonNullable<
            React.ContextType<typeof GameContext>
        >["pendingChoices"];
        buffer?: PendingChoiceBuffer;
    } = {}
) {
    const value = {
        gameId: "game-id" as never,
        playerId: viewerId,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        pendingChoices,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={buffer ?? makeBuffer()}>
                <PlayerLife player={player} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

// The choice owed to the viewer (p2 — the opponent doing the choosing).
const damageTargetChoice = (candidatePlayerIds: string[], chooserId = "p2") => [
    {
        stackItemId: "witches",
        step: 0,
        choiceId: "cuombajj-witches",
        playerId: chooserId,
        kind: "choose-damage-target" as const,
        zone: "battlefield" as const,
        allControllers: true,
        count: 1,
        prompt: "Cuombajj Witches: choose any target.",
        candidateIds: ["body-1"],
        candidatePlayerIds,
    },
];

describe("PlayerLife — choose-damage-target (Cuombajj Witches, CR 115.4)", () => {
    it("routes a click on an eligible player to the pending-choice buffer toggle", () => {
        const buffer = makeBuffer();
        selectTargetSpy.mockClear();
        const { container } = renderWithContext(makePlayer("p1"), {
            viewerId: "p2",
            pendingChoices: damageTargetChoice(["p1", "p2"]),
            buffer,
        });
        fireEvent.click(container.firstChild as Element);
        expect(buffer.toggle).toHaveBeenCalledWith("p1");
        // The "any target of an opponent's choice" path must NOT go through the
        // normal selectTarget mutation (that's the controller's pendingTarget).
        expect(selectTargetSpy).not.toHaveBeenCalled();
    });

    it("does not make a player clickable when they are not an eligible candidate", () => {
        const buffer = makeBuffer();
        const { container } = renderWithContext(makePlayer("p1"), {
            viewerId: "p2",
            // p1 omitted from candidatePlayerIds — not a legal player target.
            pendingChoices: damageTargetChoice(["p2"]),
            buffer,
        });
        fireEvent.click(container.firstChild as Element);
        expect(buffer.toggle).not.toHaveBeenCalled();
    });

    it("does not route clicks for the player who is NOT the chooser", () => {
        const buffer = makeBuffer();
        // The choice is owed to p1, but the viewer is p2 — p2 must not be able
        // to make p1's choice.
        const { container } = renderWithContext(makePlayer("p1"), {
            viewerId: "p2",
            pendingChoices: damageTargetChoice(["p1", "p2"], "p1"),
            buffer,
        });
        fireEvent.click(container.firstChild as Element);
        expect(buffer.toggle).not.toHaveBeenCalled();
    });
});
