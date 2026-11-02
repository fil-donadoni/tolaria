// WAR blue — Jace, Wielder of Mysteries (issue #3231).
//
// The draw-replacement `win` outcome is a new seam shape; its plan/commit unit
// coverage lives with the seam in `convex/gre/__tests__/drawReplacement.test.ts`.
// What is tested HERE is what only this card can prove: its controller-scoped,
// empty-library predicate gates the static correctly, every draw the two
// loyalty abilities make funnels through it, and the −8's trailing "then if
// your library has no cards in it" is a SEPARATE check from the static.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import {
    commitDrawPlan,
    planDrawStep,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { checkGameOverSBA } from "../../../../gre/sba";
import { jaceWielderOfMysteries } from "../blue.cards";

const JACE = jaceWielderOfMysteries().id;
/** Grizzly Bears — any registered card fills a library. */
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";
const PLUS1 = "jace-wielder-plus1";
const MINUS8 = "jace-wielder-minus8";

function libraryOf(ownerId: string, n: number): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(BEARS, {
            id: `${ownerId}-lib-${i}`,
            ownerId,
            controllerId: ownerId,
            zone: "library",
        })
    );
}

function jace(controllerId: string, loyalty = 4): CardInstanceState {
    return makeInstance(JACE, {
        id: `jace-${controllerId}`,
        controllerId,
        ownerId: controllerId,
        counters: { loyalty },
    });
}

/** p1 controls Jace (unless `withJace` is false); libraries as given. */
function board(opts: {
    p1Library: number;
    p2Library?: number;
    withJace?: boolean;
    p2Jace?: boolean;
    loyalty?: number;
}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                library: libraryOf("p1", opts.p1Library),
                battlefield:
                    opts.withJace === false ? [] : [jace("p1", opts.loyalty)],
            }),
            makePlayer("p2", {
                library: libraryOf("p2", opts.p2Library ?? 10),
                battlefield: opts.p2Jace ? [jace("p2")] : [],
            }),
        ],
    });
}

/** One draw by `playerId` through the single draw seam (ADR 0061). */
function drawOne(state: GameState, playerId: string): void {
    const plan = planDrawStep(state, playerId, 1, false);
    commitDrawPlan(state, playerId, plan, { isTurnBasedDrawStepDraw: false });
}

function activate(
    state: GameState,
    abilityId: string,
    targets: Parameters<typeof resolveActivated>[3] = []
): void {
    const source = state.players[0].battlefield.find(
        (c) => c.id === "jace-p1"
    )!;
    resolveActivated(state, source, abilityId, targets);
}

describe("Jace, Wielder of Mysteries — the static (CR 614.1a / 614.6)", () => {
    it("a draw from an empty library wins instead — never the CR 704.5b loss", () => {
        const state = board({ p1Library: 0 });
        drawOne(state, "p1");
        // CR 614.6 — the replaced draw never happened, so no attempt from an
        // empty library was ever made: the decked flag stays down.
        expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
        // The SBA sweep that follows does not overturn it (endGame is the
        // single first-writer-wins writer of `state.gameOver`).
        checkGameOverSBA(state);
        expect(state.gameOver?.winnerId).toBe("p1");
    });

    it("does nothing while the library still has a card: the draw is a plain draw", () => {
        const state = board({ p1Library: 1 });
        drawOne(state, "p1");
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.gameOver).toBeUndefined();
    });

    it("replaces only its controller's draw — an opponent's empty draw still decks them", () => {
        const state = board({ p1Library: 5, p2Library: 0 });
        drawOne(state, "p2");
        expect(state.players[1].hasDrawnFromEmpty).toBe(true);
        expect(state.gameOver).toBeUndefined();
        checkGameOverSBA(state);
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "decked",
        });
    });

    it("two Jaces: each replaces only its own controller's draw", () => {
        const state = board({ p1Library: 5, p2Library: 0, p2Jace: true });
        drawOne(state, "p2");
        expect(state.gameOver).toEqual({
            winnerId: "p2",
            loserId: "p1",
            reason: "alternate-win",
        });
    });

    it("functions only on the battlefield — without Jace the empty draw decks", () => {
        const state = board({ p1Library: 0, withJace: false });
        drawOne(state, "p1");
        expect(state.players[0].hasDrawnFromEmpty).toBe(true);
        checkGameOverSBA(state);
        expect(state.gameOver?.reason).toBe("decked");
        expect(state.gameOver?.loserId).toBe("p1");
    });
});

describe("Jace, Wielder of Mysteries — +1 (CR 606)", () => {
    it("target player mills two, then Jace's controller draws one", () => {
        const state = board({ p1Library: 3, p2Library: 5 });
        activate(state, PLUS1, [{ type: "player", id: "p2" }]);
        expect(state.players[1].library).toHaveLength(3);
        expect(state.players[1].graveyard).toHaveLength(2);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.gameOver).toBeUndefined();
    });

    it("milling yourself empty, the draw meets the static and wins", () => {
        const state = board({ p1Library: 2 });
        activate(state, PLUS1, [{ type: "player", id: "p1" }]);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        expect(state.gameOver?.winnerId).toBe("p1");
    });
});

describe("Jace, Wielder of Mysteries — −8 (CR 606, CR 104.3c)", () => {
    it("a short library draws what it can, and the failed draw meets the static", () => {
        const state = board({ p1Library: 3, loyalty: 8 });
        activate(state, MINUS8);
        // CR 104.3c — the draws that can happen do.
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].hasDrawnFromEmpty).toBeFalsy();
        expect(state.gameOver).toEqual({
            winnerId: "p1",
            loserId: "p2",
            reason: "alternate-win",
        });
    });

    it("the trailing win is its OWN check: seven cards exactly, no empty draw, still a win", () => {
        // Seven draws empty the library without a single attempt from an
        // empty one, so the static never fires — the `if` does.
        const state = board({ p1Library: 7, loyalty: 8 });
        activate(state, MINUS8);
        expect(state.players[0].hand).toHaveLength(7);
        expect(state.gameOver?.winnerId).toBe("p1");
    });

    it("the trailing check reads the library AFTER the draws: cards left, no win", () => {
        const state = board({ p1Library: 10, loyalty: 8 });
        activate(state, MINUS8);
        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[0].library).toHaveLength(3);
        expect(state.gameOver).toBeUndefined();
    });
});
