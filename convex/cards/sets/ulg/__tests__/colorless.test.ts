// Urza's Legacy (ULG) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { grimMonolith, memoryJar } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { tapSourceIntoPayment } from "../../../../game";
import { advancePhase, fireDelayedTriggers } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";

/** Drives the incoming player's UNTAP step by advancing from END_STEP:
 *  CLEANUP auto-resolves, turn flips, UNTAP auto-resolves, state settles in
 *  UPKEEP of the intended player. Mirrors `runUntapForJ`
 *  (`convex/cards/sets/lea/__tests__/helpers.ts`), inlined here since ULG's
 *  colour-split test module has no shared helpers file yet. */
function runUntapStep(playerId: string, state: GameState): void {
    state.activePlayerId = playerId === "p1" ? "p2" : "p1";
    state.phase = "END_STEP";
    advancePhase(state);
}

describe("Grim Monolith (does-not-untap + {T}: {C}{C}{C} + {4}: untap, CR 502.1 / 605.1a)", () => {
    it("is a {2} artifact declaring the per-permanent does-not-untap keyword", () => {
        expect(grimMonolith.manaCost).toEqual({ X: 2 });
        expect(grimMonolith.types).toEqual(["Artifact"]);
        expect(grimMonolith.staticAbilities).toContain("does-not-untap");
    });

    it("{T}: Add {C}{C}{C} mana ability produces the declared amount", () => {
        const ability = grimMonolith.activatedAbilities![0];
        expect(ability.manaProduced).toEqual({ C: 3 });
        let added: unknown;
        ability.effect!({ addMana: (cost) => (added = cost) });
        expect(added).toEqual({ C: 3 });
    });

    // Full path through the real tap-for-mana entry point (mirrors the ICE
    // painland / atq Urza-trio harness — `tapSourceIntoPayment`), not just the
    // ability's isolated `effect` closure above.
    it("activating the mana ability through the engine taps it and adds {C}{C}{C} to the pool", () => {
        const monolith = makeInstance(grimMonolith.id, {
            id: "monolith",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [monolith] });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, monolith, undefined, []);
        expect(player.manaPool.C).toBe(3);
        expect(monolith.isTapped).toBe(true);
    });

    it("the tapped state and mana survive the wire-format projection (PublicGameState)", () => {
        const monolith = makeInstance(grimMonolith.id, {
            id: "monolith",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [monolith] });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, monolith, undefined, []);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.C).toBe(3);
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "monolith"
        )!;
        expect(slim.isTapped).toBe(true);
    });

    it("stays tapped through its controller's untap step (does-not-untap, CR 502.1)", () => {
        const monolith = makeInstance(grimMonolith.id, {
            id: "monolith",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monolith] }),
                makePlayer("p2"),
            ],
        });
        runUntapStep("p1", state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "monolith")
                ?.isTapped
        ).toBe(true);
    });

    it("{4} activated ability untaps the monolith from the stack", () => {
        const monolith = makeInstance(grimMonolith.id, {
            id: "monolith",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [monolith] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...monolith,
            zone: "stack",
            castById: "p1",
            abilityId: "grim-monolith-untap",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "monolith")
                ?.isTapped
        ).toBe(false);
    });
});

/** Builds a `count`-card library of filler instances (any registered card
 *  works — the ids only need to be unique and drawable). */
function makeLibrary(prefix: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(grimMonolith.id, { id: `${prefix}${i}`, zone: "library" })
    );
}

describe("Memory Jar ({T}, Sacrifice: each player exiles hand face down + draws 7, then returns it, CR 400.7 / 603.7a, issue #682)", () => {
    function setup() {
        const jar = makeInstance(memoryJar.id, {
            id: "jar",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Hand = ["h1", "h2", "h3"].map((id) =>
            makeInstance(grimMonolith.id, { id, zone: "hand" })
        );
        const p2Hand = ["g1", "g2"].map((id) =>
            makeInstance(grimMonolith.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [jar],
                    hand: p1Hand,
                    library: makeLibrary("p1lib", 8),
                }),
                makePlayer("p2", {
                    hand: p2Hand,
                    library: makeLibrary("p2lib", 8),
                }),
            ],
        });
        return { state, jar };
    }

    function activate(state: GameState, jar: ReturnType<typeof setup>["jar"]) {
        state.stack.push({
            ...jar,
            zone: "stack",
            castById: "p1",
            abilityId: "memory-jar-activate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("each player exiles their whole hand face down and draws seven cards", () => {
        const { state, jar } = setup();
        activate(state, jar);
        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
            "h3",
        ]);
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "g1",
            "g2",
        ]);
        // A delayed trigger is scheduled for the next end step.
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe("memory-jar-return");
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");
    });

    it("the exiled cards are face down (hidden from the opponent, visible to the owner) in the wire projection", () => {
        const { state, jar } = setup();
        activate(state, jar);
        // p2 (the opponent) must NOT see p1's exiled cards' real identity —
        // the projection substitutes a face-down sentinel, not the real id.
        const asP2 = projectPublicState(state, 1, "p2");
        const p1ExiledFromP2 = asP2.players[0].exile.find((c) => c.id === "h1");
        expect(p1ExiledFromP2?.card?.id).not.toEqual(grimMonolith.id);
        // p1 (the owner) CAN see their own exiled cards.
        const asP1 = projectPublicState(state, 1, "p1");
        const p1ExiledFromP1 = asP1.players[0].exile.find((c) => c.id === "h1");
        expect(p1ExiledFromP1?.card).toEqual({ id: grimMonolith.id });
    });

    it("at the next end step, each player discards their (drawn) hand and returns the exiled cards to hand", () => {
        const { state, jar } = setup();
        activate(state, jar);
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        // The 7 drawn cards were discarded...
        expect(state.players[0].graveyard).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(7);
        // ...and the originally-exiled cards are back in hand.
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
            "h3",
        ]);
        expect(state.players[1].hand.map((c) => c.id).sort()).toEqual([
            "g1",
            "g2",
        ]);
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(0);
    });
});
