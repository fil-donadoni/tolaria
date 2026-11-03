// Pass Until Action (issue #5782) — the controller's descriptor, shortcut and
// active-state pills. The context carries `passUntilAction` /
// `queuedPassUntilAction` exactly as `projectPublicState` ships them
// (`convex/__tests__/passUntilActionFullPath.test.ts` proves the wire half).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PassUntilActionIntent, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";
import { selectCommandSlots } from "~/lib/controller-action-slots";

const calls: { ref: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
    useMutation: (ref: string) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));
vi.mock("@convex/_generated/api", () => {
    const names = [
        "cancelCast",
        "cancelActivation",
        "confirmAttackers",
        "declareAttackers",
        "confirmBlockers",
        "confirmDamage",
        "passPriority",
        "autoTapForPayment",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "passUntilAction",
        "cancelAutoPass",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
    ];
    const game: Record<string, string> = {};
    for (const n of names) game[n] = n;
    return { api: { game } };
});
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => ({ id: "plain", name: "T", staticEffects: [] }),
    tryGetDefinition: () => ({ id: "plain", name: "T", staticEffects: [] }),
}));
vi.mock("@convex/cards/attackRestrictions", () => ({
    globalAttackProhibitionReason: () => undefined,
}));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
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

function renderCtrl(overrides: {
    priorityPlayerId?: string;
    passUntilAction?: PassUntilActionIntent[];
    queuedPassUntilAction?: PassUntilActionIntent[];
}) {
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [player("me"), player("opp")],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
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

function press(key: string) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("useControllerActions — Pass Until Action (issue #5782)", () => {
    beforeEach(() => {
        calls.length = 0;
        resetPendingGameIntents();
    });

    it("offers the action beside Pass Turn, in its own slot — never the centre", () => {
        const { result } = renderCtrl({});
        const action = result.current.actions.find(
            (a) => a.key === "pass-until-action"
        );
        expect(action?.label).toBe("Pass Until Action");
        expect(action?.shortcut).toBe("P");
        const slots = selectCommandSlots(result.current.actions);
        expect(slots.passUntilAction).toBe(action);
        expect(slots.primary?.key).toBe("pass");
        expect(slots.secondary).not.toContain(action);
    });

    it("P arms it through the passUntilAction mutation", async () => {
        renderCtrl({});
        await act(async () => press("p"));
        expect(calls).toEqual([
            {
                ref: "passUntilAction",
                args: { gameId: "game-id", playerId: "me" },
            },
        ]);
    });

    it("P is accepted without priority (the server queues it)", async () => {
        renderCtrl({ priorityPlayerId: "opp" });
        await act(async () => press("P"));
        expect(calls.map((c) => c.ref)).toEqual(["passUntilAction"]);
    });

    it("an armed intent shows a cancelling pill and P / Enter cancel it", async () => {
        const { result } = renderCtrl({
            priorityPlayerId: "opp",
            passUntilAction: [{ playerId: "me", ignoredStackIds: [] }],
        });
        expect(result.current.isPassUntilAction).toBe(true);
        expect(result.current.cue).toBe("auto-passing");
        const pill = result.current.actions.find(
            (a) => a.key === "passing-until-action"
        );
        expect(pill?.pill).toBe(true);

        await act(async () => press("p"));
        expect(calls.map((c) => c.ref)).toEqual(["cancelAutoPass"]);

        calls.length = 0;
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Enter", bubbles: true })
            );
        });
        expect(calls.map((c) => c.ref)).toEqual(["cancelAutoPass"]);
    });

    it("an armed intent belonging to the other seat is not this viewer's", () => {
        const { result } = renderCtrl({
            priorityPlayerId: "opp",
            passUntilAction: [{ playerId: "opp", ignoredStackIds: [] }],
        });
        expect(result.current.isPassUntilAction).toBe(false);
        expect(
            result.current.actions.some((a) => a.key === "passing-until-action")
        ).toBe(false);
    });

    it("a queued intent stays visible and cancellable while holding priority", () => {
        const { result } = renderCtrl({
            queuedPassUntilAction: [{ playerId: "me", ignoredStackIds: [] }],
        });
        expect(result.current.isQueuedPassUntilAction).toBe(true);
        const pill = result.current.actions.find(
            (a) => a.key === "queued-pass-until-action"
        );
        expect(pill?.label).toBe("Pass Until Action queued (cancel)");
    });
});
