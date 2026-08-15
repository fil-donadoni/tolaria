// Weatherlight (WTH) — black card behavior tests (ADR 0043 colour split).
// Each describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import { doomsday } from "../black";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    resolveTopOfStack,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getCardByName } from "../../../index";

const FOREST = getCardByName("Forest").id;

/** Submit the head pending choice (the per-set shim every colour-split test
 *  file carries — see `sets/atq/__tests__/helpers.ts`). */
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

const card = (id: string): CardInstanceState =>
    makeInstance(FOREST, {
        id,
        zone: "library",
        controllerId: "p1",
        ownerId: "p1",
    });

const inZone = (id: string, zone: "library" | "graveyard"): CardInstanceState =>
    makeInstance(FOREST, { id, zone, controllerId: "p1", ownerId: "p1" });

function doomsdayState(
    libraryIds: string[],
    graveyardIds: string[],
    life = 20
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                life,
                library: libraryIds.map((id) => card(id)),
                graveyard: graveyardIds.map((id) => inZone(id, "graveyard")),
            }),
            makePlayer("p2"),
        ],
    });
}

const ids = (cards: CardInstanceState[]): string[] => cards.map((c) => c.id);

describe("Doomsday (search library + graveyard for five, exile the rest, CR 701.23 / 701.13 / 401.4 / 119.3)", () => {
    it("keeps five cards across both zones, exiles the rest, stacks them in the chosen order and halves life", () => {
        const state = doomsdayState(
            ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"],
            ["g1", "g2", "g3"]
        );
        pushSpell(state, doomsday.id, "p1");
        resolveTopOfStack(state);

        // CR 701.23a — the searcher looks at the whole library. CR 701.23d:
        // five cards must be found, so with a 3-card graveyard the library
        // half is floored at 2.
        const searchHead = state.pendingChoices![0];
        expect(searchHead.kind).toBe("search-library");
        expect(searchHead.isSearch).toBe(true);
        expect(searchHead.count).toEqual({ min: 2, max: 5 });
        submitChoice(state, ["l3", "l1", "l7"]);

        // The graveyard half takes exactly the balance of the five.
        const graveHead = state.pendingChoices![0];
        expect(graveHead.kind).toBe("choose-graveyard-card");
        expect(graveHead.count).toBe(2);
        expect(graveHead.candidateIds).toEqual(["g1", "g2", "g3"]);
        submitChoice(state, ["g2", "g3"]);

        // CR 401.4 — "in any order": a separate ordering choice over exactly
        // the five kept cards, which now all sit in the library.
        const orderHead = state.pendingChoices![0];
        expect(orderHead.kind).toBe("reorder-library");
        expect(orderHead.count).toBe(5);
        expect([...(orderHead.candidateIds ?? [])].sort()).toEqual([
            "g2",
            "g3",
            "l1",
            "l3",
            "l7",
        ]);
        submitChoice(state, ["g3", "l7", "g2", "l1", "l3"]);

        const p1 = state.players[0];
        expect(ids(p1.library)).toEqual(["g3", "l7", "g2", "l1", "l3"]);
        // CR 701.13a — everything else in BOTH searched zones is exiled. The
        // graveyard is left holding only Doomsday itself (CR 608.2n — as the
        // final part of a sorcery's resolution it goes to its owner's
        // graveyard).
        expect(p1.graveyard.map((c) => c.card.id)).toEqual([doomsday.id]);
        expect(ids(p1.exile).sort()).toEqual([
            "g1",
            "l2",
            "l4",
            "l5",
            "l6",
            "l8",
        ]);
        // CR 119.3 — lose half of 20, rounded up.
        expect(p1.life).toBe(10);
        expect(state.stack).toHaveLength(0);
    });

    it("rounds the life loss UP on an odd life total (CR 119.3 / 107.1a)", () => {
        const state = doomsdayState(["l1", "l2"], [], 21);
        pushSpell(state, doomsday.id, "p1");
        resolveTopOfStack(state);

        // CR 701.23d "as many as possible" — only two cards exist, so the
        // search is a forced 2-of-2 and no graveyard prompt is raised.
        expect(state.pendingChoices![0].count).toEqual({ min: 2, max: 2 });
        submitChoice(state, ["l1", "l2"]);
        expect(state.pendingChoices![0].kind).toBe("reorder-library");
        submitChoice(state, ["l2", "l1"]);

        const p1 = state.players[0];
        expect(ids(p1.library)).toEqual(["l2", "l1"]);
        expect(p1.exile).toEqual([]);
        expect(p1.life).toBe(10); // 21 → lose 11
    });

    it("clamps to however many cards exist across the two zones (CR 701.23d)", () => {
        const state = doomsdayState(["l1"], ["g1", "g2"]);
        pushSpell(state, doomsday.id, "p1");
        resolveTopOfStack(state);

        // total = 3, so the library half is forced to its single card.
        expect(state.pendingChoices![0].count).toEqual({ min: 1, max: 1 });
        submitChoice(state, ["l1"]);
        expect(state.pendingChoices![0].kind).toBe("choose-graveyard-card");
        expect(state.pendingChoices![0].count).toBe(2);
        submitChoice(state, ["g1", "g2"]);
        submitChoice(state, ["g1", "g2", "l1"]);

        const p1 = state.players[0];
        expect(ids(p1.library)).toEqual(["g1", "g2", "l1"]);
        expect(p1.graveyard.map((c) => c.card.id)).toEqual([doomsday.id]);
        expect(p1.exile).toEqual([]);
        expect(p1.life).toBe(10);
    });

    it("resolves with both zones empty — no prompts beyond the search look, life still halved", () => {
        const state = doomsdayState([], [], 7);
        pushSpell(state, doomsday.id, "p1");
        resolveTopOfStack(state);

        // CR 701.23a/701.23f — the searcher is still entitled to the look (and
        // any "searches a library" trigger to its event), so the choice is
        // raised as a 0-pick one with an empty allow-list.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("search-library");
        expect(head.count).toEqual({ min: 0, max: 0 });
        expect(head.candidateIds).toEqual([]);
        submitChoice(state, []);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(3); // 7 → lose ceil(3.5) = 4
        expect(state.stack).toHaveLength(0);
    });

    it("exposes the five kept cards through the wire projection (reorder-library peek + exile pile)", () => {
        const state = doomsdayState(
            ["l1", "l2", "l3", "l4", "l5", "l6"],
            ["g1"]
        );
        pushSpell(state, doomsday.id, "p1");
        resolveTopOfStack(state);
        submitChoice(state, ["l1", "l2", "l3", "l4"]);
        submitChoice(state, ["g1"]);

        // SURFACE: while the ordering choice is pending, the chooser's wire
        // view must expose exactly the five candidates face-up — a hand-built
        // view would mask a dropped `candidateIds`.
        const pending = projectPublicState(state, 1, "p1");
        expect(pending.pendingChoices?.[0]?.kind).toBe("reorder-library");
        expect(
            [...(pending.pendingChoices![0].candidateIds ?? [])].sort()
        ).toEqual(["g1", "l1", "l2", "l3", "l4"]);
        expect(
            (pending.players[0].libraryPeek ?? []).map((c) => c.id).sort()
        ).toEqual(["g1", "l1", "l2", "l3", "l4"]);

        submitChoice(state, ["g1", "l4", "l3", "l2", "l1"]);

        const projected = projectPublicState(state, 2, "p1");
        expect(projected.players[0].library.count).toBe(5);
        expect(
            projected.players[0].library.known.map((e) => e.card.id)
        ).toEqual(["g1", "l4", "l3", "l2", "l1"]);
        expect(projected.players[0].exile.map((c) => c!.id).sort()).toEqual([
            "l5",
            "l6",
        ]);
        expect(projected.players[0].life).toBe(10);
    });
});
