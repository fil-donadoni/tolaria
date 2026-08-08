// Urza's Legacy (ULG) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { franticSearch, tinker } from "../blue";
import { ornithopter } from "../../atq/colorless";
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

describe("Tinker (CR 117.9 additional cost / 701.19 / 400.7 / 701.20, issue #677)", () => {
    it("searches for an artifact card and puts it onto the battlefield", () => {
        const libOrn = makeInstance(ornithopter.id, {
            id: "orn1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: [libOrn] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, tinker.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the search
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["orn1"]);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["orn1"],
        });
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("orn1");
        expect(state.players[0].library).toHaveLength(0);
    });
});
