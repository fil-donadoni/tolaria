// Urza's Legacy (ULG) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { franticSearch, miscalculation, tinker } from "../blue";
import { ornithopter } from "../../atq/colorless";
import { lightningBolt } from "../../lea/red";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";

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

// Miscalculation — {1}{U} Instant. "Counter target spell unless its
// controller pays {2}." Same `mayPay`-suspends-the-spell shape as Daze — the
// smoke sweep runs the card's OTHER activation site (Cycling {2}) instead, so
// the counter-unless-pay effect itself has zero coverage. Hand-written here
// for both branches (CR 701.5a / 117.3a); the Cycling activated ability is
// covered class-wide by the shared `cyclingAbility` factory's own tests.
describe("Miscalculation (counter unless controller pays {2}, CR 701.5a / 117.3a)", () => {
    it("declining the payment counters the target spell", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, miscalculation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p2"); // the TARGET's controller decides
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([bolt.id]);
        expect(state.players[0].life).toBe(20); // bolt never resolved
    });

    it("paying {2} lets the spell resolve normally, spending the mana", () => {
        const p2 = makePlayer("p2", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
        });
        const state = makeState({ players: [makePlayer("p1"), p2] });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, miscalculation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].manaPool.C).toBe(0);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeDefined();
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });

    it("the countered-and-graveyarded outcome survives the wire-format projection", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, miscalculation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].graveyard.map((c) => c.id)).toEqual([
            bolt.id,
        ]);
        expect(projected.stack).toHaveLength(0);
    });
});

describe("Tinker (CR 118.8 additional cost / 701.19 / 400.7 / 701.20, issue #677)", () => {
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

        // Re-assert the zone change through the wire projection: the client
        // reads a slim battlefield entry ({ card: { id } }) and a library
        // count, not the raw fat state.
        const projected = projectPublicState(state, 1, "p1");
        const slimBattlefield = projected.players[0].battlefield.map(
            (c) => c.id
        );
        expect(slimBattlefield).toContain("orn1");
        expect(projected.players[0].library.count).toBe(0);
    });
});
