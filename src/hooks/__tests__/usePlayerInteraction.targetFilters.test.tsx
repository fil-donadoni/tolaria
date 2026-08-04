// Issue #1734 — the player nameplate's targeting ring must obey EVERY
// player-kind filter dimension the server enforces.
//
// The sibling parity test (`src/lib/__tests__/target-filter-client-parity.test.ts`)
// proves the predicate itself agrees with `getLegalTargets`. This one proves
// the HOOK actually calls it — and calls it with the right arguments. That is a
// separate failure mode with its own history: a predicate can be perfectly
// correct while the hook passes it a value the projection never populated (the
// `emblems` regression, #1732) or simply never routes a dimension through it at
// all (`controller`, which `usePlayerInteraction` did not check before #1734:
// under a "target opponent" requirement BOTH nameplates rang and the server
// rejected whichever the player clicked).
//
// So the state under test is built as a real engine `GameState`, pushed through
// the REAL wire projection (`projectPublicState`), and the REAL
// `pendingTargetFiltersFromRequirement` lowering — then handed to the REAL hook
// through a real `GameContext`. Nothing about the filter set is hand-authored.

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeState } from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import type { TargetRequirement } from "@convex/cards/types";
import type { PendingTarget, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { forgottenLore } from "@convex/cards/sets/ice/green";
import { usePlayerInteraction } from "../usePlayerInteraction";

vi.mock("convex/react", () => ({
    useMutation: () => async () => {},
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
vi.mock("~/hooks/useDivideBuffer", () => ({
    useDivideBuffer: () => ({
        active: false,
        remaining: 0,
        get: () => 0,
        inc: vi.fn(),
        dec: vi.fn(),
    }),
}));

type Ctx = React.ContextType<typeof GameContext>;

/** Drives the REAL hook for every seat under `requirement`, returning the ids
 *  of the players whose nameplate the board would ring as targetable. */
function targetableSeats(requirement: TargetRequirement): string[] {
    const projected = projectPublicState(makeState(), 1, "p1");
    const allPlayers = projected.players as unknown as Player[];
    const pendingTarget = {
        playerId: "p1",
        cardInstanceId: "src",
        targetType: requirement.type,
        count: 1,
        selected: [],
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
    return allPlayers
        .filter(
            (p) =>
                renderHook(() => usePlayerInteraction(p), { wrapper }).result
                    .current.isTargetable
        )
        .map((p) => p.id);
}

describe("usePlayerInteraction — player-kind target filters (issue #1734)", () => {
    it("controller: opponent (Forgotten Lore) rings ONLY the opponent's nameplate", () => {
        expect(targetableSeats(forgottenLore.targetRequirement!)).toEqual([
            "p2",
        ]);
    });

    it("an unfiltered player requirement still rings BOTH nameplates", () => {
        // The over-filter direction: routing through the registry must not
        // narrow a requirement that carries no player filter at all.
        expect(targetableSeats({ type: "player", count: 1 })).toEqual([
            "p1",
            "p2",
        ]);
    });

    it("controller: you rings ONLY the viewer's own nameplate", () => {
        expect(
            targetableSeats({ type: "player", count: 1, controller: "you" })
        ).toEqual(["p1"]);
    });
});
