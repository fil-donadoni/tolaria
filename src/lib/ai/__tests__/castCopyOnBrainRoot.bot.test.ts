// The client Brain resolves PROJECTED state (ADR 0074), and the projection strips
// `castCopySnapshot` while shipping `castCopiesRemaining`. A cast trigger's copy
// has to survive that: a Sage of the Skies (issue #3658) reads its source live
// off the stack (CR 707.10f), and a trigger of CR 702.40a Storm with no snapshot
// left copies nothing rather than throwing.
import { describe, expect, it } from "vitest";
import { preloadDefinitions } from "@convex/cards";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup.helper";
import { sageOfTheSkies } from "@convex/cards/sets/tdm/white.cards";
import { grapeshot } from "@convex/cards/sets/tsp/index.cards";
import { projectPublicState } from "@convex/gameProjections";
import {
    emitSpellCastEvent,
    resolveTopOfStack,
    type GameState,
} from "@convex/gre/state";
import { projectedToGameState } from "../state-adapter";

// Base-owned `data/catalogue` (ADR 0157) lacks a card this PR ships.
preloadDefinitions([sageOfTheSkies()]);

const table = (): GameState =>
    makeState({ players: [makePlayer("p1"), makePlayer("p2")] });

const brainRoot = (state: GameState): GameState =>
    projectedToGameState(projectPublicState(state, 1, "p1"));

describe("cast-trigger copies on the Brain's projected state", () => {
    it("a Sage cast as the second spell is copied from the stack", () => {
        const state = table();
        state.players[0].spellsCastThisTurn = 1;
        emitSpellCastEvent(state, pushSpell(state, sageOfTheSkies().id, "p1"));
        const root = brainRoot(state);

        for (let step = 0; step < 3; step++) resolveTopOfStack(root);

        expect(root.stack).toEqual([]);
        expect(
            root.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(1);
    });

    it("a Storm trigger with no snapshot left copies nothing, and does not throw", () => {
        const state = table();
        state.spellsCastThisTurn = 2;
        emitSpellCastEvent(
            state,
            pushSpell(state, grapeshot().id, "p1", [
                { type: "player", id: "p2" },
            ])
        );
        const root = brainRoot(state);
        const top = root.stack[root.stack.length - 1];
        expect(top.castCopiesRemaining).toBe(2);
        expect(top.castCopySnapshot).toBeUndefined();

        expect(() => resolveTopOfStack(root)).not.toThrow();
        expect(root.stack.filter((s) => s.isCopy)).toEqual([]);
    });
});
