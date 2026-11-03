// CR 702.171b — a SADDLED permanent is marked on the board, read off the wire.
//
// A Mount's own abilities read the designation ("if this creature isn't
// saddled"), and it ends at cleanup (CR 514.2) — so the board must show it
// while it holds and drop it after. The card the badge reads is the one
// `projectPublicState` produces from a real GRE state, saddled through the
// real `becomeSaddledOnCard` writer and cleared by the real cleanup step.
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
import { becomeSaddledOnCard, type GameState } from "@convex/gre/state";
import { finalizeCleanup } from "@convex/gre/phases";
import SaddledBadge from "../saddled-badge";

afterEach(cleanup);

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(getCardByName("Caustic Bronco").id, {
                        id: "bronco",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function projected(state: GameState): CardInstance {
    return projectPublicState(state, 1, "p2").players[0]
        .battlefield[0] as unknown as CardInstance;
}

describe("SaddledBadge (CR 702.171b)", () => {
    it("marks a saddled Mount, for the opponent too", () => {
        const state = board();
        becomeSaddledOnCard(state.players[0].battlefield[0]);
        const { container } = render(<SaddledBadge card={projected(state)} />);
        const badge = container.querySelector('[data-saddled="true"]');
        expect(badge).not.toBeNull();
        expect(badge!.textContent).toBe("Saddled");
    });

    it("shows nothing on an unsaddled Mount", () => {
        const { container } = render(
            <SaddledBadge card={projected(board())} />
        );
        expect(container.querySelector("[data-saddled]")).toBeNull();
    });

    it("is gone after the cleanup step (CR 514.2)", () => {
        const state = board();
        becomeSaddledOnCard(state.players[0].battlefield[0]);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        const { container } = render(<SaddledBadge card={projected(state)} />);
        expect(container.querySelector("[data-saddled]")).toBeNull();
    });
});
