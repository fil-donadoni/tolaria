// Per-card behavior tests for EOE blue cards (`convex/cards/sets/eoe/blue.ts`).
// Consult the Star Charts exercises the Kicker capability (CR 702.33) + the
// `digToHand` Op with a `count` look size (lands you control): put one card into
// hand, or two when kicked. The digToHand mechanics are proven generically in
// interpreter.test.ts; here we assert the look size and take count are wired.

import { describe, it, expect } from "vitest";
import { consultTheStarCharts } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { plains, grizzlyBears } from "../../lea";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const lands = (n: number) =>
    Array.from({ length: n }, (_, i) =>
        makeInstance(plains.id, {
            id: `land-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );

const library = (ids: string[]) =>
    ids.map((cid) =>
        makeInstance(grizzlyBears.id, {
            id: cid,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

function submitKeep(state: GameState, keep: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: keep,
    });
}

describe("Consult the Star Charts (Kicker {1}{U}, CR 702.33 / 401.4)", () => {
    it("looks at the top X cards where X is lands you control, keeping one unkicked", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: lands(2),
                    library: library(["a", "b", "c"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, consultTheStarCharts.id, "p1");
        // Suspends on a look-top pick over exactly the top 2 (= lands).
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].candidateIds?.length).toBe(2);
        submitKeep(state, ["a"]);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
        expect(state.players[0].hand.length).toBe(1);
    });

    it("keeps two cards when kicked", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: lands(3),
                    library: library(["a", "b", "c", "d"]),
                }),
                makePlayer("p2"),
            ],
        });
        const item: StackItem = pushSpell(state, consultTheStarCharts.id, "p1");
        item.kickerPayments = { kicker: 1 };
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices![0].candidateIds?.length).toBe(3);
        submitKeep(state, ["a", "b"]);
        expect(state.players[0].hand.length).toBe(2);
    });
});
