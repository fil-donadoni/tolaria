// Issue #1734 — the divide-as-you-choose dialog (CR 601.2d) must offer the
// SAME player set the board's nameplate ring offers.
//
// `useDivideTargets` delegates the PERMANENT kind to
// `matchesPermanentTargetFilters` (the shared target-filter registry, #1697),
// but its PLAYER loop used to hand-roll two of the kind's dimensions
// (`isAlreadySelectedTarget` + `playerAttackedThisTurn`) and simply did not
// have `controller` — the exact narrow-mirror shape #1734 set out to delete.
// A "divide N damage among any number of target opponents" requirement
// therefore listed the viewer's OWN seat in the dialog while the board's ring
// (which routes through `matchesPlayerTargetFilters`) did not, and the server
// rejected the assignment.
//
// The state is a real engine `GameState` pushed through the REAL wire
// projection and the REAL `pendingTargetFiltersFromRequirement` lowering, then
// handed to the REAL hook through a real `GameContext` — nothing about the
// filter set is hand-authored.

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeState } from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import type { TargetRequirement } from "@convex/cards/types";
import type { PendingTarget, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useDivideTargets } from "../useDivideTargets";

type Ctx = React.ContextType<typeof GameContext>;

/** Ids of the PLAYER entries the divide dialog would render for `requirement`,
 *  driven through the real hook. `divideTotal` is what puts the selection in
 *  divide mode at all (CR 601.2d). */
function dividePlayerIds(requirement: TargetRequirement): string[] {
    const projected = projectPublicState(makeState(), 1, "p1");
    const allPlayers = projected.players as unknown as Player[];
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
    return renderHook(() => useDivideTargets(), { wrapper })
        .result.current.filter((t) => t.type === "player")
        .map((t) => t.id);
}

describe("useDivideTargets — player-kind target filters (issue #1734)", () => {
    it("an unfiltered divide requirement lists BOTH seats", () => {
        // The control: with no player filter set, every gate the hook applies
        // (already-chosen, attacked-this-turn, shroud / protection) admits
        // both seats — so the `controller` assertion below is decided by the
        // `controller` dimension and nothing else.
        expect(dividePlayerIds({ type: "any", count: 2 })).toEqual([
            "p1",
            "p2",
        ]);
    });

    it("controller: opponent lists ONLY the opponent's seat (CR 109.3 / 115)", () => {
        // `controller` is the dimension the hand-rolled player loop did not
        // have: before the delegation this listed the viewer's own seat too.
        expect(
            dividePlayerIds({ type: "any", count: 2, controller: "opponent" })
        ).toEqual(["p2"]);
    });

    it("controller: you lists ONLY the viewer's own seat", () => {
        expect(
            dividePlayerIds({ type: "any", count: 2, controller: "you" })
        ).toEqual(["p1"]);
    });
});
