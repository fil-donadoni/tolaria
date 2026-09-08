// `choice.candidates` over a REVEALED hidden-zone set — the
// `choose-library-card` kind (issue #3205, Intuition).
//
// CR 400.2 says a library is a hidden zone "even if all the cards in one such
// zone happen to be revealed", which is exactly why the DSL refused
// `candidates` outside the battlefield: nothing in a hidden zone can be named
// ahead of the pick. CR 701.20a is the one principled exception — a card that
// was SHOWN to all players "remains revealed for as long as necessary to
// complete the parts of the effect that card is relevant to", so a set the
// script itself revealed IS public at the moment the pick is raised, and a
// FOREIGN chooser can only choose because they can see it.
//
// What this file pins, end to end through the REAL Intuition definition:
//  1. the pick is raised to the TARGET OPPONENT over the CONTROLLER's library,
//     narrowed to exactly the three revealed cards;
//  2. the WIRE — `projectPublicState` shows that opponent those three cards and
//     nothing else of the library. This is the seam that fails silently (a
//     library is `{ count }` on the wire, and the sparse `known[]` channel only
//     carries CONTIGUOUS runs from each end, so three cards found mid-library
//     reach the chooser through NOTHING unless the peek exposure is right), so
//     it is asserted through the projection, never a hand-built view;
//  3. the picked card lands in hand and the rest in the graveyard;
//  4. CR 701.23d — a library with fewer than three cards yields a shorter pick
//     rather than a failed spell.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    pushSpell,
} from "../../cards/__tests__/setup";
import { makeState as makeBareState } from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { resolveTopOfStack } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import type { GameState } from "../state";

const INTUITION = getCardByName("Intuition").id;
const ISLAND = getCardByName("Island").id;
const COUNTERSPELL = getCardByName("Counterspell").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

/** p1's library, top to bottom. p1 casts Intuition targeting p2. */
function stateWithLibrary(cardIds: string[]): GameState {
    return makeBareState({
        players: [
            makePlayer("p1", {
                library: cardIds.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `lib${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

const SIX_CARDS = [
    ISLAND,
    COUNTERSPELL,
    ISLAND,
    GRIZZLY_BEARS,
    COUNTERSPELL,
    ISLAND,
];

describe("Intuition — the pick is the OPPONENT's, over the CASTER's library (CR 701.20a)", () => {
    it("raises the search to the caster, then the pick to the target opponent, narrowed to the revealed three", () => {
        const state = stateWithLibrary(SIX_CARDS);
        pushSpell(state, INTUITION, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        // Step 1: the CASTER searches their own library.
        const search = head(state);
        expect(search.playerId).toBe("p1");
        expect(search.kind).toBe("search-library");
        answer(state, ["lib1", "lib3", "lib5"]);

        // Step 3: the pick belongs to the TARGET OPPONENT, reads the CASTER's
        // library, and offers exactly the three revealed cards — not the six.
        const pick = head(state);
        expect(pick, "the opponent's pick is raised").toBeDefined();
        expect(pick.playerId).toBe("p2");
        expect(pick.kind).toBe("choose-library-card");
        expect(pick.zone).toBe("library");
        expect(pick.zoneOwnerId).toBe("p1");
        expect([...(pick.candidateIds ?? [])].sort()).toEqual([
            "lib1",
            "lib3",
            "lib5",
        ]);
        // It is NOT a search: the opponent gets no look at the library.
        expect(pick.isSearch).toBeUndefined();
    });

    it("WIRE: the chooser sees exactly the three revealed cards and nothing else of the library", () => {
        const state = stateWithLibrary(SIX_CARDS);
        pushSpell(state, INTUITION, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Deliberately three INTERIOR cards: the sparse `known[]` channel only
        // carries CONTIGUOUS runs from each END, so picking lib1/lib2/lib3 out
        // of six leaves that channel empty and the peek is provably the ONLY
        // way these cards can reach the chooser.
        answer(state, ["lib1", "lib2", "lib3"]);

        // The CHOOSER's view of the CASTER's library.
        const chooserView = projectPublicState(state, 1, "p2");
        const casterSeat = chooserView.players.find((p) => p.id === "p1")!;
        expect(
            casterSeat.libraryPeek?.map((c) => c.id).sort(),
            "the revealed three reach the chooser"
        ).toEqual(["lib1", "lib2", "lib3"]);
        // …and nothing more: the library itself is still a count plus the
        // sparse known-runs channel, which carries none of these (they sit
        // mid-library, contiguous with neither end).
        expect(casterSeat.library.count).toBe(6);
        expect(casterSeat.library.known ?? []).toEqual([]);
        // The whole-library channel `search-library` uses is NOT populated:
        // the opponent is not searching.
        expect(casterSeat.librarySearch).toBeUndefined();

        // A THIRD party — here the caster themselves, who is not the chooser —
        // gets no peek at all from this choice.
        const casterOwnView = projectPublicState(state, 1, "p1");
        const ownSeat = casterOwnView.players.find((p) => p.id === "p1")!;
        expect(ownSeat.libraryPeek).toBeUndefined();
    });

    it("puts the chosen card into hand and the rest into the graveyard, then shuffles", () => {
        const state = stateWithLibrary(SIX_CARDS);
        pushSpell(state, INTUITION, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        answer(state, ["lib1", "lib3", "lib5"]);
        answer(state, ["lib3"]);

        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.hand.map((c) => c.id)).toEqual(["lib3"]);
        // The two unpicked cards. (The spell itself is on the stack in this
        // harness, not in the graveyard — `pushSpell` never put it in a zone.)
        expect(
            p1.graveyard.map((c) => c.id).filter((id) => id.startsWith("lib"))
        ).toEqual(["lib1", "lib5"]);
        expect(p1.library.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib2",
            "lib4",
        ]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });
});

describe("Intuition — CR 701.23d, a short library", () => {
    it("finds as many as possible rather than failing the spell", () => {
        const state = stateWithLibrary([ISLAND, COUNTERSPELL]);
        pushSpell(state, INTUITION, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);

        const search = head(state);
        expect(search.count, "clamped to the two cards that exist").toEqual(2);
        answer(state, ["lib0", "lib1"]);

        const pick = head(state);
        expect(pick.playerId).toBe("p2");
        expect([...(pick.candidateIds ?? [])].sort()).toEqual(["lib0", "lib1"]);
        answer(state, ["lib0"]);

        const p1 = state.players.find((p) => p.id === "p1")!;
        expect(p1.hand.map((c) => c.id)).toEqual(["lib0"]);
        expect(
            p1.graveyard.map((c) => c.id).filter((id) => id.startsWith("lib"))
        ).toEqual(["lib1"]);
        expect(p1.library).toHaveLength(0);
    });
});
