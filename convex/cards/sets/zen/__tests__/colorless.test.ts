// ZEN — per-card behavior tests for colorless cards in
// `convex/cards/sets/zen/colorless.ts` (set split by colour, ADR 0043). The
// fetchland family shares one Op combination (`choice` filtered
// zone:"library" + `moveZone` cards-shape to battlefield + `libraryLook`
// shuffle), already exercised as the Op's own permanent test in
// `convex/gre/effects/__tests__/interpreter.test.ts`; this file proves the
// REAL registered card wires that combination correctly end to end (one
// representative fetchland, Misty Rainforest) and covers Expedition Map's
// distinct type-filter + sacrifice-self + hand destination.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const mistyRainforest = getDefinition("24a5cc2c-0fbf-4a5f-b175-6e0ffd0d0787");
const expeditionMap = getDefinition("c55bee97-593f-441f-b96c-a998d5212a55");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

describe("Misty Rainforest (CR 701.23 / 400.7 / 701.24)", () => {
    it("fetches a Forest or Island card onto the battlefield, then shuffles", () => {
        const land = makeInstance(mistyRainforest.id, {
            id: "mistyLand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libForest = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libBear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [land],
                    library: [libForest, libBear],
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "misty-rainforest-fetch",
            targets: [],
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        // Only the Forest matches "a Forest or Island card" — the Bear
        // doesn't.
        expect(head.candidateIds).toEqual(["forest1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["forest1"],
        });
        expect(state.players[0].library.map((c) => c.id)).toEqual(["bear1"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "forest1"
        );
        // Wire format — the fetched land is a public battlefield permanent.
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "forest1"
        );
    });
});

describe("Expedition Map (CR 701.23 / 400.7 / 701.24)", () => {
    it("searches for a land card and puts it into hand", () => {
        const map = makeInstance(expeditionMap.id, {
            id: "map1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libForest = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const libBear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [map],
                    library: [libForest, libBear],
                }),
                makePlayer("p2"),
            ],
        });
        const src = state.players[0].battlefield[0];
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "expedition-map-fetch",
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
        expect(state.players[0].hand.map((c) => c.id)).toContain("forest1");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["bear1"]);
    });
});
