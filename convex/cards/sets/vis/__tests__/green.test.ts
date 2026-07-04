// VIS — per-card behavior tests for green cards in
// `convex/cards/sets/vis/green.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { naturalOrder } from "../green";
import { grizzlyBears } from "../../lea/green";
import { forest } from "../../lea/colorless";
import { makePlayer, makeState, pushSpell } from "../../../__tests__/setup";
import { makeInstance } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

describe("Natural Order (CR 117.9 additional cost / 701.19 / 400.7 / 701.20)", () => {
    it("declares the sacrifice-a-green-creature additional cost", () => {
        expect(naturalOrder.additionalCosts?.sacrificeFilter).toEqual({
            types: "Creature",
            colors: "G",
        });
    });

    it("searches for a green creature card and puts it onto the battlefield", () => {
        const libBear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libForest = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [libBear, libForest] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, naturalOrder.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        // Only the green creature matches — the Forest (a land, no color)
        // does not.
        expect(head.candidateIds).toEqual(["bear1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["bear1"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "bear1"
        );
        expect(state.players[0].library.map((c) => c.id)).toEqual(["forest1"]);
    });
});
