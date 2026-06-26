// Urza's Legacy (ULG) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { franticSearch } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";

const handCard = (id: string) =>
    makeInstance(franticSearch.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
const libCard = (id: string) =>
    makeInstance(franticSearch.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "library",
    });
const land = (id: string) =>
    makeInstance(franticSearch.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Land"],
        isTapped: true,
    });

describe("Frantic Search (draw 2, discard 2, untap 3 lands; CR 121.1 / 701.8)", () => {
    it("is a {2}{U} instant", () => {
        expect(franticSearch.manaCost).toEqual({ X: 2, U: 1 });
        expect(franticSearch.types).toEqual(["Instant"]);
    });

    it("draws two, discards two of choice, and untaps the chosen lands", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard("h0"), handCard("h1")],
                    library: [libCard("d0"), libCard("d1")],
                    battlefield: [land("L0"), land("L1")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, franticSearch.id, "p1");
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the discard choice
        // Drew d0, d1 → hand of 4.
        expect(state.players[0].hand).toHaveLength(4);

        // Discard two (the original hand cards).
        let head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0", "h1"],
        });

        // Suspended on the untap choice — untap both lands.
        head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["L0", "L1"],
        });

        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "d0",
            "d1",
        ]);
        // The two discarded cards are in the graveyard (alongside the resolved
        // Frantic Search spell itself, CR 608.2m).
        const gy = state.players[0].graveyard.map((c) => c.id);
        expect(gy).toContain("h0");
        expect(gy).toContain("h1");
        const lands = state.players[0].battlefield.filter((c) =>
            c.types.includes("Land")
        );
        expect(lands.every((l) => !l.isTapped)).toBe(true);
    });
});
