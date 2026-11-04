// CR 601.3 / 601.2b — the Bot's side of the exile cast route choice: a plotted
// {X} spell holding a grant is enumerated under BOTH routes, each priced by its
// own permission, so the executor announces what `announceCast` accepts.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import type { GameState } from "../state";

const HYDRA = getCardByName("Rock Hydra").id;
const MOUNTAIN = getCardByName("Mountain").id;

function board(withGrant: boolean): GameState {
    const hydra = makeInstance(HYDRA, {
        id: "hydra",
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
    });
    hydra.plottedOnTurn = 3;
    if (withGrant) hydra.castableFromExileBy = "p1";
    const state = makeState({
        players: [
            makePlayer("p1", {
                exile: [hydra],
                battlefield: Array.from({ length: 4 }, (_, i) =>
                    makeInstance(MOUNTAIN, {
                        id: `land${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
    state.turn = 5;
    state.phase = "PRECOMBAT_MAIN";
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    return state;
}

const castsOfHydra = (state: GameState) =>
    enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "hydra"
    );

describe("the Bot and a card's two exile cast routes (CR 601.2b, 107.3b)", () => {
    it("enumerates the free cast at X = 0 and the declined cast paying X", () => {
        const moves = castsOfHydra(board(true));
        const free = moves.filter((m) => !m.declineManaCostReplacement);
        const declined = moves.filter((m) => m.declineManaCostReplacement);
        expect(free.length).toBeGreaterThan(0);
        for (const m of free) {
            expect(m.chosenX ?? 0).toBe(0);
            expect(m.tapPlan ?? []).toHaveLength(0);
        }
        // {X}{R}{R} on four Mountains: X up to 2, paid by tapping them.
        expect(Math.max(...declined.map((m) => m.chosenX ?? 0))).toBe(2);
        const biggest = declined.find((m) => m.chosenX === 2)!;
        expect(biggest.tapPlan).toHaveLength(4);
    });

    it("enumerates no declined cast where the plotted permission stands alone", () => {
        const moves = castsOfHydra(board(false));
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.every((m) => !m.declineManaCostReplacement)).toBe(true);
    });

    it("enumeration leaves the card un-stamped", () => {
        const state = board(true);
        castsOfHydra(state);
        expect(
            state.players[0].exile[0].castDeclinedExileRoute
        ).toBeUndefined();
    });
});
