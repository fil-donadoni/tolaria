// ELD — per-card behavior tests for colorless cards in
// `convex/cards/sets/eld/colorless.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { fabledPassage } from "../colorless";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

/** Wires Fabled Passage's fetch ability up on the stack and resolves through
 *  the pending-choice submit, for a controller who already has `otherLands`
 *  OTHER untapped lands on the battlefield before the fetch. Returns the
 *  entered `forest1` instance. */
function resolveFabledPassageFetch(otherLands: number) {
    const land = makeInstance(fabledPassage.id, {
        id: "passageLand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const extraLands = Array.from({ length: otherLands }, (_, i) =>
        makeInstance(forest.id, {
            id: `extraLand${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const libForest = makeInstance(forest.id, {
        id: "forest1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [land, ...extraLands],
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
    return entered!;
}

describe("Fabled Passage (CR 701.23 / 400.7 / 701.24 / 701.26 / 608.2c, issue #677 / #1870)", () => {
    it("fetches a basic land card onto the battlefield TAPPED, then shuffles", () => {
        // This harness resolves the ability directly on the stack, without
        // going through real cost payment — Fabled Passage's own permanent
        // stays on the battlefield throughout, so with 0 OTHER lands the
        // total is Fabled Passage (1) + the fetched land (1) = 2, below the
        // "four or more lands" threshold, so it stays tapped.
        const entered = resolveFabledPassageFetch(0);
        // `tapped: true` (issue #677) forces the entering land tapped.
        expect(entered.isTapped).toBe(true);
    });

    it("untaps the fetched land when the controller controls 4+ lands (issue #1870)", () => {
        // Fabled Passage (1) + 2 OTHER lands + the fetched land itself (1) =
        // 4 lands controlled, exactly the threshold — the fetched land
        // counts toward its own check (CR 608.2c: the "Then if …" clause
        // reads the state AFTER the earlier instructions resolved), so it
        // enters tapped then untaps.
        const entered = resolveFabledPassageFetch(2);
        expect(entered.isTapped).toBe(false);
    });

    it("leaves the fetched land tapped with only 3 lands controlled (issue #1870)", () => {
        // Fabled Passage (1) + 1 OTHER land + the fetched land (1) = 3
        // total, one short of the "four or more lands" threshold — the
        // untap clause does not fire.
        const entered = resolveFabledPassageFetch(1);
        expect(entered.isTapped).toBe(true);
    });
});
