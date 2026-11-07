// CR 700.2 / 603.3c — the full path of a "choose three" triggered ability, fed by
// the REAL engine and projection: the raised `trigger-mode` choice crosses
// `projectPublicState`, the banner renders one row per choosable mode, nothing is
// submitted until the count is met, and the mutation's arguments are what the
// server-side submit accepts — in the same call the trigger then resolves from.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { PendingChoice } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import PendingChoicePrompt from "../pending-choice-prompt";
import { raiseTriggerTargetSelection } from "@convex/gre/rules";
import { applyPendingChoiceSubmit } from "@convex/gre/pendingChoiceSubmit";
import { resolveTopOfStack } from "@convex/gre/state";
import { projectPublicState } from "@convex/gameProjections";
import {
    bear,
    CHOOSE_THREE,
    MODES,
    modalBoard,
    modalTriggerCard,
    releaseModalTriggerCards,
} from "@convex/gre/__tests__/modalTriggerSelection.fixture";

const { mutationSpy } = vi.hoisted(() => ({ mutationSpy: vi.fn() }));
vi.mock("convex/react", () => ({
    useMutation: () => mutationSpy,
}));
vi.mock("~/hooks/useIsPortrait", () => ({
    useIsPortrait: () => true,
}));

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

function renderPrompt(choice: PendingChoice, players: unknown[]) {
    const ctx = {
        gameId: "game",
        playerId: "p1",
        pendingChoices: [choice],
        allPlayers: players,
    } as unknown as React.ContextType<typeof GameContext>;
    return render(
        <GameContext.Provider value={ctx}>
            <PendingChoiceBufferContext.Provider value={noopBuffer}>
                <MinimizedChoiceContext.Provider
                    value={{ minimized: false, setMinimized: () => {} }}
                >
                    <PendingChoicePrompt
                        choice={choice}
                        playerId="p1"
                        gameId={"game" as never}
                    />
                </MinimizedChoiceContext.Provider>
            </PendingChoiceBufferContext.Provider>
        </GameContext.Provider>
    );
}

afterEach(async () => {
    cleanup();
    mutationSpy.mockReset();
    await releaseModalTriggerCards();
});

describe("a multi-mode trigger announcement, GRE → projection → UI → GRE", () => {
    it("submits nothing until the count is met, then ids the server runs in printed order", async () => {
        const { state, trig } = modalBoard(modalTriggerCard(CHOOSE_THREE), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        const projected = projectPublicState(state, 1, "p1");

        const { getByRole, container } = renderPrompt(
            projected.pendingChoices![0] as PendingChoice,
            projected.players
        );
        expect(container.textContent).toContain("Choose three");
        for (const mode of MODES) {
            expect(container.textContent).toContain(mode.oracleText);
        }
        const row = (id: string) =>
            container.querySelector(`[data-mode-id="${id}"]`) as HTMLElement;
        const confirm = getByRole("button", { name: "Confirm" });

        // Click order is not printed order.
        fireEvent.click(row("untap"));
        fireEvent.click(row("gain"));
        expect((confirm as HTMLButtonElement).disabled).toBe(true);
        expect(mutationSpy).not.toHaveBeenCalled();
        fireEvent.click(row("tap"));
        expect((confirm as HTMLButtonElement).disabled).toBe(false);
        // The count is met: a fourth distinct mode cannot join.
        expect((row("draw") as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(confirm);
        await waitFor(() => expect(mutationSpy).toHaveBeenCalledTimes(1));
        const args = mutationSpy.mock.calls[0][0];
        expect(args.cardInstanceIds).toEqual(["gain", "tap", "untap"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: args.stackItemId,
            step: args.step,
            choiceId: args.choiceId,
            cardInstanceIds: args.cardInstanceIds,
        });
        expect(trig.chosenModeIds).toEqual(["gain", "tap", "untap"]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
    });

    it("a repeats list gives every row a counter, and the ids repeat", async () => {
        const { state } = modalBoard(
            modalTriggerCard({ min: 2, max: 2, repeats: true }, [
                MODES[0],
                MODES[3],
            ])
        );
        raiseTriggerTargetSelection(state);
        const projected = projectPublicState(state, 1, "p1");
        const { getByRole, getByLabelText } = renderPrompt(
            projected.pendingChoices![0] as PendingChoice,
            projected.players
        );
        fireEvent.click(getByLabelText("Add Draw a card"));
        fireEvent.click(getByLabelText("Add Draw a card"));
        fireEvent.click(getByRole("button", { name: "Confirm" }));
        await waitFor(() => expect(mutationSpy).toHaveBeenCalledTimes(1));
        expect(mutationSpy.mock.calls[0][0].cardInstanceIds).toEqual([
            "draw",
            "draw",
        ]);
    });

    it("a single-mode announcement keeps its one-click buttons", () => {
        const { state } = modalBoard(modalTriggerCard(undefined), {
            p2: [bear("b", "p2")],
        });
        raiseTriggerTargetSelection(state);
        const projected = projectPublicState(state, 1, "p1");
        const { getByRole, queryByRole } = renderPrompt(
            projected.pendingChoices![0] as PendingChoice,
            projected.players
        );
        expect(queryByRole("button", { name: "Confirm" })).toBeNull();
        fireEvent.click(getByRole("button", { name: "Draw a card" }));
        expect(mutationSpy.mock.calls[0][0].cardInstanceIds).toEqual(["draw"]);
    });
});
