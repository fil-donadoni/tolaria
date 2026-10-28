// Frontend wiring for un-picking a target during an open Target Selection
// (CR 601.2c, issue #2302). Asserted THROUGH the real reducers: a real GRE
// `GameState` with a pending target, the real `projectPublicState`, fed into
// the real `useBattlefieldVisualState` / `usePlayerInteraction` — a hand-built
// view would mask a dropped `selected` field.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";
import { usePlayerInteraction } from "../usePlayerInteraction";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { getCardByName } from "../../../convex/cards";
import { projectPublicState } from "../../../convex/gameProjections";

const mutations: Record<string, ReturnType<typeof vi.fn>> = {};

vi.mock("convex/react", () => ({
    useMutation: (ref: never) => {
        const key = getFunctionName(ref);
        return (mutations[key] ??= vi.fn());
    },
    useQuery: () => undefined,
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));

type Ctx = React.ContextType<typeof GameContext>;

function project(selected: { type: string; id: string }[]) {
    const bears = getCardByName("Grizzly Bears").id;
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(bears, {
                        id: "b0",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(bears, {
                        id: "b1",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        pendingTarget: {
            playerId: "p1",
            cardInstanceId: "spell",
            targetType: ["Creature", "player"],
            count: { min: 1, max: 3 },
            selected: selected as never,
        },
    });
    const projected = projectPublicState(state, 1, "p1");
    return {
        me: projected.players[0] as unknown as Player,
        opp: projected.players[1] as unknown as Player,
        pendingTarget:
            projected.pendingTarget as NonNullable<Ctx>["pendingTarget"],
    };
}

function wrapperFor(boards: ReturnType<typeof project>) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [boards.me, boards.opp],
        pendingTarget: boards.pendingTarget,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<Ctx>;
    return ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
}

beforeEach(() => {
    for (const k of Object.keys(mutations)) delete mutations[k];
});

describe("deselect a picked target on the board (CR 601.2c, issue #2302)", () => {
    it("a picked permanent stays interactive and rings `selected`; an unpicked one is a candidate", () => {
        const boards = project([{ type: "permanent", id: "b0" }]);
        expect(boards.pendingTarget!.selected).toHaveLength(1);
        const { result } = renderHook(
            () => useBattlefieldVisualState(boards.opp),
            { wrapper: wrapperFor(boards) }
        );
        const [picked, other] = boards.opp.battlefield as CardInstance[];
        const pickedState = result.current.getVisualState(picked);
        const otherState = result.current.getVisualState(other);
        expect(result.current.canInteract(picked)).toBe(true);
        expect(pickedState.interactive).toBe(true);
        expect(pickedState.ringClass).toBeTruthy();
        expect(pickedState.ringClass).not.toBe(otherState.ringClass);
        expect(otherState.interactive).toBe(true);
    });

    it("a picked player's nameplate stays targetable and its click fires deselectTarget", () => {
        const boards = project([{ type: "player", id: "p2" }]);
        const { result } = renderHook(() => usePlayerInteraction(boards.opp), {
            wrapper: wrapperFor(boards),
        });
        expect(result.current.isTargetable).toBe(true);
        expect(result.current.isPlayerPicked).toBe(true);
        result.current.handleClick();
        const calls = Object.entries(mutations).flatMap(([k, fn]) =>
            fn.mock.calls.map((c) => [k, c[0]] as const)
        );
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toMatchObject({
            targetType: "player",
            targetId: "p2",
        });
        expect(calls[0][0]).toMatch(/deselectTarget/);
    });

    it("an unpicked legal player fires selectTarget, not deselectTarget", () => {
        const boards = project([]);
        const { result } = renderHook(() => usePlayerInteraction(boards.opp), {
            wrapper: wrapperFor(boards),
        });
        expect(result.current.isPlayerPicked).toBe(false);
        result.current.handleClick();
        const keys = Object.entries(mutations)
            .filter(([, fn]) => fn.mock.calls.length > 0)
            .map(([k]) => k);
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatch(/selectTarget/);
        expect(keys[0]).not.toMatch(/deselect/);
    });
});
