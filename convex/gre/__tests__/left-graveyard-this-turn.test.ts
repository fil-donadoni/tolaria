// "A card left your graveyard this turn" tally (CR 400.7, issue #3240).
//
// CR 400.7 — "an object that moves from one zone to another becomes a new
// object". The graveyard DEPARTURE is that move, whatever the destination, so
// exile (a flashback / escape / delve cost, graveyard hate), the battlefield
// (reanimation), the hand, the library and the stack (a cast from the
// graveyard) all count. `PlayerState.leftGraveyardThisTurn` is that per-player
// per-turn tally, written at ONE chokepoint (`noteGraveyardDeparture`) and
// reset at the turn boundary — never mid-turn, because CR 603.4 checks Gau,
// Feral Youth's intervening if TWICE inside this turn's OWN end step (once
// when the trigger would fire, once as it resolves). There is one end step per
// turn (CR 500.1 / 513.1), so the opponent's is a different turn and the reset
// there is correct, not a loss.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import {
    buildSpellContext,
    exileCardFromGraveyard,
    exileFaceDownCard,
    moveCard,
    noteGraveyardDeparture,
    removeFromZone,
} from "../state";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import { makePlayer, makeState } from "../../cards/__tests__/setup";

function gyCard(id: string, ownerId: string): CardInstanceState {
    return {
        id,
        card: { id: "def-bear" },
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
        isTapped: false,
    };
}

function state2p(p1Graveyard: string[] = [], p2Graveyard: string[] = []) {
    return makeState({
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                graveyard: p1Graveyard.map((id) => gyCard(id, "p1")),
            }),
            makePlayer("p2", {
                graveyard: p2Graveyard.map((id) => gyCard(id, "p2")),
            }),
        ],
    });
}

describe("leftGraveyardThisTurn tally (CR 400.7)", () => {
    it("moveCard off the graveyard tallies, whatever the destination", () => {
        for (const to of ["exile", "hand", "library", "battlefield"] as const) {
            const state = state2p(["gy-a"]);
            moveCard(state.players[0], "gy-a", "graveyard", to);
            expect(state.players[0].leftGraveyardThisTurn).toBe(1);
        }
    });

    it("moveCard INTO the graveyard does not tally — a departure is not an arrival", () => {
        const state = state2p();
        state.players[0].hand.push({
            ...gyCard("h-a", "p1"),
            zone: "hand",
        });
        moveCard(state.players[0], "h-a", "hand", "graveyard");
        expect(state.players[0].leftGraveyardThisTurn).toBeUndefined();
    });

    it("removeFromZone graveyard→stack tallies (a cast from the graveyard)", () => {
        const state = state2p(["gy-a"]);
        removeFromZone(state, state.players[0], "gy-a", "graveyard");
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
    });

    it("removeFromZone from another zone never tallies", () => {
        const state = state2p();
        state.players[0].hand.push({ ...gyCard("h-a", "p1"), zone: "hand" });
        removeFromZone(state, state.players[0], "h-a", "hand");
        expect(state.players[0].leftGraveyardThisTurn).toBeUndefined();
    });

    it("the exile-from-graveyard cost primitive rides the same chokepoint", () => {
        const state = state2p(["gy-a", "gy-b"]);
        expect(exileCardFromGraveyard(state.players[0], "gy-a")).toBe(true);
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
        // A card that is NOT in the graveyard never left it (CR 608.2b).
        expect(exileCardFromGraveyard(state.players[0], "nope")).toBe(false);
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
    });

    it("a FACE-DOWN exile off the graveyard tallies too (the third removal primitive)", () => {
        // `exileFaceDownCard` deliberately bypasses `moveCard` (exile is a
        // public zone; a face-down exile is CR 406.3's exception), and its
        // `from` admits the graveyard. No shipped card passes "graveyard"
        // today — every caller exiles from the library — so this is the latent
        // exit PR #3410's review found missing from the census.
        const state = state2p(["gy-a"]);
        state.players[0].library.push({
            ...gyCard("lib-a", "p1"),
            zone: "library",
        });
        expect(
            exileFaceDownCard(state.players[0], "gy-a", "graveyard", "p1")
        ).not.toBeNull();
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
        // The library leg is not a graveyard departure and must not tally.
        exileFaceDownCard(state.players[0], "lib-a", "library", "p1");
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
    });

    it("accumulates per player and never crosses over", () => {
        const state = state2p(["a1", "a2"], ["b1"]);
        moveCard(state.players[0], "a1", "graveyard", "exile");
        moveCard(state.players[0], "a2", "graveyard", "exile");
        moveCard(state.players[1], "b1", "graveyard", "exile");
        expect(state.players[0].leftGraveyardThisTurn).toBe(2);
        expect(state.players[1].leftGraveyardThisTurn).toBe(1);
    });

    it("reanimation off the graveyard tallies; off EXILE does not", () => {
        const state = state2p(["gy-a"]);
        state.players[0].exile.push({
            ...gyCard("ex-a", "p1"),
            zone: "exile",
        });
        const ctx = spellCtx(state);
        expect(ctx.returnToBattlefield("p1", "gy-a", "graveyard")).toBeTruthy();
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
        ctx.returnToBattlefield("p1", "ex-a", "exile");
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
    });

    it("the batch reanimation funnel tallies once per entry that actually left", () => {
        const state = state2p(["a1", "a2"]);
        const ctx = spellCtx(state);
        ctx.returnGraveyardSetToBattlefield([
            { playerId: "p1", cardInstanceId: "a1" },
            { playerId: "p1", cardInstanceId: "a2" },
            // CR 608.2b — never in the graveyard, so it never left it.
            { playerId: "p1", cardInstanceId: "ghost" },
        ]);
        expect(state.players[0].leftGraveyardThisTurn).toBe(2);
    });

    it("the whole-graveyard bulk sweep tallies N, not 1 (Endurance)", () => {
        const state = state2p(["a1", "a2", "a3"]);
        spellCtx(state).putGraveyardOnBottomOfLibrary("p1");
        expect(state.players[0].leftGraveyardThisTurn).toBe(3);
        // An empty graveyard is a no-op, not a phantom departure.
        spellCtx(state).putGraveyardOnBottomOfLibrary("p2");
        expect(state.players[1].leftGraveyardThisTurn).toBeUndefined();
    });

    it("stands through THIS turn's end step and clears only at the boundary (CR 603.4 / 513.1)", () => {
        const state = state2p(["gy-a"]);
        moveCard(state.players[0], "gy-a", "graveyard", "exile");
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
        // This turn's own end step, where CR 603.4 reads the condition twice.
        state.phase = "END_STEP";
        expect(state.players[0].leftGraveyardThisTurn).toBe(1);
        // Into the NEXT turn — the boundary is the ONLY place it clears.
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.players[0].leftGraveyardThisTurn).toBeUndefined();
    });

    it("the chokepoint ignores a non-positive count", () => {
        const state = state2p();
        noteGraveyardDeparture(state.players[0], 0);
        expect(state.players[0].leftGraveyardThisTurn).toBeUndefined();
    });

    it("survives a save/load round trip taken mid-turn", () => {
        const state = state2p(["gy-a"]);
        moveCard(state.players[0], "gy-a", "graveyard", "exile");
        const round = expandState(compactState(state));
        expect(round.players[0].leftGraveyardThisTurn).toBe(1);
        expect(round.players[1].leftGraveyardThisTurn).toBeUndefined();
    });
});

/** A `SpellContext` over a throwaway stack item — the only way to reach the
 *  reanimation / library primitives, which live on the context rather than as
 *  free functions. */
function spellCtx(state: GameState) {
    const item = {
        ...gyCard(`ctx-${state.stack.length}`, "p1"),
        zone: "stack" as const,
        castById: "p1",
    };
    state.stack.push(item);
    return buildSpellContext(state, state.stack[state.stack.length - 1]);
}
