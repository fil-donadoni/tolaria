// Frontend wiring for unleash's block restriction (CR 702.98a): the board
// grays out a creature the server would refuse as a blocker. Driven through
// `projectPublicState` and the real `useBattlefieldVisualState`.
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { GameContext } from "~/hooks/useGameContext";
import type { CardInstance, Player } from "~/types/game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../../convex/cards/registry";
import { grizzlyBears } from "../../../convex/cards/sets/lea/green.cards";
import type { CardDefinition } from "../../../convex/cards/types";
import { projectPublicState } from "../../../convex/gameProjections";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";

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

const UNLEASHED: CardDefinition = {
    id: "unleash-board-test-creature",
    name: "Unleash Board Tester",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["unleash"],
};

function canInteractWithBlocker(counters: Record<string, number>): boolean {
    return withTemporaryDefinition(UNLEASHED, () => {
        const state = makeState({
            activePlayerId: "me",
            priorityPlayerId: "opp",
            players: [
                makePlayer("me", {
                    battlefield: [
                        makeInstance(grizzlyBears().id, {
                            id: "a",
                            controllerId: "me",
                            ownerId: "me",
                            zone: "battlefield",
                        }),
                    ],
                }),
                makePlayer("opp", {
                    battlefield: [
                        makeInstance(UNLEASHED.id, {
                            id: "b",
                            controllerId: "opp",
                            ownerId: "opp",
                            zone: "battlefield",
                            counters,
                        }),
                    ],
                }),
            ],
        });
        const projected = projectPublicState(state, 1, "opp");
        const me = projected.players[0] as unknown as Player;
        const opp = projected.players[1] as unknown as Player;
        const ctx = {
            gameId: "game-id",
            playerId: "opp",
            activePlayerId: "me",
            priorityPlayerId: "opp",
            turn: 1,
            engineTurn: 1,
            stackCount: 0,
            allPlayers: [me, opp],
            showAllCards: false,
            debugAllActions: false,
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["a"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        } as never;
        const wrapper = ({ children }: { children: ReactNode }) => (
            <GameContext value={ctx}>{children}</GameContext>
        );
        const { result } = renderHook(() => useBattlefieldVisualState(opp), {
            wrapper,
        });
        return result.current.canInteract(opp.battlefield[0] as CardInstance);
    });
}

describe("unleash on the blockers board (CR 702.98a)", () => {
    it("a creature with a +1/+1 counter is not offered as a blocker", () => {
        expect(canInteractWithBlocker({ "+1/+1": 1 })).toBe(false);
    });

    it("the same creature without the counter is offered", () => {
        expect(canInteractWithBlocker({})).toBe(true);
    });
});
