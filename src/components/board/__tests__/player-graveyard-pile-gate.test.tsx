// Graveyard PILE gate (CR 108.4a — issue #2202). Whether a pile accepts
// target clicks is decided by the shared `matchesBattlefieldController`, with
// the pile's OWNER standing in as the controller. The assertion runs through
// the reducer: a real `GameState` with a parked graveyard `pendingTarget`,
// pushed through `projectPublicState`, drives the real `PlayerGraveyard` and
// `CardsPile`, so a dropped `controller` or `activePlayerId` reds here too.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import type { PendingTarget } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { renderWithBoardContext } from "~/lib/testing/board-context";
import PlayerGraveyard from "../player-graveyard";

const selectTarget = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => selectTarget,
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));

const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";

/** A `{p1, p2}` board, `p1` active, `chooser` holding a graveyard target under
 *  `controller`, projected for the chooser. Each graveyard holds one card. */
function projectedTarget(
    chooser: "p1" | "p2",
    controller: PendingTarget["controller"]
) {
    const graveyardCard = (ownerId: string) =>
        makeInstance(MOUNTAIN, {
            id: `gy-${ownerId}`,
            controllerId: ownerId,
            ownerId,
            zone: "graveyard",
        });
    const state = makeState({
        players: [
            makePlayer("p1", { graveyard: [graveyardCard("p1")] }),
            makePlayer("p2", { graveyard: [graveyardCard("p2")] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: chooser,
        pendingTarget: {
            playerId: chooser,
            cardInstanceId: "source",
            targetType: "card",
            zone: "graveyard",
            controller,
            count: 1,
            selected: [],
        },
    });
    return projectPublicState(state, 1, chooser);
}

/** Mounts `owner`'s open pile as the chooser sees it; true when its card is a
 *  target button, which then submits the pile's owner. */
function pileAcceptsTarget(
    chooser: "p1" | "p2",
    controller: PendingTarget["controller"],
    owner: "p1" | "p2"
): boolean {
    cleanup();
    selectTarget.mockClear();
    const wire = projectedTarget(chooser, controller);
    const players = wire.players as unknown as Player[];
    renderWithBoardContext(
        <PlayerGraveyard
            player={players.find((p) => p.id === owner)!}
            open
            onOpenChange={() => {}}
        />,
        {
            ctx: {
                playerId: chooser,
                activePlayerId: wire.activePlayerId,
                pendingTarget: wire.pendingTarget,
                allPlayers: players,
                onSwitchGame: () => {},
            },
        }
    );
    const button = screen.getByTestId("card-image").closest("button");
    if (!button) return false;
    fireEvent.click(button);
    expect(selectTarget).toHaveBeenCalledTimes(1);
    expect(selectTarget.mock.calls[0][0]).toMatchObject({
        playerId: chooser,
        targetType: "graveyard-card",
        targetId: `gy-${owner}`,
        targetPlayerId: owner,
    });
    return true;
}

describe("PlayerGraveyard pile gate (issue #2202, CR 108.4a)", () => {
    beforeEach(() => {
        cleanup();
    });

    it.each([
        ["the active chooser", "p1", { p1: true, p2: false }],
        ["the non-active chooser", "p2", { p1: true, p2: false }],
    ] as const)(
        'controller "active" opens only the active player\'s pile for %s',
        (_label, chooser, expected) => {
            expect(pileAcceptsTarget(chooser, "active", "p1")).toBe(
                expected.p1
            );
            expect(pileAcceptsTarget(chooser, "active", "p2")).toBe(
                expected.p2
            );
        }
    );

    it.each([
        ["you", "p2", { p1: false, p2: true }],
        ["opponent", "p2", { p1: true, p2: false }],
        ["any", "p2", { p1: true, p2: true }],
        [undefined, "p2", { p1: true, p2: true }],
    ] as const)(
        "controller %s keeps its pile relationship for chooser %s",
        (controller, chooser, expected) => {
            expect(pileAcceptsTarget(chooser, controller, "p1")).toBe(
                expected.p1
            );
            expect(pileAcceptsTarget(chooser, controller, "p2")).toBe(
                expected.p2
            );
        }
    );
});
