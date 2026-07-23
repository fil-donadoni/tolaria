// Choice-nodes in ISMCTS — the Stifle + Phyrexian Dreadnought position
// (PRD #1423, issue #1425). Promoted from the throwaway spike
// `spike/choice-nodes-1258` (commit dd089d78), now asserting against the
// PRODUCTION seams (no flag): `decidingPlayer` / `enumerateMoves` /
// `applyMoveInSearch` treat a live `pendingChoice` as an in-tree decision node.
//
// Setup: P1 controls a Phyrexian Dreadnought (12/12) whose self-ETB trigger
// (CR 118 — "sacrifice it unless you sacrifice creatures with total power >= 12")
// is ON THE STACK, unresolved. P1 holds Stifle and has {U} available. Correct
// play: cast Stifle on P1's own trigger -> the Dreadnought never has to be
// sacrificed -> a free 12/12. Passing lets the trigger resolve, and every legal
// sacrifice answer loses the Dreadnought.
//
// Before choice-nodes the playout HALTED at the may-pay and scored that state as
// a terminal leaf with the Dreadnought still alive — an inflated ("lying")
// material margin for the losing line. Traversal makes the margin sound.

import { describe, it, expect } from "vitest";
import type { GameState } from "../state";
import { resolveTopOfStack } from "../state";
import {
    searchWithTrace,
    applyMoveInSearch,
    type SearchBudget,
    decidingPlayer,
} from "../search";
import { enumerateMoves } from "../moves";
import {
    makeState,
    makePlayer,
    makeInstance,
} from "../../cards/__tests__/setup";
import { phyrexianDreadnought } from "../../cards/sets/mir/colorless";
import { stifle } from "../../cards/sets/scg/blue";
import { applyBladeSetup } from "../ai/blade";

const SEED = 0xc0ffee;
const ITERATIONS = 1200;

/** P1: Dreadnought on the battlefield with its ETB trigger ON THE STACK
 *  (unresolved), Stifle in hand, {U} in pool, P1 has priority to respond. */
function buildResponseState(): GameState {
    const dread = makeInstance(phyrexianDreadnought.id, {
        id: "dread",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const stifleCard = makeInstance(stifle.id, {
        id: "stifle",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [dread],
                hand: [stifleCard],
                manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        activePlayerId: "p1",
        passCount: 0,
    });
    // Put the self-ETB trigger on the stack WITHOUT resolving it, so P1 holds
    // priority to respond. Issue #1487 / ADR 0070 §4: this used to be a
    // hand-built `StackItem` whose own comment admitted it "mirrors
    // processPendingActionTriggers" — a silent copy of engine logic. It now
    // runs the REAL emitter + collection/placement path via the blade
    // harness's `etb-trigger` setup step, which THROWS if the engine puts
    // nothing on the stack.
    applyBladeSetup(state, {
        label: "dreadnought-stifle response state",
        setup: [{ kind: "etb-trigger", card: "Phyrexian Dreadnought" }],
    });
    return state;
}

/** The same position advanced one step: the trigger has RESOLVED, so the
 *  `may-pay` pendingChoice is live — the choice node itself. */
function buildChoiceState(): GameState {
    const state = buildResponseState();
    resolveTopOfStack(state);
    return state;
}

/** 2-ply from-hand: Dreadnought in hand (+ optionally Stifle), {1}{U} of mana,
 *  P1 main phase, empty stack. Root decision: cast Dreadnought or not. */
function buildFromHand(withStifle: boolean): GameState {
    const dread = makeInstance(phyrexianDreadnought.id, {
        id: "dread",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const hand = [dread];
    if (withStifle) {
        hand.push(
            makeInstance(stifle.id, {
                id: "stifle",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
    }
    return makeState({
        players: [
            makePlayer("p1", {
                hand,
                // {1} for Dreadnought (paid by C) + {U} for Stifle.
                manaPool: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 1 },
            }),
            makePlayer("p2"),
        ],
        priorityPlayerId: "p1",
        activePlayerId: "p1",
        passCount: 0,
    });
}

function runSearch(state: GameState, iterations = ITERATIONS) {
    const budget: SearchBudget = { iterations, timeMs: 100_000 };
    return searchWithTrace(state, "p1", budget, SEED);
}

function marginOf(
    trace: ReturnType<typeof runSearch>["trace"],
    labelPart: string
): number {
    const c = trace?.candidates.find((x) => x.label.includes(labelPart));
    return c ? c.meanMargin : NaN;
}

describe("choice nodes — Stifle + Phyrexian Dreadnought (issue #1425)", () => {
    it("the live may-pay is an in-tree decision node, not a halt", () => {
        const choiceState = buildChoiceState();
        expect(choiceState.pendingChoices?.[0]?.kind).toBe("may-pay");
        // The chooser owes the decision (was `null` = halt before #1425).
        expect(decidingPlayer(choiceState)).toBe("p1");
        // Policy-pruned candidate set: decline + bounded accept variants — NOT
        // the combinatorial subset count of a `minTotalPower` threshold leg.
        const moves = enumerateMoves(choiceState, "p1");
        expect(moves.length).toBeGreaterThanOrEqual(2);
        expect(moves.length).toBeLessThanOrEqual(8);
        expect(moves.every((m) => m.kind === "may-pay")).toBe(true);
        expect(moves.some((m) => m.kind === "may-pay" && !m.accept)).toBe(true);
        expect(moves.some((m) => m.kind === "may-pay" && m.accept)).toBe(true);
    });

    it("a playout descends INTO and PAST the may-pay (no halt)", () => {
        const state = buildChoiceState();
        const { move } = runSearch(state, 80);
        expect(move?.kind).toBe("may-pay");
        // Applying it must clear the choice and resume the game (past the node).
        applyMoveInSearch(state, "p1", move!);
        expect(state.pendingChoices?.length ?? 0).toBe(0);
    });

    it("searchWithTrace chooses cast-Stifle on its own trigger", () => {
        const res = runSearch(buildResponseState());
        expect(res.move?.kind).toBe("cast-spell");
        if (res.move?.kind === "cast-spell") {
            expect(res.move.cardInstanceId).toBe("stifle");
        }
    });

    it("the naked-Dreadnought line's material margin is sound (no inflated halt-leaf)", () => {
        const naked = runSearch(buildFromHand(false));
        const mNaked = marginOf(naked.trace, "cast Phyrexian Dreadnought");
        // The halt-leaf lie was ~540 (the un-sacrificed 12/12 still on board).
        // With traversal the search SEES the sacrifice, so the margin collapses.
        expect(Number.isNaN(mNaked)).toBe(false);
        expect(mNaked).toBeLessThan(100);
    });

    it("a PROTECTED Dreadnought (Stifle in hand) is valued far above a naked one", () => {
        const mNaked = marginOf(
            runSearch(buildFromHand(false)).trace,
            "cast Phyrexian Dreadnought"
        );
        const mProtected = marginOf(
            runSearch(buildFromHand(true)).trace,
            "cast Phyrexian Dreadnought"
        );
        expect(mProtected).toBeGreaterThan(mNaked + 200);
    });
});
