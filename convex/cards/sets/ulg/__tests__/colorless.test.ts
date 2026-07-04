// Urza's Legacy (ULG) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { grimMonolith } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { tapSourceIntoPayment } from "../../../../game";
import { advancePhase } from "../../../../gre/phases";
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
