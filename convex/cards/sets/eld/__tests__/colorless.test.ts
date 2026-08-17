// ELD — per-card behavior tests for colorless cards in
// `convex/cards/sets/eld/colorless.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { fabledPassage } from "../colorless";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

describe("Fabled Passage (CR 701.23 / 400.7 / 701.24, issue #677)", () => {
    it("fetches a basic land card onto the battlefield TAPPED, then shuffles", () => {
        const land = makeInstance(fabledPassage.id, {
            id: "passageLand",
            controllerId: "p1",
            ownerId: "p1",
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
                    battlefield: [land],
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
            abilityId: "fabled-passage-fetch",
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["forest1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["forest1"],
        });
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "forest1"
        );
        expect(entered).toBeDefined();
        // `tapped: true` (issue #677) forces the entering land tapped.
        expect(entered?.isTapped).toBe(true);
    });
});
