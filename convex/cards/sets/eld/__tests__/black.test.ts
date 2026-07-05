// ELD — per-card behavior tests for black cards in
// `convex/cards/sets/eld/black.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { wishclawTalisman } from "../black";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

describe("Wishclaw Talisman (CR 122 counters / 701.19 / 400.7 / 701.20 / 613.1b)", () => {
    it("enters with three wish counters (CR 603.6a ETB)", () => {
        const talisman = makeInstance(wishclawTalisman.id, {
            id: "talisman1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [talisman] }),
                makePlayer("p2"),
            ],
        });
        // Fire the self ETB trigger (mirrors collectTriggers + buildTriggerItem).
        state.stack.push({
            ...talisman,
            id: "trig-wishclaw-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "wishclaw-talisman-etb-counters",
            triggerSourceId: "talisman1",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "talisman1",
                controllerId: "p1",
                types: talisman.types,
            },
            targets: [],
        });
        resolveTopOfStack(state);
        const permanent = state.players[0].battlefield.find(
            (c) => c.id === "talisman1"
        );
        expect(permanent?.counters?.wish).toBe(3);
        // Wire format — counters are public battlefield state.
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "talisman1"
        );
        expect(slim?.counters?.wish).toBe(3);
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
