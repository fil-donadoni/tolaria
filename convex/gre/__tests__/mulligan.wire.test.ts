// Wire format tests for the mulligan phase (CR 103.5). The projection layer
// strips card definitions and reshapes hidden zones — these tests verify that
// the mulligan struct and its bottoming PendingChoice survive the projection
// intact for both the viewer and the opponent.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../gameProjections";
import { makeMulliganState, recordDeclaration } from "../mulligan";
import type { GameState } from "../state";
import type { Phase } from "../types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const STARTING_HAND_SIZE = 7;
const ARMAGEDDON_ID = "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb";

function makeMulliganGame(): GameState {
    const buildPlayer = (id: string) => {
        const library = Array.from({ length: 60 }, (_, i) =>
            makeInstance(ARMAGEDDON_ID, {
                id: `${id}-card-${i}`,
                controllerId: id,
                ownerId: id,
                zone: "library",
            })
        );
        const hand = library.splice(0, STARTING_HAND_SIZE).map((c) => ({
            ...c,
            zone: "hand" as const,
        }));
        return makePlayer(id, { hand, library });
    };
    const state = makeState({
        players: [buildPlayer("p1"), buildPlayer("p2")],
        phase: "MULLIGAN" as Phase,
        rngSeed: 7,
        rngCounter: 0,
        priorityPlayerId: "p1",
    });
    state.mulligan = makeMulliganState(state);
    return state;
}

describe("mulligan wire format (CR 103.5)", () => {
    it("MulliganState projects intact and is visible to both viewers", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");

        const fromP1 = projectPublicState(state, 0, "p1");
        const fromP2 = projectPublicState(state, 0, "p2");

        for (const projected of [fromP1, fromP2]) {
            expect(projected.phase).toBe("MULLIGAN");
            expect(projected.mulligan?.mulligansTaken).toEqual([1, 0]);
            expect(projected.mulligan?.locked).toEqual([false, true]);
            expect(projected.mulligan?.declaringPlayerId).toBe("p1");
            expect(projected.mulligan?.bottoming).toBe(false);
        }
    });

    it("viewer sees their own hand and opponent's hand is masked during MULLIGAN", () => {
        const state = makeMulliganGame();
        const fromP1 = projectPublicState(state, 0, "p1");
        const p1View = fromP1.players[0];
        const p2View = fromP1.players[1];
        expect(p1View.hand).toHaveLength(STARTING_HAND_SIZE);
        expect(p1View.hand.every((c) => c !== null)).toBe(true);
        expect(p2View.hand).toHaveLength(STARTING_HAND_SIZE);
        expect(p2View.hand.every((c) => c === null)).toBe(true);
    });

    it("legalActions on hand cards are empty during MULLIGAN", () => {
        const state = makeMulliganGame();
        const projected = projectPublicState(state, 0, "p1");
        const p1Hand = projected.players[0].hand;
        for (const card of p1Hand) {
            expect(card?.legalActions).toEqual([]);
        }
    });

    it("library count updates after bottoming and projects correctly", () => {
        const state = makeMulliganGame();
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");

        // Before bottoming: 53 in library, 7 in hand.
        const before = projectPublicState(state, 0, "p1");
        expect(before.players[0].library.count).toBe(53);
        expect(before.players[0].hand).toHaveLength(7);

        // Pending choice for p1 is visible in projection.
        expect(before.pendingChoices).toHaveLength(1);
        expect(before.pendingChoices?.[0]).toMatchObject({
            kind: "mulligan-bottom",
            playerId: "p1",
            count: 1,
        });
    });
});
