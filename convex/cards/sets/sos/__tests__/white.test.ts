// Per-card behavior tests for SOS white cards (`convex/cards/sets/sos/white.ts`).
// Erode is a `resolve()` card (search-to-battlefield), so the full per-card
// regime applies. The regression this file locks down: "search your library
// for a BASIC land card" is the `Basic` SUPERTYPE (CR 205.4a), not a basic
// land SUBTYPE — a dual land must never be findable.

import { describe, it, expect } from "vitest";
import { erode } from "../white";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { forest, tundra } from "../../lea/colorless";
import { grizzlyBears } from "../../lea";

/** Answers the head `pendingChoices` entry (CR 608.2). */
function submitChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

function makeErodeState(): GameState {
    const victim = makeInstance(grizzlyBears.id, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [victim],
                library: [
                    makeInstance(forest.id, {
                        id: "lib-forest",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    }),
                    makeInstance(tundra.id, {
                        id: "lib-tundra",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "library",
                    }),
                ],
            }),
        ],
    });
}

describe("Erode (CR 701.8 destroy + CR 205.4a basic land card search)", () => {
    it("offers ONLY basic land cards — a dual land with basic land types is nonbasic", () => {
        const state = makeErodeState();
        pushSpell(state, erode.id, "p1", [{ type: "permanent", id: "victim" }]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the search
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.playerId).toBe("p2");
        expect(head.candidateIds).toContain("lib-forest");
        expect(head.candidateIds).not.toContain("lib-tundra");
    });

    it("destroys the target, then puts the chosen basic onto the battlefield tapped", () => {
        const state = makeErodeState();
        pushSpell(state, erode.id, "p1", [{ type: "permanent", id: "victim" }]);
        resolveTopOfStack(state);
        submitChoice(state, ["lib-forest"]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
        const found = state.players[1].battlefield.find(
            (c) => c.id === "lib-forest"
        );
        expect(found).toBeDefined();
        expect(found?.isTapped).toBe(true);
        expect(state.players[1].library).toHaveLength(1); // the dual stays put
    });
});
