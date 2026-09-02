// Per-player cast TIMING (CR 307.1 / 601.3a / 601.3b) — issue #1690.
//
// `castTimingBaseLegal` is the SHARED cast-timing authority: the GRE
// (`getLegalActions`), the cast mutation (through `assertLegalAction`) and the
// client cast gate (through the projected `legalActions`) all resolve a spell's
// timing legality through it and nothing else. This file pins the helper's own
// contract — that it is CASTER-AWARE — independently of the callers that
// happen to guard it.
//
// The regression it guards (issue #1690): the sorcery leg used to delegate to
// the player-AGNOSTIC `isSorceryTiming(state)` ("some main phase, empty stack,
// and the ACTIVE player holds priority"). Asked about a caster who is NOT the
// active player, that predicate answers with the ACTIVE player's window, so the
// helper reported a plain Sorcery as castable during the opponent's turn —
// exactly the "Teferi's controller casts sorceries without the +1" symptom,
// with no flash grant anywhere in the state. Inside `getLegalActions` the bug
// was masked by an early `priorityPlayerId !== casterId` return 300 lines
// upstream; any other consumer of the shared helper saw it raw.

import { describe, it, expect } from "vitest";
import { castTimingBaseLegal } from "../rules";
import { isSorceryTiming, isSorceryTimingFor } from "../phases";
import { braingeyser } from "../../cards/sets/lea/blue";
import { lightningBolt } from "../../cards/sets/lea/red";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

function handCard(cardId: string, id: string, controllerId = "p1") {
    return makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

/** p1 holds a Sorcery and an Instant; `overrides` sets the timing frame. */
function frame(overrides: Partial<GameState> = {}): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    handCard(braingeyser.id, "sorcery1"),
                    handCard(lightningBolt.id, "instant1"),
                ],
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    });
}

const sorcery = (s: GameState) => s.players[0].hand[0];
const instant = (s: GameState) => s.players[0].hand[1];

describe("isSorceryTimingFor — caster-aware sorcery window (CR 307.1)", () => {
    it("is true only for the active player, holding priority, in a main phase with an empty stack", () => {
        const state = frame({ activePlayerId: "p1", priorityPlayerId: "p1" });
        expect(isSorceryTimingFor(state, "p1")).toBe(true);
        // The non-active player never has a sorcery window, even though the
        // player-agnostic predicate reports one for the turn as a whole.
        expect(isSorceryTimingFor(state, "p2")).toBe(false);
        expect(isSorceryTiming(state)).toBe(true);
    });

    it("is false for a player who is active but does not hold priority", () => {
        const state = frame({ activePlayerId: "p1", priorityPlayerId: "p2" });
        expect(isSorceryTimingFor(state, "p1")).toBe(false);
        expect(isSorceryTimingFor(state, "p2")).toBe(false);
    });

    it("is false outside a main phase and while the stack is non-empty", () => {
        const combat = frame({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
        });
        expect(isSorceryTimingFor(combat, "p1")).toBe(false);

        const withStack = frame({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        withStack.stack.push({
            ...handCard(lightningBolt.id, "onstack"),
            zone: "stack",
            castById: "p2",
        } as (typeof withStack.stack)[number]);
        expect(isSorceryTimingFor(withStack, "p1")).toBe(false);
    });
});

describe("castTimingBaseLegal — the shared cast-timing authority (issue #1690)", () => {
    it("REGRESSION: a Sorcery is NOT castable by a player who is not the active player, even while the active player holds priority", () => {
        // p2's turn, p2 holds priority: `isSorceryTiming(state)` is TRUE for the
        // turn as a whole. Asked about p1, the shared helper must still say no —
        // p1 has no sorcery window during p2's turn (CR 307.1) and holds no
        // flash grant.
        const state = frame({ activePlayerId: "p2", priorityPlayerId: "p2" });
        expect(isSorceryTiming(state)).toBe(true);
        expect(state.castTimingFlashGrants).toBeUndefined();
        expect(castTimingBaseLegal(state, "p1", sorcery(state))).toBe(false);
        // ...and the same for the caster who DOES hold the window.
        expect(castTimingBaseLegal(state, "p2", sorcery(state))).toBe(true);
    });

    it("an Instant is castable by whoever holds priority, on either player's turn", () => {
        const own = frame({ activePlayerId: "p1", priorityPlayerId: "p1" });
        expect(castTimingBaseLegal(own, "p1", instant(own))).toBe(true);
        const opp = frame({ activePlayerId: "p2", priorityPlayerId: "p1" });
        expect(castTimingBaseLegal(opp, "p1", instant(opp))).toBe(true);
    });

    it("a live flash grant (CR 601.3b) — and only a live one — opens the off-turn Sorcery window", () => {
        const base = frame({ activePlayerId: "p2", priorityPlayerId: "p1" });
        expect(castTimingBaseLegal(base, "p1", sorcery(base))).toBe(false);

        const granted: GameState = {
            ...base,
            castTimingFlashGrants: [{ playerId: "p1", cardTypes: ["Sorcery"] }],
        };
        expect(castTimingBaseLegal(granted, "p1", sorcery(granted))).toBe(true);
        // The grant is per-player: it never leaks to the opponent.
        expect(castTimingBaseLegal(granted, "p2", sorcery(granted))).toBe(
            false
        );
    });
});
