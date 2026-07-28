// Space must never be reinterpreted as "advance the phase" while a cast /
// activation this client just dispatched is still round-tripping.
//
// The payment banner (whose Auto-tap the Space hotkey mirrors) only appears
// once the server has parked the engine on payment input. A Space pressed in
// that window saw no `pendingCast`, fell through to `passPriority`, and burned
// the turn. `pending-intent-store.ts` records the in-flight dispatch and the
// hotkey drops the keystroke instead.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";
import {
    trackGameIntent,
    resetPendingGameIntents,
} from "~/lib/pending-intent-store";

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
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "cancelAutoPass",
        "submitMayPay",
        "submitLandEntryChoice",
        "submitDrawReplacementPay",
    ];
    const game: Record<string, string> = {};
    for (const n of names) game[n] = n;
    return { api: { game } };
});
vi.mock("@convex/cards", () => ({
    getDefinition: () => ({ id: "plain", name: "T", staticEffects: [] }),
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

function renderCtrl() {
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
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

function pressSpace() {
    window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Space", bubbles: true })
    );
}

describe("useControllerActions — Space vs. in-flight game intent", () => {
    beforeEach(() => {
        calls.length = 0;
        resetPendingGameIntents();
    });

    it("passes priority when nothing is in flight", async () => {
        renderCtrl();
        await act(async () => {
            pressSpace();
        });
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });

    it("drops the keystroke while a dispatched cast is still round-tripping", async () => {
        renderCtrl();
        let settle!: () => void;
        const dispatch = new Promise<void>((res) => {
            settle = res;
        });
        await act(async () => {
            void trackGameIntent(dispatch);
        });

        await act(async () => {
            pressSpace();
        });
        expect(calls.map((c) => c.ref)).not.toContain("passPriority");

        // Once the round-trip settles (Convex has already applied the mutation
        // to the client's queries by then) Space is live again.
        await act(async () => {
            settle();
            await dispatch;
        });
        await act(async () => {
            pressSpace();
        });
        expect(calls.map((c) => c.ref)).toContain("passPriority");
    });

    it("does not end the turn on Enter while an intent is in flight", async () => {
        renderCtrl();
        let settle!: () => void;
        const dispatch = new Promise<void>((res) => {
            settle = res;
        });
        await act(async () => {
            void trackGameIntent(dispatch);
        });
        await act(async () => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", { code: "Enter", bubbles: true })
            );
        });
        expect(calls.map((c) => c.ref)).not.toContain("endTurn");
        await act(async () => {
            settle();
            await dispatch;
        });
    });
});
