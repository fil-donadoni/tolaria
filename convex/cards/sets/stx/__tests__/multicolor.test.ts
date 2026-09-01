// Strixhaven (STX) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { expressiveIteration } from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

const lib = (ids: string[]) =>
    ids.map((id) =>
        makeInstance(expressiveIteration.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

function submit(state: ReturnType<typeof makeState>, ids: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("Expressive Iteration (look 3: hand / bottom / exile-playable; CR 401.4 / 601.3)", () => {
    it("puts one card to hand, one to bottom, exiles one (playable this turn)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: lib(["a", "b", "c", "d", "e"]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, expressiveIteration.id, "p1");

        // Top three are a, b, c. Suspends on the hand choice.
        expect(resolveTopOfStack(state)).toBeNull();
        submit(state, ["a"]); // a → hand
        // Suspends again on the bottom choice (b, c remain).
        submit(state, ["b"]); // b → bottom, c → exile

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["a"]);
        // c exiled and granted cast-from-exile.
        expect(p1.exile.map((c) => c.id)).toEqual(["c"]);
        // CR 305.9 (issue #1689) — oracle says "you may PLAY the exiled
        // card": a land drawn this way must be a legal land play, not merely
        // castable (a land is never cast).
        const exiledC = p1.exile.find((c) => c.id === "c")!;
        expect(exiledC.castableFromExileBy).toBe("p1");
        expect(exiledC.castableFromExileIncludesLand).toBe(true);
        // b sits at the very bottom; d, e (untouched) remain above it.
        const libIds = p1.library.map((c) => c.id);
        expect(libIds[libIds.length - 1]).toBe("b");
        expect(libIds).toEqual(["d", "e", "b"]);
    });

    it("with a single card in library, puts it into hand only", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["only"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, expressiveIteration.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull();
        submit(state, ["only"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["only"]);
        expect(state.players[0].library).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("wire format: hand gain and exile survive projection", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib(["a", "b", "c"]) }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, expressiveIteration.id, "p1");
        resolveTopOfStack(state);
        submit(state, ["a"]);
        submit(state, ["b"]);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(1);
        expect(projected.players[0].exile.length).toBe(1);
        // a to hand, b bottomed, c exiled → library has just b left.
        expect(projected.players[0].library.count).toBe(1);
    });
});
