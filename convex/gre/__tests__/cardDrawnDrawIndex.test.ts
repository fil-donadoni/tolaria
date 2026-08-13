// `CardDrawnEvent.drawIndexThisTurn` stamping (CR 121.1, issue #781) —
// mechanism tests for `emitCardDrawn` (`gre/state.ts`). Distinct from the
// replacement-side `DrawReplacementEvent.drawIndexThisTurn` (already tested
// in `drawReplacement.test.ts`): this is the TRIGGER-side ordinal, read by
// `nthDrawThisTurn` (`cards/abilities/triggers/drawTrigger.ts`, unit-tested
// in its own `__tests__/drawTrigger.test.ts`). Mirrors the shape of
// `spellCastPerPlayerCount.test.ts`, the per-player spell-cast counter's own
// plumbing test (issue #1343).

import { describe, it, expect } from "vitest";
import { makeInstance, makeState } from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards/index";
import { emitCardDrawn, commitDrawPlan, drawCard, getPlayer } from "../state";
import { advancePhase } from "../phases";

function makeLibrary(n: number, playerId = "p1") {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(getCardByName("Squire").id, {
            id: `lib-${playerId}-${i}`,
            controllerId: playerId,
            ownerId: playerId,
            zone: "library",
        })
    );
}

describe("emitCardDrawn drawIndexThisTurn stamping (CR 121.1, issue #781)", () => {
    it("stamps successive single draws with incrementing indices (0, 1, 2, ...)", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(3);

        drawCard(p1);
        emitCardDrawn(state, "p1", 1, false);
        drawCard(p1);
        emitCardDrawn(state, "p1", 1, false);
        drawCard(p1);
        emitCardDrawn(state, "p1", 1, false);

        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        expect(draws.map((d) => d.drawIndexThisTurn)).toEqual([0, 1, 2]);
    });

    it("a batch draw (draw-3 in ONE emitCardDrawn call) emits indices n, n+1, n+2 — not three copies of the same value", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(3);

        // Mirrors `commitDrawPlan`'s "normal" branch (state.ts): drawCard is
        // called `plan.count` times, THEN emitCardDrawn is called once with
        // the actual drawn count.
        const drawn = commitDrawPlan(
            state,
            "p1",
            { kind: "normal", count: 3 },
            {
                isTurnBasedDrawStepDraw: false,
            }
        );
        expect(drawn).toBe(3);

        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        expect(draws).toHaveLength(3);
        expect(draws.map((d) => d.drawIndexThisTurn)).toEqual([0, 1, 2]);
    });

    it("a later batch continues the ordinal from where the turn's tally left off", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(5);

        drawCard(p1);
        emitCardDrawn(state, "p1", 1, false); // index 0
        commitDrawPlan(
            state,
            "p1",
            { kind: "normal", count: 2 },
            {
                isTurnBasedDrawStepDraw: false,
            }
        ); // indices 1, 2

        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        expect(draws.map((d) => d.drawIndexThisTurn)).toEqual([0, 1, 2]);
    });

    it("is scoped PER PLAYER — an opponent's draws don't advance this player's ordinal", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        const p2 = getPlayer(state, "p2");
        p1.library = makeLibrary(2, "p1");
        p2.library = makeLibrary(2, "p2");

        drawCard(p2);
        emitCardDrawn(state, "p2", 1, false);
        drawCard(p1);
        emitCardDrawn(state, "p1", 1, false);

        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        const p1Draw = draws.find((d) => d.playerId === "p1")!;
        const p2Draw = draws.find((d) => d.playerId === "p2")!;
        // Both are each player's OWN first draw this turn (index 0), even
        // though p1's draw is the second CARD_DRAWN event overall.
        expect(p1Draw.drawIndexThisTurn).toBe(0);
        expect(p2Draw.drawIndexThisTurn).toBe(0);
    });

    it("resets at the start of each turn, per player (mirrors landsPlayedThisTurn / spellsCastThisTurn's reset boundary)", () => {
        const state = makeState({ phase: "END_STEP", turn: 1 });
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(1);
        drawCard(p1);
        emitCardDrawn(state, "p1", 1, false);
        expect(p1.drawnThisTurn).toHaveLength(1);

        advancePhase(state); // END_STEP -> CLEANUP (auto) -> UNTAP (auto, new turn) -> UPKEEP
        expect(state.turn).toBe(2);
        expect(getPlayer(state, "p1").drawnThisTurn).toBeUndefined();

        // A fresh draw next turn is index 0 again.
        const p1After = getPlayer(state, "p1");
        p1After.library = makeLibrary(1);
        state.pendingEvents = [];
        drawCard(p1After);
        emitCardDrawn(state, "p1", 1, false);
        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        expect(draws[0].drawIndexThisTurn).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// `CardDrawnEvent.isTurnBasedDrawStepDraw` (CR 504.1, issue #2374) — the
// TRIGGER-side twin of `DrawReplacementEvent.isTurnBasedDrawStepDraw`. One
// test per row of the producer census in the PR description: every site that
// reaches `emitCardDrawn` must stamp the flag with the right value, and the
// two shapes that make `drawIndexThisTurn === 0` a WRONG stand-in for it
// (a draw before the draw step, a second draw step in one turn) are asserted
// as divergences, not equivalences.
// ---------------------------------------------------------------------------
describe("CardDrawnEvent.isTurnBasedDrawStepDraw (CR 504.1, issue #2374)", () => {
    // The DRAW-STEP leg (`performDrawStepDraw` → `commitDrawPlan` with
    // `isTurnBasedDrawStepDraw: true`) is not observable here: `advancePhase`
    // drains `pendingEvents` into the trigger scan inside the same call. It is
    // covered end to end by Orcish Bowmasters' own test
    // (`convex/cards/sets/ltr/__tests__/black.test.ts`), which advances a real
    // draw step and asserts the trigger does NOT fire on it while it DOES fire
    // on every other draw.
    it("an effect-driven draw is flagged false even when it is the player's FIRST draw of the turn (drawIndexThisTurn === 0 is NOT the same predicate)", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(2);

        // A spell's draw taken before the draw step: index 0, but not the
        // turn-based draw-step draw.
        commitDrawPlan(
            state,
            "p1",
            { kind: "normal", count: 1 },
            { isTurnBasedDrawStepDraw: false }
        );

        const draw = (state.pendingEvents ?? []).find(
            (e) => e.type === "CARD_DRAWN"
        )!;
        expect(draw.drawIndexThisTurn).toBe(0);
        expect(draw.isTurnBasedDrawStepDraw).toBe(false);
    });

    it("the turn-based draw stays flagged true even when it is NOT the player's first draw of the turn", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(3);

        // An instant-speed draw during the upkeep, then the draw step's draw.
        commitDrawPlan(
            state,
            "p1",
            { kind: "normal", count: 1 },
            { isTurnBasedDrawStepDraw: false }
        );
        commitDrawPlan(
            state,
            "p1",
            { kind: "normal", count: 1 },
            { isTurnBasedDrawStepDraw: true }
        );

        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        expect(draws.map((d) => d.drawIndexThisTurn)).toEqual([0, 1]);
        expect(draws.map((d) => d.isTurnBasedDrawStepDraw)).toEqual([
            false,
            true,
        ]);
    });

    it("a fanned-out turn-based batch flags only the FIRST card (CR 504.1 — the turn-based action draws exactly one card)", () => {
        const state = makeState();
        const p1 = getPlayer(state, "p1");
        p1.library = makeLibrary(3);

        commitDrawPlan(
            state,
            "p1",
            { kind: "normal", count: 3 },
            { isTurnBasedDrawStepDraw: true }
        );

        const draws = (state.pendingEvents ?? []).filter(
            (e) => e.type === "CARD_DRAWN"
        );
        expect(draws.map((d) => d.isTurnBasedDrawStepDraw)).toEqual([
            true,
            false,
            false,
        ]);
    });
});
