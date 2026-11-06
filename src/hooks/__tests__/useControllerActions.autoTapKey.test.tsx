// Hotkey A = Auto-tap while a cost is being paid (issue #7424).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";

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
        "toggleAttacker",
        "confirmBlockers",
        "confirmDamage",
        "passPriority",
        "autoTapForPayment",
        "declineGenericSubstitution",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "cancelAutoPass",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
        "submitMiracleReveal",
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

function renderCtrl(overrides: Record<string, unknown> = {}) {
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

function pressA(init: KeyboardEventInit = {}, target: EventTarget = window) {
    target.dispatchEvent(
        new KeyboardEvent("keydown", {
            key: "a",
            code: "KeyA",
            bubbles: true,
            ...init,
        })
    );
}

describe("useControllerActions — A = Auto-tap", () => {
    beforeEach(() => {
        calls.length = 0;
        resetPendingGameIntents();
    });

    it("auto-taps a paying cast", async () => {
        renderCtrl({
            pendingCast: { playerId: "me", manaCost: { generic: 2 } },
        });
        await act(async () => {
            pressA();
        });
        expect(calls.map((c) => c.ref)).toEqual(["autoTapForPayment"]);
    });

    it("auto-taps a paying attack tax", async () => {
        renderCtrl({
            combat: { pendingAttackManaTax: { playerId: "me" } },
        });
        await act(async () => {
            pressA();
        });
        expect(calls.map((c) => c.ref)).toEqual(["autoTapForAttackTax"]);
    });

    it("does nothing when no cost is being paid", async () => {
        renderCtrl();
        await act(async () => {
            pressA();
        });
        expect(calls).toEqual([]);
    });

    it("ignores modified and repeated presses", async () => {
        renderCtrl({
            pendingCast: { playerId: "me", manaCost: { generic: 2 } },
        });
        await act(async () => {
            pressA({ metaKey: true });
            pressA({ ctrlKey: true });
            pressA({ repeat: true });
        });
        expect(calls).toEqual([]);
    });

    it("ignores other keys while paying", async () => {
        renderCtrl({
            pendingCast: { playerId: "me", manaCost: { generic: 2 } },
        });
        await act(async () => {
            pressA({ key: "b", code: "KeyB" });
        });
        expect(calls).toEqual([]);
    });
});
