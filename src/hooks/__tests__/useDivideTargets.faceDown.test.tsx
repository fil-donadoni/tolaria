// Issue #1735 review, finding 2 — the divide-as-you-choose picker
// (`useDivideTargets`) labels a target permanent's item with
// `getDefinition(card.card.id).name`, which stayed the CR 708.2 sentinel for
// every viewer including the permanent's own controller (the entire fix
// #1735 ships). A controller dividing damage among their own creatures,
// one of which is face down, saw "Face-down creature" in the picker for
// their OWN card instead of its real name.
//
// The state is a real engine `GameState` pushed through the REAL wire
// projection and the REAL `pendingTargetFiltersFromRequirement` lowering,
// then handed to the REAL hook through a real `GameContext` — nothing about
// the label is hand-authored.

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { turnFaceDown } from "@convex/gre/faceDown";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { mahamotiDjinn } from "@convex/cards/sets/lea";
import type { TargetRequirement } from "@convex/cards/types";
import type { PendingTarget, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useDivideTargets } from "../useDivideTargets";

type Ctx = React.ContextType<typeof GameContext>;

describe("useDivideTargets — permanent label for the controller's own face-down creature (#1735)", () => {
    it("labels the controller's own face-down permanent with its REAL name, not the sentinel", () => {
        const faceDown = makeInstance(mahamotiDjinn.id, {
            id: "fd-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(faceDown);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [faceDown] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const allPlayers = projected.players as unknown as Player[];

        const requirement: TargetRequirement = { type: "Creature", count: 2 };
        const pendingTarget = {
            playerId: "p1",
            cardInstanceId: "src",
            targetType: requirement.type,
            count: requirement.count,
            selected: [],
            divideTotal: 3,
            ...pendingTargetFiltersFromRequirement(requirement, undefined),
        } as unknown as PendingTarget;
        const ctx = {
            gameId: "game-id" as never,
            playerId: "p1",
            activePlayerId: projected.activePlayerId,
            priorityPlayerId: projected.priorityPlayerId,
            phase: projected.phase,
            turn: 1,
            engineTurn: projected.turn,
            stackCount: 0,
            stackItems: [],
            allPlayers,
            pendingTarget,
            showAllCards: false,
            debugAllActions: false,
        } as unknown as NonNullable<Ctx>;
        const wrapper = ({ children }: { children: ReactNode }) => (
            <GameContext value={ctx}>{children}</GameContext>
        );
        const items = renderHook(() => useDivideTargets(), {
            wrapper,
        }).result.current.filter((t) => t.type === "permanent");

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            type: "permanent",
            id: "fd-1",
            name: mahamotiDjinn.name,
        });
    });
});
