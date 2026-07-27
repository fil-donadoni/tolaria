// Delve GY-picker SURFACE test (CR 702.66 / 601.2g — issue #1336, ADR 0063).
//
// Mandatory per `.claude/rules/gre-development.md` § Frontend wiring analysis:
// the assertion runs THROUGH the reducer. The state is a real `GameState` with a
// parked delve `pendingCast`, pushed through `projectPublicState` — the exact
// wire shape the board hands `<CastExileCostDialog>`. A hand-built view would
// mask a dropped `offsetGeneric`, which is precisely the field the delve mode
// switches on, so it would not count.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import type { PendingCast } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

const submitted: unknown[] = [];
vi.mock("convex/react", () => ({
    useMutation: () => (args: unknown) => {
        submitted.push(args);
        return Promise.resolve();
    },
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { selectCastExileCost: {}, cancelCast: {} } },
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));

import CastExileCostDialog from "../cast-exile-cost-dialog";

const TREASURE_CRUISE = "7a59d4b1-6cf4-44ec-8a96-1bb7094fea21";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5";

/** A real GameState with a parked delve cast, projected onto the wire. Returns
 *  exactly what the board reads: the projected pendingCast picker + the
 *  projected viewer. */
function projectedDelveCast(offset: { min: number; max: number }) {
    const spell = makeInstance(TREASURE_CRUISE, {
        id: "cruise",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const graveyard = [
        makeInstance(MOUNTAIN, {
            id: "gy0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        }),
        makeInstance(ISLAND, {
            id: "gy1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        }),
        makeInstance(MOUNTAIN, {
            id: "gy2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        }),
    ];
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "cruise",
        manaCost: { X: 7, U: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 0,
            excludeInstanceId: "cruise",
            offsetGeneric: offset,
        },
    };
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [spell], graveyard }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
    const projected = projectPublicState(state, 1, "p1");
    return {
        choice: projected.pendingCast!.exileFromGraveyardChoice!,
        me: projected.players.find((p) => p.id === "p1") as unknown as Player,
    };
}

describe("CastExileCostDialog — delve variable-offset mode (CR 702.66)", () => {
    beforeEach(() => {
        cleanup();
        submitted.length = 0;
    });

    it("survives the projection and renders as a Delve picker, not a Flashback one", () => {
        const { choice, me } = projectedDelveCast({ min: 0, max: 3 });
        // The reducer kept the field the delve mode switches on.
        expect(choice.offsetGeneric).toEqual({ min: 0, max: 3 });

        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        expect(screen.getByText("Delve")).toBeTruthy();
        expect(
            screen.getAllByText(/Exile up to 3 card\(s\) from your graveyard/)
                .length
        ).toBeGreaterThan(0);
        // Every graveyard card is eligible fuel — delve has no colour filter.
        expect(screen.getAllByTestId("card-image")).toHaveLength(3);
    });

    it("lets the caster DECLINE delve entirely when nothing is forced", () => {
        const { choice, me } = projectedDelveCast({ min: 0, max: 3 });
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        const confirm = screen.getByRole("button", { name: /Exile 0\/3/ });
        expect((confirm as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(confirm);
        expect(submitted).toEqual([
            { gameId: "g", playerId: "p1", cardInstanceIds: [] },
        ]);
    });

    it("pre-seeds the FORCED minimum (Arena prompt policy, ADR 0063)", () => {
        const { choice, me } = projectedDelveCast({ min: 2, max: 3 });
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        expect(
            screen.getAllByText(/at least 2 required/).length
        ).toBeGreaterThan(0);
        const confirm = screen.getByRole("button", { name: /Exile 2\/3/ });
        expect((confirm as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(confirm);
        expect(submitted).toEqual([
            { gameId: "g", playerId: "p1", cardInstanceIds: ["gy0", "gy1"] },
        ]);
    });

    it("blocks confirming below the forced minimum", () => {
        const { choice, me } = projectedDelveCast({ min: 2, max: 3 });
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        // Deselect one of the two pre-seeded picks.
        fireEvent.click(screen.getAllByRole("button", { name: /Mountain/ })[0]);
        const confirm = screen.getByRole("button", { name: /Exile 1\/3/ });
        expect((confirm as HTMLButtonElement).disabled).toBe(true);
    });

    it("caps selection at max — delve never overpays the generic cost", () => {
        const { choice, me } = projectedDelveCast({ min: 0, max: 1 });
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        const cards = screen
            .getAllByTestId("card-image")
            .map((el) => el.parentElement as HTMLButtonElement);
        fireEvent.click(cards[0]);
        fireEvent.click(cards[1]);
        // The second click is refused: max is 1.
        expect(screen.getByRole("button", { name: /Exile 1\/1/ })).toBeTruthy();
    });
});
