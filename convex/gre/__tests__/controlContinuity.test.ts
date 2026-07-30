// Control continuity — "controlled since the beginning of the turn"
// (`gre/controlContinuity.ts`, issue #1944). The two halves of the predicate
// (the CR 400.7 `enteredOnTurn` entry stamp and the turn-scoped
// `controlChangedThisTurn` ledger) plus the engine sites that maintain them.

import { describe, it, expect } from "vitest";
import {
    hasControlledSinceTurnStart,
    recordControlChangeThisTurn,
    resetControlContinuity,
} from "../controlContinuity";
import { applyControlChange, revertControlChange } from "../state";
import { advancePhase } from "../phases";
import { markAttacking, recordAttackerDeclared } from "../combat";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { grizzlyBears, controlMagic } from "../../cards/sets/lea";

describe("hasControlledSinceTurnStart (CR 400.7 entry stamp + control ledger)", () => {
    it("is true for a permanent that was already there when the turn began", () => {
        const state = makeState({ turn: 5 });
        expect(
            hasControlledSinceTurnStart(state, { id: "a", enteredOnTurn: 3 })
        ).toBe(true);
    });

    it("is false for a permanent that entered THIS turn (CR 400.7)", () => {
        const state = makeState({ turn: 5 });
        expect(
            hasControlledSinceTurnStart(state, { id: "a", enteredOnTurn: 5 })
        ).toBe(false);
    });

    it("is false for a permanent that left and RE-entered this turn — the fresh entry stamp, not the old one", () => {
        const state = makeState({ turn: 5 });
        // `resetBattlefieldTransientState` drops `enteredOnTurn` on the way
        // out and `markEnteredThisTurn` re-stamps it on the way back in, so
        // the returning object carries the CURRENT turn.
        expect(
            hasControlledSinceTurnStart(state, {
                id: "blinked",
                enteredOnTurn: 5,
            })
        ).toBe(false);
    });

    it("is false once the permanent's controller changed this turn, even though it never changed zones", () => {
        const state = makeState({ turn: 5 });
        recordControlChangeThisTurn(state, "stolen");
        expect(
            hasControlledSinceTurnStart(state, {
                id: "stolen",
                enteredOnTurn: 2,
            })
        ).toBe(false);
    });

    it("treats a permanent with NO entry stamp as long-standing (only the ledger can disqualify it)", () => {
        const state = makeState({ turn: 5 });
        expect(hasControlledSinceTurnStart(state, { id: "old" })).toBe(true);
        recordControlChangeThisTurn(state, "old");
        expect(hasControlledSinceTurnStart(state, { id: "old" })).toBe(false);
    });
});

describe("control-continuity ledger maintenance", () => {
    it("records each id at most once", () => {
        const state = makeState({ turn: 2 });
        recordControlChangeThisTurn(state, "a");
        recordControlChangeThisTurn(state, "a");
        recordControlChangeThisTurn(state, "b");
        expect(state.controlChangedThisTurn).toEqual(["a", "b"]);
    });

    it("resets to empty at a turn boundary", () => {
        const state = makeState({ turn: 2 });
        recordControlChangeThisTurn(state, "a");
        resetControlContinuity(state);
        expect(state.controlChangedThisTurn).toBeUndefined();
        expect(
            hasControlledSinceTurnStart(state, { id: "a", enteredOnTurn: 1 })
        ).toBe(true);
    });

    it("applyControlChange records the break for BOTH controllers", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        bears.enteredOnTurn = 1;
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            turn: 4,
            players: [
                makePlayer("p1", { battlefield: [bears] }),
                makePlayer("p2", { battlefield: [magic] }),
            ],
        });
        // Before: p1 has held it all turn.
        expect(hasControlledSinceTurnStart(state, bears)).toBe(true);
        applyControlChange(state, "bears", "p2", "magic");
        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "bears"
        );
        // After: neither player has held it continuously since the turn began.
        expect(hasControlledSinceTurnStart(state, bears)).toBe(false);
    });

    it("revertControlChange also records the break — a round trip within one turn is NOT continuous control", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        bears.enteredOnTurn = 1;
        const magic = makeInstance(controlMagic.id, {
            id: "magic",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            turn: 4,
            players: [
                makePlayer("p1", { battlefield: [bears] }),
                makePlayer("p2", { battlefield: [magic] }),
            ],
        });
        applyControlChange(state, "bears", "p2", "magic");
        // Control Magic leaves — control snaps back to p1 (CR 108.3).
        revertControlChange(state, "bears", "magic");
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "bears"
        );
        // This is the case a start-of-turn SNAPSHOT would get wrong: p1
        // controls it now AND controlled it at the turn's start, but not
        // continuously in between.
        expect(hasControlledSinceTurnStart(state, bears)).toBe(false);
    });

    it("both turn-scoped flags reset when the turn actually rolls over (CR 514.3 → advanceTurn)", () => {
        const state = makeState({
            turn: 4,
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        recordControlChangeThisTurn(state, "stolen");
        state.creatureAttackedThisTurn = true;
        // Walk into the next turn via CLEANUP.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.turn).toBe(5);
        expect(state.controlChangedThisTurn).toBeUndefined();
        expect(state.creatureAttackedThisTurn).toBeUndefined();
        // A permanent that entered on turn 4 is now long-standing on turn 5.
        expect(
            hasControlledSinceTurnStart(state, { id: "x", enteredOnTurn: 4 })
        ).toBe(true);
    });
});

describe("creatureAttackedThisTurn (CR 506.3 / 506.4, issue #1944)", () => {
    function combatState() {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            turn: 3,
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2"),
            ],
        });
        state.combat = {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        return { state, attacker };
    }

    it("is unset until a creature is declared as an attacker", () => {
        const { state } = combatState();
        expect(state.creatureAttackedThisTurn).toBeUndefined();
    });

    it("is set by the shared declaration record and survives the attacker dying", () => {
        const { state, attacker } = combatState();
        markAttacking(state, attacker);
        recordAttackerDeclared(state, attacker);
        expect(attacker.hasAttackedThisTurn).toBe(true);
        expect(state.creatureAttackedThisTurn).toBe(true);
        // The attacker dies in combat — a scan of the per-card flags would now
        // find nothing, which is exactly why the game-level flag exists.
        state.players[0].battlefield = [];
        expect(state.creatureAttackedThisTurn).toBe(true);
    });

    it("markAttacking ALONE does not record an attack — a creature put onto the battlefield attacking was never declared (CR 506.3c)", () => {
        const { state, attacker } = combatState();
        markAttacking(state, attacker);
        expect(attacker.isAttacking).toBe(true);
        expect(attacker.hasAttackedThisTurn).toBeUndefined();
        expect(state.creatureAttackedThisTurn).toBeUndefined();
    });
});
