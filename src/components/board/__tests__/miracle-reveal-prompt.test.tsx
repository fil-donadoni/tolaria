// The Miracle reveal window on the board (CR 702.94a), fed by the REAL engine
// and projection: a draw parks on the private `miracle-reveal` choice, the
// drawer's projection carries it and renders Reveal / Don't reveal (each
// firing `submitMiracleReveal` with its answer), and the opponent's
// projection carries nothing to render at all.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { PendingChoice } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PendingChoicePrompt from "../pending-choice-prompt";
import { registerTokenDefinition, getCardByName } from "@convex/cards";
import type { EffectOp } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { resolveTopOfStack } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";

const { mutationSpy } = vi.hoisted(() => ({ mutationSpy: vi.fn() }));
vi.mock("convex/react", () => ({
    useMutation: () => mutationSpy,
}));
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => true,
}));

const MIRACLE_ID = "test-miracle-prompt-card";
registerTokenDefinition({
    id: MIRACLE_ID,
    name: "Test Miracle Sorcery",
    rarity: "rare",
    manaCost: { X: 3, U: 2 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 } as EffectOp],
    miracle: { X: 1, U: 1 },
});
const DRAW_ID = "test-miracle-prompt-draw";
registerTokenDefinition({
    id: DRAW_ID,
    name: DRAW_ID,
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    effects: [{ op: "draw", player: "controller", count: 1 } as EffectOp],
});

/** The engine state after "me" drew the miracle card as the first draw. */
function windowOpen() {
    const state = makeState({
        players: [
            makePlayer("me", {
                library: [
                    makeInstance(MIRACLE_ID, {
                        id: "miracle",
                        ownerId: "me",
                        zone: "library",
                    }),
                ],
                battlefield: [
                    makeInstance(getCardByName("Island").id, {
                        ownerId: "me",
                        controllerId: "me",
                        zone: "battlefield",
                    }),
                ],
            }),
            makePlayer("opp"),
        ],
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    pushSpell(state, DRAW_ID, "me");
    resolveTopOfStack(state);
    return state;
}

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

function renderPrompt(choice: PendingChoice, playerId: string) {
    const value = {
        gameId: "game-id" as never,
        playerId,
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [
            { id: "me", name: "Me" },
            { id: "opp", name: "Opp" },
        ],
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

describe("PendingChoicePrompt — miracle-reveal (CR 702.94a)", () => {
    it.each([
        ["Reveal", true],
        ["Don't reveal", false],
    ])(
        "the drawer's projected window renders %s and submits reveal=%s",
        async (label, reveal) => {
            mutationSpy.mockClear();
            const choice = projectPublicState(windowOpen(), 1, "me")
                .pendingChoices?.[0] as PendingChoice;
            expect(choice.kind).toBe("miracle-reveal");
            const { getByRole, getByText } = renderPrompt(choice, "me");
            expect(getByText(/Reveal Test Miracle Sorcery/)).toBeTruthy();
            fireEvent.click(getByRole("button", { name: label }));
            await waitFor(() =>
                expect(mutationSpy).toHaveBeenCalledWith({
                    gameId: "game-id",
                    playerId: "me",
                    reveal,
                })
            );
        }
    );

    it("the opponent's projection carries no window to render", () => {
        expect(
            projectPublicState(windowOpen(), 1, "opp").pendingChoices
        ).toBeUndefined();
    });
});
