// Bot reachability for Sage of the Skies (issue #3658): the cast is enumerated,
// raises no choice, and the search sandbox plays out the same trigger, copy and
// token the server does, so a rollout sees what the second spell is worth.
//
// Lives in a `*.bot.test.ts` file because `convex/gre/search.ts` and
// `convex/gre/moves.ts` are declared bot modules.
import { describe, expect, it } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { resolveTopOfStack, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards";
import { plains } from "../../cards/sets/lea/index.cards";
import { sageOfTheSkies } from "../../cards/sets/tdm/white.cards";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([sageOfTheSkies()]);

function position(spellsAlreadyCast: number): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [0, 1, 2].map((i) =>
                    makeInstance(plains().id, {
                        id: `plains-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
                hand: [
                    makeInstance(sageOfTheSkies().id, {
                        id: "sage",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                spellsCastThisTurn: spellsAlreadyCast,
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

const castOf = (state: GameState) =>
    enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "sage"
    );

describe("Sage of the Skies in the Bot's search (CR 707.10f, issue #3658)", () => {
    it("the cast is enumerated", () => {
        expect(castOf(position(1))).toBeDefined();
    });

    it("the sandbox plays the second spell into a token and the original", () => {
        const state = position(1);
        applyMoveInSearch(state, "p1", castOf(state)!);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(
            state.stack.filter((s) => s.triggeredAbilityId !== undefined)
        ).toHaveLength(1);

        for (let step = 0; step < 3; step++) resolveTopOfStack(state);

        expect(state.stack).toEqual([]);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(1);
    });

    it("the sandbox plays the turn's first spell into one Sage, no trigger", () => {
        const state = position(0);
        applyMoveInSearch(state, "p1", castOf(state)!);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            undefined,
        ]);
    });
});
