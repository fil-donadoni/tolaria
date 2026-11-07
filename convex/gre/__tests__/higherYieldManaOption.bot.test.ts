// A source with several options of ONE colour: the planner funds the realisation
// the plan needs (CR 601.2g, CR 106.4).
//
// `planManaPayment` stores one option per colour, the first it meets. Fanatic of
// Rhonas exposes `{T}: Add {G}` and, under Ferocious, `{T}: Add {G}{G}{G}{G}`, so
// the larger option has to be reachable some other way or the gate offers a cast
// the Bot cannot pay and `enumerateCastMoves` silently drops it.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { tapSourceIntoPayment, tryAutoCommitPendingCast } from "../../game";
import { enumerateMoves, planManaPayment, type Move } from "../moves";
import { getLegalActions } from "../rules";
import { getPlayer } from "../state";
import type { CardInstanceState, GameState } from "../state";

const FANATIC = getCardByName("Fanatic of Rhonas").id;
const SERRA = getCardByName("Serra Angel").id; // 4/4 — Ferocious is on
const BEARS = getCardByName("Grizzly Bears").id; // 2/2, {1}{G}
const FOREST = getCardByName("Forest").id;
const PLAINS = getCardByName("Plains").id;

function permanent(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
    });
}

function position(
    battlefield: CardInstanceState[],
    hand: CardInstanceState[] = []
): GameState {
    const player = makePlayer("p1", { hand, battlefield });
    return {
        ...makeState({ players: [player, makePlayer("p2")] }),
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        stack: [],
    };
}

function bearsInHand(): CardInstanceState {
    return makeInstance(BEARS, {
        id: "hand-bears",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
}

function ferociousBoard(): CardInstanceState[] {
    return [permanent(FANATIC, "src"), permanent(SERRA, "angel")];
}

function castMove(
    state: GameState
): Extract<Move, { kind: "cast-spell" }> | undefined {
    return enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell"
    );
}

describe("a same-colour option of higher yield is fundable (CR 601.2g)", () => {
    it.each([
        ["{G}{G}", { G: 2 }],
        ["{1}{G}", { G: 1, X: 1 }],
        ["{G}{G}{G}{G}", { G: 4 }],
        ["{3}{G}", { G: 1, X: 3 }],
        ["{4}", { X: 4 }],
    ])("Ferocious funds %s with one activation of index 1", (_label, cost) => {
        const state = position(ferociousBoard());
        expect(planManaPayment(state, state.players[0], cost)).toEqual([
            { cardInstanceId: "src", manaChoiceIndex: 1 },
        ]);
    });

    it("a {G} plan keeps the smaller option", () => {
        const state = position(ferociousBoard());
        expect(planManaPayment(state, state.players[0], { G: 1 })).toEqual([
            { cardInstanceId: "src", manaChoiceIndex: 0 },
        ]);
    });

    // The yield is bounded by one activation, as for any burst source.
    it("one activation cannot pay a fifth mana or an off-colour pip", () => {
        const state = position(ferociousBoard());
        const player = state.players[0];
        expect(planManaPayment(state, player, { G: 5 })).toBeNull();
        expect(planManaPayment(state, player, { G: 4, X: 1 })).toBeNull();
        expect(planManaPayment(state, player, { W: 1, G: 1 })).toBeNull();
    });

    // No higher option on this board: the second pass is not licensed to invent
    // one.
    it("beside no creature of power 4 or greater, {G}{G} plans null", () => {
        const state = position([
            permanent(FANATIC, "src"),
            permanent(BEARS, "bears"),
        ]);
        const player = state.players[0];
        expect(planManaPayment(state, player, { G: 2 })).toBeNull();
        expect(planManaPayment(state, player, { G: 1 })).toEqual([
            { cardInstanceId: "src" },
        ]);
    });

    // Where the smaller option plus another source covers the cost, the higher
    // option stays unspent.
    it("a plan the smaller option covers does not reach for the larger one", () => {
        const state = position([...ferociousBoard(), permanent(FOREST, "f")]);
        const plan = planManaPayment(state, state.players[0], { G: 2 });
        expect(plan).toHaveLength(2);
        expect(plan).toContainEqual({
            cardInstanceId: "src",
            manaChoiceIndex: 0,
        });
        expect(plan).toContainEqual({ cardInstanceId: "f" });
    });

    // The surplus of the larger activation pays pips later than the one that
    // chose it, with the other source still paying its own colour.
    it("funds a mixed cost from another source plus the larger activation", () => {
        const state = position([...ferociousBoard(), permanent(PLAINS, "p")]);
        const plan = planManaPayment(state, state.players[0], {
            W: 1,
            G: 1,
            X: 2,
        });
        expect(plan).toHaveLength(2);
        expect(plan).toContainEqual({ cardInstanceId: "p" });
        expect(plan).toContainEqual({
            cardInstanceId: "src",
            manaChoiceIndex: 1,
        });
    });
});

describe("the castability gate and the Bot's enumeration agree (CR 601.2f)", () => {
    it("Ferocious on: both offer the {1}{G} cast", () => {
        const state = position(ferociousBoard(), [bearsInHand()]);
        const player = state.players[0];
        expect(getLegalActions(state, player, player.hand[0])).toContain(
            "cast"
        );
        expect(castMove(state)?.cardInstanceId).toBe("hand-bears");
    });

    it("Ferocious off: neither offers it", () => {
        const state = position(
            [permanent(FANATIC, "src"), permanent(BEARS, "bears")],
            [bearsInHand()]
        );
        const player = state.players[0];
        expect(getLegalActions(state, player, player.hand[0])).not.toContain(
            "cast"
        );
        expect(castMove(state)).toBeUndefined();
    });

    // The plan the executor would submit is accepted by the server's own tap
    // primitives: the index resolves to the Ferocious ability and the surplus
    // floats (CR 106.4).
    it("the emitted plan commits the cast through the server's tap primitives", () => {
        const state = position(ferociousBoard(), [bearsInHand()]);
        const move = castMove(state)!;
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "hand-bears",
            manaCost: { X: 1, G: 1 },
            tappedLandIds: [],
        };
        for (const tap of move.tapPlan) {
            const player = getPlayer(state, "p1");
            const card = player.battlefield.find(
                (c) => c.id === tap.cardInstanceId
            )!;
            tapSourceIntoPayment(
                state,
                player,
                card,
                tap.manaChoiceIndex,
                state.pendingCast!.tappedLandIds
            );
            tryAutoCommitPendingCast(state, "p1");
            if (!state.pendingCast) break;
        }
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack.map((s) => s.id)).toContain("hand-bears");
        expect(getPlayer(state, "p1").manaPool.G).toBe(2);
    });
});
