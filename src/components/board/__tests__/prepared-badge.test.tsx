// CR 722.3a — a PREPARED permanent is marked on the board, read off the wire.
//
// The designation is what makes the permanent's prepare spell castable (its
// copy in exile, CR 722.3c), and casting that copy removes it — so the board
// must show it. The card the badge reads is the one `projectPublicState`
// produces from a real GRE state, never a hand-built view: a projection that
// dropped `prepared` would leave this test red.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { CardInstance } from "~/types/game";
import { projectPublicState } from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { becomePrepared, unprepare } from "@convex/gre/prepare";
import type { GameState } from "@convex/gre/state";
import PreparedBadge from "../prepared-badge";

afterEach(cleanup);

function board(sick: boolean): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(getCardByName("Skycoach Conductor").id, {
                        id: "conductor",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: sick,
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    becomePrepared(state, state.players[0].battlefield[0]);
    return state;
}

function projected(state: GameState): CardInstance {
    return projectPublicState(state, 1, "p2").players[0]
        .battlefield[0] as unknown as CardInstance;
}

describe("PreparedBadge (CR 722.3a)", () => {
    it("marks a prepared permanent, for the opponent too", () => {
        const { container } = render(
            <PreparedBadge card={projected(board(false))} />
        );
        const badge = container.querySelector('[data-prepared="true"]');
        expect(badge).not.toBeNull();
        expect(badge!.className).toContain("top-1");
    });

    it("steps below the summoning-sickness badge when both are live", () => {
        const { container } = render(
            <PreparedBadge card={projected(board(true))} />
        );
        expect(
            container.querySelector('[data-prepared="true"]')!.className
        ).toContain("top-7");
    });

    it("shows nothing once the permanent is unprepared (CR 722.3b)", () => {
        const state = board(false);
        unprepare(state, state.players[0].battlefield[0]);
        const { container } = render(<PreparedBadge card={projected(state)} />);
        expect(container.querySelector('[data-prepared="true"]')).toBeNull();
    });
});
