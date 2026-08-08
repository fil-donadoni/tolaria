// Regression (bug report 2026-08-08): confirming blockers into a menace
// rejection (CR 509.1b/702.111) threw a plain `Error` that was never caught
// client-side — it surfaced only as an "Uncaught (in promise)" console error,
// with no toast. Every fire-and-forget mutation dispatched by this hook
// (keydown shortcuts AND the `runBusy`-wrapped action buttons) must route a
// rejection to the shared error toast via `pendingChoiceBuffer.reportError`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";

const MENACE_ERROR = new Error(
    "Skeleton can't be blocked except by 2 or more creatures (menace)"
);

const reportError = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (ref: string) => (): Promise<unknown> =>
        ref === "confirmBlockers"
            ? Promise.reject(MENACE_ERROR)
            : Promise.resolve(null),
}));
vi.mock("@convex/_generated/api", () => {
    const names = [
        "cancelCast",
        "cancelActivation",
        "confirmAttackers",
        "toggleAttacker",
        "confirmBlockers",
        "confirmDamage",
        "passPriority",
        "autoTapForPayment",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "cancelAutoPass",
    ];
    const game: Record<string, string> = {};
    for (const n of names) game[n] = n;
    return { api: { game } };
});
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError,
        dismissError: vi.fn(),
    }),
}));

import { useControllerActions } from "../useControllerActions";

function player(id: string): Player {
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
    } as Player;
}

const SEQUENCE: AttackSequence = {
    active: false,
    order: [],
    index: 0,
    currentAttackerId: undefined,
    begin: vi.fn(),
    advance: vi.fn(),
    reset: vi.fn(),
};

function renderCtrl() {
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "opp",
        priorityPlayerId: "me",
        phase: "DECLARE_BLOCKERS",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        combat: {
            attackerIds: ["skeleton"],
            blockerAssignments: { blocker: "skeleton" },
            blockersConfirmed: false,
        },
        allPlayers: [player("me"), player("opp")],
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>
            <AttackSequenceContext value={SEQUENCE}>
                {children}
            </AttackSequenceContext>
        </GameContext>
    );
    return renderHook(() => useControllerActions(), { wrapper });
}

describe("useControllerActions — mutation rejections reach the error toast", () => {
    beforeEach(() => {
        reportError.mockClear();
    });

    it("reports a confirmBlockers rejection from the Space shortcut", async () => {
        renderCtrl();
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Space", bubbles: true })
            );
        });
        expect(reportError).toHaveBeenCalledWith(MENACE_ERROR);
    });

    it("reports a confirmBlockers rejection from the Confirm Blockers button", async () => {
        const { result } = renderCtrl();
        const confirmAction = result.current.actions.find(
            (a) => a.key === "confirm-blockers"
        );
        expect(confirmAction).toBeDefined();
        await act(async () => {
            confirmAction!.onClick();
        });
        expect(reportError).toHaveBeenCalledWith(MENACE_ERROR);
    });
});
