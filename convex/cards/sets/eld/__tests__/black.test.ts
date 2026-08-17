// ELD — per-card behavior tests for black cards in
// `convex/cards/sets/eld/black.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { wishclawTalisman } from "../black";
import { forest } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

describe("Wishclaw Talisman (CR 122 counters / 701.23 / 400.7 / 701.24 / 613.1b)", () => {
    it("enters with three wish counters as it enters, with nothing on the stack (CR 121.6 / 614.1c)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, wishclawTalisman.id, "p1");
        resolveTopOfStack(state);

        const permanent = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === wishclawTalisman.id
        );
        // The counters are there the first time the permanent is observable…
        expect(permanent?.counters?.wish).toBe(3);
        // …and the placement created NO stack item to respond to, even after
        // the engine drains the PERMANENT_ENTERED event through its trigger
        // scan — the clause is not an ability, so nothing is collected.
        expect(state.stack).toEqual([]);
        processPendingActionTriggers(state);
        expect(state.stack).toEqual([]);
        // Its activation cost (remove a wish counter) is payable immediately.
        expect(permanent?.counters?.wish).toBeGreaterThanOrEqual(1);

        // Wire format — the "no intermediate zero state" criterion is a
        // client-visible one, so re-run it THROUGH the projection.
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === permanent!.id
        );
        expect(slim?.counters?.wish).toBe(3);
        expect(projected.stack).toEqual([]);
    });

    it("searches for a card, puts it into hand, then gives control to an opponent", () => {
        const talisman = makeInstance(wishclawTalisman.id, {
            id: "talisman1",
            controllerId: "p1",
            ownerId: "p1",
            counters: { wish: 3 },
        });
        const libForest = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [talisman],
                    library: [libForest],
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "wishclaw-talisman-wish",
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["forest1"],
        });
        expect(state.players[0].hand.map((c) => c.id)).toContain("forest1");
        // Control passed to the opponent (CR 613.1b) — the Talisman now sits
        // on p2's battlefield.
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "talisman1"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "talisman1"
        );
    });
});
