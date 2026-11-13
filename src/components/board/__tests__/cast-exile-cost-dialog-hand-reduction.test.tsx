// Hand-exile cost-reduction picker SURFACE test (CR 601.2b / 601.2f — March of
// Otherworldly Light, issue #8625). The parked cast is a real `GameState`
// pushed through `projectPublicState`, so a dropped `zone` / `color` /
// `perCard` on the wire would fail here, not in a hand-built view.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import type { PendingCast } from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";

vi.mock("convex/react", () => ({
    useMutation: () => () => Promise.resolve(),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { selectCastExileCost: {}, cancelCast: {} } },
}));
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));

import CastExileCostDialog from "../cast-exile-cost-dialog";

const MARCH = getCardByName("March of Otherworldly Light")!.id;
const LION = getCardByName("Lion Sash")!.id; // white
const BLUE = "c6cc89b0-9acf-452b-ac1a-bc7e90eb32fc"; // Disrupt, blue

function projectedHandCast() {
    const mk = (id: string, def: string) =>
        makeInstance(def, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "march",
        manaCost: { X: 4, W: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 0,
            excludeInstanceId: "march",
            zone: "hand",
            color: "W",
            offsetGeneric: { min: 0, max: 2, perCard: 2 },
        },
    };
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    mk("march", MARCH),
                    mk("w0", LION),
                    mk("w1", LION),
                    mk("b0", BLUE),
                ],
            }),
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

describe("CastExileCostDialog — hand cost-reduction mode (CR 601.2f)", () => {
    beforeEach(() => cleanup());

    it("lists only the white hand cards and prices each at {2}", () => {
        const { choice, me } = projectedHandCast();
        expect(choice.offsetGeneric).toEqual({ min: 0, max: 2, perCard: 2 });
        render(
            <CastExileCostDialog
                choice={choice}
                me={me}
                gameId={"g" as never}
                playerId="p1"
            />
        );
        expect(screen.getByText("Exile cards to reduce the cost")).toBeTruthy();
        expect(
            screen.getAllByText(
                /Exile up to 2 card\(s\) from your hand — each pays for \{2\}/
            ).length
        ).toBeGreaterThan(0);
        // w0, w1 are eligible; the blue card and the spell itself are not.
        expect(screen.getAllByTestId("card-image")).toHaveLength(2);
    });
});
