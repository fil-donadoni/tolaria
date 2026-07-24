// war (War of the Spark) — multicolor behavior tests (ADR 0043 colour split).
//
// Teferi, Time Raveler (planeswalker umbrella #1222) — the reference card for
// the per-player casting-timing subsystem. Three clauses on that subsystem:
//   • STATIC "cast-timing-lock" — each opponent restricted to sorcery speed
//     (asserted through the real `getLegalActions` gate AND its shared
//     frontend-safe reader `isCastTimingSorcerySpeedLocked`, incl. the
//     mandatory wire-format assertion after `projectPublicState`).
//   • +1 "grantCastTiming" Op (NEW Op — per-Op regime: dedicated interpreter +
//     wire assertion here) — controller casts Sorcery spells as though they had
//     flash until their next turn.
//   • −3 bounce-up-to-one + draw — reused Ops (moveZone + draw).

import { describe, it, expect } from "vitest";
import { teferiTimeRaveler } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { braingeyser } from "../../lea/blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { getLegalActions } from "../../../../gre/rules";
import { advancePhase } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";
import {
    isCastTimingSorcerySpeedLocked,
    hasCastTimingFlashGrant,
} from "../../../castRestrictions";
import type { TargetSelection } from "../../../types";

const PLUS1 = "teferi-time-raveler-plus1";
const MINUS3 = "teferi-time-raveler-minus3";

function teferiOnBattlefield(loyalty = 4) {
    return makeInstance(teferiTimeRaveler.id, {
        id: "teferi1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Teferi's loyalty abilities on the stack and resolves it
 *  through the real path (loyalty-cost payment is exercised in game.ts). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const teferi = state.players[0].battlefield.find(
        (c) => c.id === "teferi1"
    )!;
    state.stack.push({
        ...teferi,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Teferi, Time Raveler — loyalty snapshot (CR 306, ADR 0058)", () => {
    it("is a 4-loyalty legendary Teferi planeswalker, {1}{W}{U}", () => {
        expect(teferiTimeRaveler.types).toEqual(["Planeswalker"]);
        expect(teferiTimeRaveler.supertypes).toEqual(["Legendary"]);
        expect(teferiTimeRaveler.subtypes).toEqual(["Teferi"]);
        expect(teferiTimeRaveler.loyalty).toBe(4);
        expect(teferiTimeRaveler.manaCost).toEqual({ generic: 1, W: 1, U: 1 });
        const abilities = teferiTimeRaveler.activatedAbilities!;
        expect(abilities.map((a) => a.id)).toEqual([PLUS1, MINUS3]);
        expect(abilities.map((a) => a.cost.loyalty)).toEqual([1, -3]);
        // No resolve() anywhere — both abilities + the static are declarative.
        expect(abilities.every((a) => a.resolve === undefined)).toBe(true);
        expect(teferiTimeRaveler.staticEffects![0].kind).toBe(
            "cast-timing-lock"
        );
    });
});

describe("Teferi, Time Raveler — static: opponents cast at sorcery speed (CR 601.3a)", () => {
    // p2 holds Lightning Bolt (an Instant) with the mana to cast it.
    function boltInOppHand() {
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        return bolt;
    }

    function stateWithTeferi(overrides: Partial<GameState> = {}): GameState {
        const bolt = boltInOppHand();
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [teferiOnBattlefield()] }),
                makePlayer("p2", {
                    hand: [bolt],
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
            ],
            ...overrides,
        });
    }

    it("blocks the opponent's instant during the controller's turn (they have priority in response)", () => {
        // p1's turn, but p2 holds priority (as if responding). An instant would
        // normally be castable — Teferi's lock forbids it.
        const state = stateWithTeferi({
            activePlayerId: "p1",
            priorityPlayerId: "p2",
        });
        const p2 = state.players[1];
        const bolt = p2.hand[0];
        expect(getLegalActions(state, p2, bolt)).not.toContain("cast");
        // The shared frontend-safe reader agrees.
        expect(isCastTimingSorcerySpeedLocked("p2", state)).toBe(true);
        // The controller (p1) is NOT locked by their own Teferi.
        expect(isCastTimingSorcerySpeedLocked("p1", state)).toBe(false);
    });

    it("allows the opponent's instant at their OWN sorcery timing (their turn, empty stack, priority)", () => {
        const state = stateWithTeferi({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "PRECOMBAT_MAIN",
        });
        const p2 = state.players[1];
        const bolt = p2.hand[0];
        expect(getLegalActions(state, p2, bolt)).toContain("cast");
    });

    it("control: WITHOUT Teferi the opponent CAN cast the instant in response (has priority)", () => {
        const bolt = boltInOppHand();
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    hand: [bolt],
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p2",
        });
        const p2 = state.players[1];
        expect(getLegalActions(state, p2, bolt)).toContain("cast");
        expect(isCastTimingSorcerySpeedLocked("p2", state)).toBe(false);
    });

    it("WIRE: the lock survives projectPublicState (client reads it identically)", () => {
        const state = stateWithTeferi({
            activePlayerId: "p1",
            priorityPlayerId: "p2",
        });
        const projected = projectPublicState(state, 2, "p2");
        // The frontend-safe reader, run on the PROJECTED state, still reports
        // the lock — the client grays out the opponent's instant correctly.
        expect(isCastTimingSorcerySpeedLocked("p2", projected)).toBe(true);
    });
});

describe("Teferi, Time Raveler — +1: cast sorceries as though they had flash (grantCastTiming Op, CR 601.3e)", () => {
    it("adds a Sorcery flash-timing grant for the controller when it resolves", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [teferiOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });
        activate(state, PLUS1);
        expect(state.castTimingFlashGrants).toEqual([
            { playerId: "p1", cardTypes: ["Sorcery"] },
        ]);
    });

    it("lets the controller cast a Sorcery on the OPPONENT's turn while the grant is active", () => {
        const geyser = makeInstance(braingeyser.id, {
            id: "geyser1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        // p2's turn, p1 holds priority. A Sorcery is normally uncastable now.
        const base = makeState({
            players: [
                makePlayer("p1", {
                    hand: [geyser],
                    manaPool: { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        expect(getLegalActions(base, base.players[0], geyser)).not.toContain(
            "cast"
        );

        // With the +1 grant active, the same Sorcery becomes castable.
        const granted: GameState = {
            ...base,
            castTimingFlashGrants: [{ playerId: "p1", cardTypes: ["Sorcery"] }],
        };
        expect(getLegalActions(granted, granted.players[0], geyser)).toContain(
            "cast"
        );
    });

    it("WIRE: the grant survives projectPublicState (hasCastTimingFlashGrant reads it)", () => {
        const geyser = makeInstance(braingeyser.id, {
            id: "geyser1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [geyser] }), makePlayer("p2")],
            castTimingFlashGrants: [{ playerId: "p1", cardTypes: ["Sorcery"] }],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimGeyser = projected.players[0].hand.find(
            (c): c is NonNullable<typeof c> => !!c && c.id === "geyser1"
        )!;
        expect(hasCastTimingFlashGrant("p1", slimGeyser, projected)).toBe(true);
        // An Instant grant would not cover a Sorcery, and vice-versa: the
        // controller's Sorcery grant does not leak to the opponent.
        expect(hasCastTimingFlashGrant("p2", slimGeyser, projected)).toBe(
            false
        );
    });

    it("grant expires at the start of the grantee's next turn (advanceTurn)", () => {
        // p1's turn ending (CLEANUP); one advancePhase crosses into p2's turn.
        // A grant belonging to the player whose turn is about to start clears;
        // the other player's grant survives.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "CLEANUP",
            castTimingFlashGrants: [
                { playerId: "p1", cardTypes: ["Sorcery"] },
                { playerId: "p2", cardTypes: ["Sorcery"] },
            ],
        });
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.castTimingFlashGrants).toEqual([
            { playerId: "p1", cardTypes: ["Sorcery"] },
        ]);
    });
});

describe("Teferi, Time Raveler — −3: bounce up to one A/C/E + draw (CR 400.7 / 121.1)", () => {
    it("returns the target creature to its owner's hand and draws a card", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const topCard = makeInstance(grizzlyBears.id, {
            id: "top1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [teferiOnBattlefield()],
                    library: [topCard],
                }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        activate(state, MINUS3, [{ type: "permanent", id: "bear1" }]);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["bear1"]);
        // "Draw a card" is unconditional — p1 drew the top card.
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top1"]);
    });

    it("'up to one': resolves with no target — just draws (CR 608.2b)", () => {
        const topCard = makeInstance(grizzlyBears.id, {
            id: "top1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [teferiOnBattlefield()],
                    library: [topCard],
                }),
                makePlayer("p2"),
            ],
        });
        // No target chosen (empty targets array) — the bounce is a no-op, the
        // draw still happens.
        activate(state, MINUS3, []);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top1"]);
    });
});
