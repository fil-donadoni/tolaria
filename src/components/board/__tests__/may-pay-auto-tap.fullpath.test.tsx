// A `may-pay`'s Pay auto-taps, the whole path (CR 608.2g, issue #10460):
//
//   GRE     — Daze resolves and suspends on its controller-pays may-pay;
//   WIRE/UI — the REAL prompt reads only `projectPublicState`'s output: Pay is
//             enabled with an empty pool and an untapped land, disabled with
//             none;
//   game.ts — the args the click sends go to the REGISTERED `submitMayPay`,
//             which taps and pays in that one mutation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { submitMayPay } from "@convex/game";
import { projectPublicState } from "@convex/gameProjections";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "@convex/__tests__/gameMutationHarness.fixture";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { MinimizedChoiceContext } from "~/hooks/useMinimizedChoice";
import { PendingChoiceBufferContext } from "~/hooks/usePendingChoiceBuffer";
import {
    YieldPrefsContext,
    useYieldPrefsState,
} from "~/hooks/useYieldPreferences";
import {
    noopMinimizedChoice,
    noopPendingChoiceBuffer,
} from "~/lib/testing/board-context";
import { usePendingChoicePrimaryAction } from "~/hooks/usePendingChoicePrimaryAction";

const submitted: Record<string, unknown>[] = [];
vi.mock("convex/react", () => ({
    useMutation: () => (args: Record<string, unknown>) => {
        submitted.push(args);
        return Promise.resolve(null);
    },
}));
vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => false }));

import PendingChoicePrompt from "../pending-choice-prompt";

const BOLT = getCardByName("Lightning Bolt").id;

/** p2's Daze has resolved against p1's Lightning Bolt: p1 owes the {1} with an
 *  empty pool and one Forest. */
function dazed(forestTapped: boolean): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(getCardByName("Forest").id, {
                        id: "f1",
                        controllerId: "p1",
                        ownerId: "p1",
                        isTapped: forestTapped,
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const bolt = pushSpell(state, BOLT, "p1", [{ type: "player", id: "p2" }]);
    pushSpell(state, getCardByName("Daze").id, "p2", [
        { type: "spell", id: bolt.id },
    ]);
    resolveTopOfStack(state);
    return state;
}

/** What the Space hotkey reads (`useControllerActions` → this hook). */
function SpaceProbe() {
    const primary = usePendingChoicePrimaryAction();
    return (
        <button
            type="button"
            data-space
            disabled={!primary?.canConfirm}
            onClick={() => primary?.confirm()}
        />
    );
}

function Board({ state }: { state: GameState }) {
    const yieldPrefs = useYieldPrefsState("game-1");
    const view = projectPublicState(state, 1, "p1");
    const ctx = {
        gameId: "game-1",
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: view.stack.length,
        stackItems: view.stack,
        allPlayers: view.players as unknown as Player[],
        pendingChoices: view.pendingChoices,
    } as unknown as React.ContextType<typeof GameContext>;
    return (
        <GameContext value={ctx}>
            <YieldPrefsContext value={yieldPrefs}>
                <PendingChoiceBufferContext value={noopPendingChoiceBuffer}>
                    <MinimizedChoiceContext value={noopMinimizedChoice}>
                        <PendingChoicePrompt
                            choice={view.pendingChoices![0]!}
                            playerId="p1"
                            gameId={"game-1" as never}
                        />
                        <SpaceProbe />
                    </MinimizedChoiceContext>
                </PendingChoiceBufferContext>
            </YieldPrefsContext>
        </GameContext>
    );
}

const payButton = () =>
    Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.startsWith("Pay")
    )!;
const spaceProbe = () =>
    document.querySelector("[data-space]") as HTMLButtonElement;

afterEach(() => {
    cleanup();
    submitted.length = 0;
});

describe("may-pay Pay auto-taps — GRE → wire → UI → game.ts (issue #10460)", () => {
    it.each([
        ["the Pay button", payButton],
        ["the hotkey", spaceProbe],
    ])(
        "empty pool + untapped land: %s is enabled and its submit taps and pays",
        async (_label, control) => {
            const state = dazed(false);
            render(<Board state={state} />);
            expect(control().disabled).toBe(false);
            await act(async () => {
                fireEvent.click(control());
            });
            expect(submitted).toEqual([
                { gameId: "game-1", playerId: "p1", accept: true },
            ]);

            const stub = makeMutationCtx("p1", [gameStateSeed(state)]);
            await runMutation(
                submitMayPay as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                stub.ctx,
                submitted[0]!
            );
            const after = stub.state();
            expect(after.players[0].battlefield[0].isTapped).toBe(true);
            expect(after.pendingChoices ?? []).toHaveLength(0);
            expect(
                after.stack.map((s) => (s.card as { id?: string }).id)
            ).toEqual([BOLT]);
        }
    );

    it("no untapped source: Pay and the hotkey stay disabled", () => {
        render(<Board state={dazed(true)} />);
        expect(payButton().disabled).toBe(true);
        expect(spaceProbe().disabled).toBe(true);
    });
});
