// Planeshift (PLS) — blue behavior tests (ADR 0043 colour split, issue #1945).
//
// Planar Overlay uses the NEW `chooseCategorized` Op (issue #1945). The
// interpreter suite (`gre/effects/__tests__/interpreter.test.ts`) covers the
// Op's general shape (hand/battlefield, sweep, bipartite matching, both
// auto-resolve paths); this file proves the CARD's own script end to end
// through the real resolution path, symmetric across BOTH players in one
// cast (CR 601.2b "each player", APNAP order via `forEach { set: "players"
// }`).

import { describe, it, expect } from "vitest";
import { planarOverlay } from "../blue";
import { plains, island, tundra, mountain } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

function submitCategorized(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("Planar Overlay (CR 601.2b / 701.10, issue #1945)", () => {
    it("each player returns one land of each basic land type they control, a dual covering two types at once, in APNAP order", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p1-plains",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        // A Plains/Island dual — one physical land can cover
                        // BOTH categories in the same nomination.
                        makeInstance(tundra.id, {
                            id: "p1-tundra",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        // An untouched extra Plains — no `sweep`, so it must
                        // survive regardless of which land answers "Plains".
                        makeInstance(plains.id, {
                            id: "p1-plains2",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        // TWO Mountains — a real "which one" decision (a
                        // single candidate would auto-resolve with no
                        // prompt, per the forced-pick path).
                        makeInstance(mountain.id, {
                            id: "p2-mountain-a",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                        makeInstance(mountain.id, {
                            id: "p2-mountain-b",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, planarOverlay.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();

        // APNAP: the active player (p1, the caster) answers first.
        let head = state.pendingChoices![0];
        expect(head.playerId).toBe("p1");
        expect(head.kind).toBe("choose-categorized");
        expect(head.zone).toBe("battlefield");
        // The dual covers BOTH Plains and Island at once, so the maximum
        // matching over three lands under five categories is exactly 2 (the
        // plain Plains for "Plains", the dual for "Island" — or the reverse;
        // either way only 2 distinct physical lands can ever be nominated).
        expect(head.count).toEqual({ min: 2, max: 2 });
        submitCategorized(state, ["p1-plains", "p1-tundra"]);

        // p2 answers next — two Mountains, a real decision (Mountain has 2
        // candidates, so this is NOT the forced-pick path).
        head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.count).toEqual({ min: 1, max: 1 });
        submitCategorized(state, ["p2-mountain-a"]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        // p1: the nominated lands bounce to hand; the untouched extra Plains
        // stays on the battlefield (no `sweep` — Oracle text never mentions
        // the rest).
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual(
            ["p1-plains", "p1-tundra"].sort()
        );
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-plains2",
        ]);
        // p2: the nominated Mountain bounces; the other Mountain is
        // untouched (no `sweep`).
        expect(state.players[1].hand.map((c) => c.id)).toEqual([
            "p2-mountain-a",
        ]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "p2-mountain-b",
        ]);

        // Wire format: the projection agrees with the fat state for both
        // viewers (ADR 0045 GRE testing convention).
        const projectedP1 = projectPublicState(state, 1, "p1");
        expect(projectedP1.players[0].hand.map((c) => c?.id).sort()).toEqual(
            ["p1-plains", "p1-tundra"].sort()
        );
        expect(projectedP1.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-plains2",
        ]);
        expect(projectedP1.players[1].battlefield.map((c) => c.id)).toEqual([
            "p2-mountain-b",
        ]);
    });

    it("auto-resolves with no prompt for a player with no basic-typed land at all", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(island.id, {
                            id: "p1-island",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                // p2 controls no land at all — the forced/zero-branch skip
                // must not raise a picker for them.
                makePlayer("p2"),
            ],
        });
        pushSpell(state, planarOverlay.id, "p1");
        // p1's single Island is a forced, non-branching pick (one category,
        // one candidate) — auto-resolves; p2 has nothing at all — also
        // auto-resolves. The whole spell completes with no suspend.
        expect(resolveTopOfStack(state)).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-island"]);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].hand).toHaveLength(0);
    });
});
