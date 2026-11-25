// The damage panel and the Confirm Damage gate after a blocker left combat
// (CR 510.1c), read through `projectPublicState` off a state the engine itself
// produced: a departed blocker's tombstone slot is in the wire's block graph,
// but is no row, no counter share and nothing the panel sends back.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { buildDefaultDamageAssignments } from "@convex/gre/phases";
import {
    isDepartedCombatantId,
    removePermanentTo,
    type GameState,
} from "@convex/gre/state";
import type { Combat, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

const setDamageAssignment = vi.fn((args?: unknown) => {
    void args;
    return Promise.resolve(null);
});

vi.mock("convex/react", () => ({
    useMutation: () => setDamageAssignment,
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
        reportError: vi.fn(),
        dismissError: vi.fn(),
    }),
}));

import DamageAssignmentPanel from "../damage-assignment-panel";
import { useControllerActions } from "~/hooks/useControllerActions";

beforeEach(() => {
    setDamageAssignment.mockClear();
    cleanup();
});

/** p1's Earth Elemental (4/5) double-blocked by Grizzly Bears and Craw Wurm;
 *  `leaving` then die, and the damage step's own seed opens the assignment.
 *  `stored` overrides the seed, as a map saved before the target set shrank. */
function view(
    leaving: string[],
    stored?: (tombstones: string[]) => Record<string, number>,
    staticAbilities: string[] = []
): { combat: Combat; allPlayers: Player[]; tombstones: string[] } {
    const make = (
        name: string,
        id: string,
        owner: string,
        overrides: Parameters<typeof makeInstance>[1]
    ) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: owner,
            ownerId: owner,
            ...overrides,
        });
    const state: GameState = makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    make("Earth Elemental", "atk", "p1", {
                        isAttacking: true,
                        staticAbilities,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    make("Grizzly Bears", "bears", "p2", { isBlocking: true }),
                    make("Craw Wurm", "wurm", "p2", { isBlocking: true }),
                ],
            }),
        ],
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { bears: ["atk"], wurm: ["atk"] },
            blockersConfirmed: true,
            blockedAttackerIds: ["atk"],
        },
    });
    for (const id of leaving) removePermanentTo(state, id, "graveyard");
    const combat = state.combat!;
    const tombstones = Object.keys(combat.blockerAssignments).filter(
        isDepartedCombatantId
    );
    combat.damageAssignments = stored
        ? { atk: stored(tombstones) }
        : buildDefaultDamageAssignments(state, "regular");
    combat.damageConfirmed = false;
    combat.damageAssignerIds = { atk: "p1" };
    combat.damageAssignmentConfirmedBy = [];

    const projected = projectPublicState(state, 1, "p1");
    // The graph the client builds from the wire still holds the tombstones.
    expect(
        Object.keys(projected.combat!.blockerAssignments).filter(
            isDepartedCombatantId
        )
    ).toEqual(tombstones);
    return {
        combat: projected.combat as unknown as Combat,
        allPlayers: projected.players as unknown as Player[],
        tombstones,
    };
}

const renderPanel = ({ combat, allPlayers }: ReturnType<typeof view>) =>
    render(
        <DamageAssignmentPanel
            combat={combat}
            allPlayers={allPlayers}
            gameId={"game-id" as never}
            playerId="p1"
            defenderId="p2"
        />
    );

function confirmDisabled({ combat, allPlayers }: ReturnType<typeof view>) {
    const ctx = {
        gameId: "game-id",
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "COMBAT_DAMAGE",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers,
        combat,
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    const { result } = renderHook(() => useControllerActions(), { wrapper });
    const action = result.current.actions.find(
        (a) => a.key === "confirm-damage"
    );
    expect(action).toBeDefined();
    return action!.disabled;
}

describe("damage panel after one of two blockers left (CR 510.1c)", () => {
    it("lists only the live blocker: no tombstone row, no Defending Player row for a non-trampler", () => {
        const { getByText, getAllByText, queryByText } = renderPanel(
            view(["bears"])
        );
        expect(getByText("Craw Wurm")).toBeTruthy();
        expect(getAllByText("+")).toHaveLength(1);
        expect(queryByText("Target")).toBeNull();
        expect(queryByText("Defending Player")).toBeNull();
        expect(getByText("4/4").className).toContain("text-success-strong");
    });

    it("counts a share stored on the tombstone as unassigned, and Confirm stays disabled", () => {
        const stale = view(["bears"], ([t]) => ({ wurm: 2, [t]: 2 }));
        const { getByText } = renderPanel(stale);
        expect(getByText("2/4").className).toContain("text-danger-strong");
        expect(confirmDisabled(stale)).toBe(true);
    });

    it("never sends a stored tombstone entry back to setDamageAssignment", () => {
        const { getByText } = renderPanel(
            view(["bears"], ([t]) => ({ wurm: 2, [t]: 0 }))
        );
        fireEvent.click(getByText("+"));
        expect(setDamageAssignment).toHaveBeenCalledWith(
            expect.objectContaining({ assignments: { wurm: 3 } })
        );
    });

    it("enables Confirm on the engine's own default", () => {
        expect(confirmDisabled(view(["bears"]))).toBe(false);
    });

    it("a trampler keeps its Defending Player row beside the live blocker (CR 702.19b)", () => {
        const { getByText, getAllByText } = renderPanel(
            view(["wurm"], undefined, ["trample"])
        );
        expect(getByText("Grizzly Bears")).toBeTruthy();
        expect(getByText("Defending Player")).toBeTruthy();
        expect(getAllByText("+")).toHaveLength(2);
        expect(getByText("4/4")).toBeTruthy();
    });

    it("with every blocker gone, says so, shows no row, and Confirm is enabled", () => {
        const gone = view(["bears", "wurm"]);
        const { getByText, queryByText } = renderPanel(gone);
        expect(getByText("No creatures left to assign damage to")).toBeTruthy();
        expect(queryByText("+")).toBeNull();
        expect(confirmDisabled(gone)).toBe(false);
    });
});
