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
import { assertLegalAction, getLegalActions } from "../../../../gre/rules";
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

// ─────────────────────────────────────────────────────────────────────────
// Issue #1690 — the two halves must not bleed into each other. The STATIC
// restricts each OPPONENT; it must never widen the CONTROLLER's own window.
// Absent a live +1 grant, the controller's Sorcery is castable only in their
// own main phase, empty stack, holding priority (CR 307.1 / 601.3a).
//
// Exercised at all THREE layers of the one shared authority, as the issue
// demands, for the no-grant case:
//   1. GRE legal actions — `getLegalActions`;
//   2. the cast mutation — `assertLegalAction`, the exact chokepoint
//      `announceCast` (convex/game.ts) calls before it will announce a cast
//      (there is no mutation-testing harness in this repo; driving the
//      exported chokepoint is the established precedent — see
//      delveCastCost.test.ts);
//   3. the client cast gate — the `legalActions` field on the hand card as it
//      comes OUT of `projectPublicState`, which is literally what
//      `board-hand-card.tsx` reads (`card.legalActions.includes("cast")`).
//      Driven THROUGH the reducer, never a hand-built view.
describe("Teferi, Time Raveler — the static never widens the CONTROLLER's window (issue #1690, CR 307.1/601.3a)", () => {
    const WIDE_POOL = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };

    /** p1 controls Teferi and holds a Sorcery + a Creature, with mana for both. */
    function controllerBoard(overrides: Partial<GameState> = {}): GameState {
        const geyser = makeInstance(braingeyser.id, {
            id: "geyser1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [geyser, bears],
                    battlefield: [teferiOnBattlefield()],
                    manaPool: { ...WIDE_POOL },
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            ...overrides,
        });
    }

    /** The client's own gate: `legalActions` as projected onto the hand card. */
    function projectedHandActions(state: GameState, cardId: string): string[] {
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand.find(
            (c): c is NonNullable<typeof c> => !!c && c.id === cardId
        )!;
        return slim.legalActions ?? [];
    }

    /** Runs the engine forward until the active player changes. */
    function advanceToNextTurn(state: GameState): void {
        const from = state.activePlayerId;
        for (let i = 0; i < 20 && state.activePlayerId === from; i++) {
            advancePhase(state);
        }
        expect(state.activePlayerId).not.toBe(from);
    }

    it("+1 NOT activated: the controller cannot cast a Sorcery on the opponent's turn — GRE, cast mutation, and client gate all refuse", () => {
        // p2's turn, p1 holds priority (responding). No grant anywhere.
        const state = controllerBoard({
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });
        expect(state.castTimingFlashGrants).toBeUndefined();
        const p1 = state.players[0];
        const geyser = p1.hand[0];

        // 1. GRE legal actions.
        expect(getLegalActions(state, p1, geyser)).not.toContain("cast");
        // 2. The cast mutation's own gate throws.
        expect(() => assertLegalAction(state, p1, geyser, "cast")).toThrow(
            /Illegal action "cast"/
        );
        // 3. The client affordance never lights up.
        expect(projectedHandActions(state, "geyser1")).not.toContain("cast");

        // Control: the SAME Sorcery is castable in the controller's own main
        // phase, so the refusal above is timing, not affordability.
        const ownTurn = controllerBoard({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(
            getLegalActions(
                ownTurn,
                ownTurn.players[0],
                ownTurn.players[0].hand[0]
            )
        ).toContain("cast");
        expect(projectedHandActions(ownTurn, "geyser1")).toContain("cast");
    });

    it("after the +1 resolves the controller CAN cast a Sorcery at instant speed on the opponent's turn — and loses it again on their next turn", () => {
        const state = controllerBoard({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        activate(state, PLUS1);
        expect(state.castTimingFlashGrants).toEqual([
            { playerId: "p1", cardTypes: ["Sorcery"] },
        ]);

        // Cross into p2's turn; the grant survives (it lasts "until YOUR next
        // turn"). p1 then takes priority in response.
        advanceToNextTurn(state);
        expect(state.activePlayerId).toBe("p2");
        state.priorityPlayerId = "p1";
        state.players[0].manaPool = { ...WIDE_POOL };
        const p1 = state.players[0];
        const geyser = p1.hand.find((c) => c.id === "geyser1")!;
        expect(getLegalActions(state, p1, geyser)).toContain("cast");
        expect(() =>
            assertLegalAction(state, p1, geyser, "cast")
        ).not.toThrow();
        expect(projectedHandActions(state, "geyser1")).toContain("cast");

        // The grant is narrowed to Sorcery spells: a Creature spell stays
        // sorcery-speed even while the grant is live.
        const bears = p1.hand.find((c) => c.id === "bears1")!;
        expect(getLegalActions(state, p1, bears)).not.toContain("cast");
        expect(projectedHandActions(state, "bears1")).not.toContain("cast");

        // p1's next turn starts → the grant is gone (CR 601.3e "until your next
        // turn"), so the following opponent turn refuses the Sorcery again.
        advanceToNextTurn(state);
        expect(state.activePlayerId).toBe("p1");
        expect(state.castTimingFlashGrants).toBeUndefined();
        advanceToNextTurn(state);
        expect(state.activePlayerId).toBe("p2");
        state.priorityPlayerId = "p1";
        state.players[0].manaPool = { ...WIDE_POOL };
        const later = state.players[0];
        const geyserLater = later.hand.find((c) => c.id === "geyser1")!;
        expect(getLegalActions(state, later, geyserLater)).not.toContain(
            "cast"
        );
        expect(projectedHandActions(state, "geyser1")).not.toContain("cast");
    });

    it("the static beats a flash grant the OPPONENT holds (CR 101.2 — a restriction overrides a permission)", () => {
        // p2 is locked by p1's Teferi AND holds a Sorcery flash grant of their
        // own. On p1's turn, with priority, p2 still cannot cast the Sorcery.
        const geyser = makeInstance(braingeyser.id, {
            id: "geyser2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [teferiOnBattlefield()] }),
                makePlayer("p2", {
                    hand: [geyser],
                    manaPool: { ...WIDE_POOL },
                }),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            castTimingFlashGrants: [{ playerId: "p2", cardTypes: ["Sorcery"] }],
        });
        const p2 = state.players[1];
        expect(getLegalActions(state, p2, geyser)).not.toContain("cast");
        expect(() => assertLegalAction(state, p2, geyser, "cast")).toThrow(
            /Illegal action "cast"/
        );
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
