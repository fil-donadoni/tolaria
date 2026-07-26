// Integration test for the generic-mana park/resume seam (CR 601.2g, issue
// #1444, parent PRD #1442).
//
// The project has no Convex mutation test harness (see
// `convex/__tests__/activateAbilityOnState.test.ts` for the same convention),
// so this drives the exact exported functions the `resolveManaSpendChoice`
// mutation runs server-side over a real GameState:
//
//   tryAutoCommitPendingCast / tryAutoCommitPendingActivation  (the finalize
//   point that PARKS an ambiguous generic payment) → findActiveManaSpendChoice
//   (which parked choice awaits the player) → validateManaSpendOrder (order
//   legality) → the same finalize called WITH the chosen order (RESUME → stack).
//
// The manual floating-pool path and the auto-tap overproduction path converge
// at this finalize point: both arrive with mana already floated in the pool, so
// a single floated-pool assertion covers both. Every existing caller of
// tryAutoCommitPendingCast passes no order, so an ambiguous pool parks
// automatically wherever a payment would otherwise complete.

import { describe, it, expect } from "vitest";
import {
    tryAutoCommitPendingCast,
    tryAutoCommitPendingActivation,
    findActiveManaSpendChoice,
} from "../game";
import {
    validateManaSpendOrder,
    type GameState,
    type PendingCast,
    type PendingActivation,
} from "../gre/state";
import { getCardByName } from "../cards";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";

const ORNITHOPTER = getCardByName("Ornithopter").id; // artifact; cost set below
const LION_SASH = getCardByName("Lion Sash").id; // {2} unattach ability, no target

/** {U:1,G:1} floated, a spell owing {1} generic parked in pendingCast. */
function castState(): GameState {
    const cast = makeInstance(ORNITHOPTER, {
        id: "cast",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "cast",
        manaCost: { X: 1 }, // one generic pip owed
        tappedLandIds: [],
    };
    const p1 = makePlayer("p1", {
        hand: [cast],
        manaPool: { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 },
    });
    return makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast,
    });
}

/** {U:1,G:2} floated, an activated ability owing {2} generic parked. */
function activationState(): GameState {
    const source = makeInstance(LION_SASH, {
        id: "sash",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const pendingActivation: PendingActivation = {
        playerId: "p1",
        cardInstanceId: "sash",
        abilityId: "lion-sash-reconfigure-unattach",
        manaCost: { X: 2 }, // two generic pips owed
        tappedLandIds: [],
        tapSource: false,
        sacrificeSource: false,
    };
    const p1 = makePlayer("p1", {
        battlefield: [source],
        manaPool: { W: 0, U: 1, B: 0, R: 0, G: 2, C: 0 },
    });
    return makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingActivation,
    });
}

describe("generic-mana spend — park & resume (CR 601.2g)", () => {
    describe("cast path (pendingCast)", () => {
        it("parks with manaSpendChoice instead of putting the spell on the stack", () => {
            const state = castState();
            const result = tryAutoCommitPendingCast(state, "p1");
            expect(result).toBe(null);
            // Parked, NOT committed: pendingCast survives, stack empty.
            expect(state.pendingCast).toBeDefined();
            expect(state.pendingCast!.manaSpendChoice).toEqual({
                generic: 1,
                candidateColors: ["U", "G"],
            });
            expect(state.stack).toHaveLength(0);
            // Pool untouched while parked.
            expect(state.players[0].manaPool.U).toBe(1);
            expect(state.players[0].manaPool.G).toBe(1);
        });

        it("findActiveManaSpendChoice locates the parked cast choice", () => {
            const state = castState();
            tryAutoCommitPendingCast(state, "p1");
            const active = findActiveManaSpendChoice(state, "p1");
            expect(active).not.toBe(null);
            expect(active!.container).toBe("cast");
            expect(active!.choice.candidateColors).toEqual(["U", "G"]);
        });

        it("resumes and commits, spending exactly the chosen mana", () => {
            const state = castState();
            tryAutoCommitPendingCast(state, "p1");
            const { choice } = findActiveManaSpendChoice(state, "p1")!;
            // Player picks U — validate, then resume with the order.
            validateManaSpendOrder(choice, ["U"], state.players[0].manaPool);
            const result = tryAutoCommitPendingCast(state, "p1", ["U"]);
            expect(result).not.toBe(null);
            expect(state.pendingCast).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            // Exactly the chosen U spent; G survives.
            expect(state.players[0].manaPool.U).toBe(0);
            expect(state.players[0].manaPool.G).toBe(1);
        });

        it("picking G instead leaves U (the other leftover set)", () => {
            const state = castState();
            tryAutoCommitPendingCast(state, "p1");
            tryAutoCommitPendingCast(state, "p1", ["G"]);
            expect(state.players[0].manaPool.U).toBe(1);
            expect(state.players[0].manaPool.G).toBe(0);
            expect(state.stack).toHaveLength(1);
        });
    });

    describe("activation path (pendingActivation)", () => {
        it("parks with manaSpendChoice instead of putting the ability on the stack", () => {
            const state = activationState();
            const result = tryAutoCommitPendingActivation(state, "p1");
            expect(result).toBe(null);
            expect(state.pendingActivation).toBeDefined();
            expect(state.pendingActivation!.manaSpendChoice).toEqual({
                generic: 2,
                candidateColors: ["U", "G"],
            });
            expect(state.stack).toHaveLength(0);
        });

        it("findActiveManaSpendChoice locates the parked activation choice", () => {
            const state = activationState();
            tryAutoCommitPendingActivation(state, "p1");
            const active = findActiveManaSpendChoice(state, "p1");
            expect(active!.container).toBe("activation");
        });

        it("resumes and commits, spending exactly the chosen mana", () => {
            const state = activationState();
            tryAutoCommitPendingActivation(state, "p1");
            const { choice } = findActiveManaSpendChoice(state, "p1")!;
            // Spend both generic from G, leaving U.
            validateManaSpendOrder(
                choice,
                ["G", "G"],
                state.players[0].manaPool
            );
            const result = tryAutoCommitPendingActivation(state, "p1", [
                "G",
                "G",
            ]);
            expect(result).not.toBe(null);
            expect(state.pendingActivation).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.players[0].manaPool.G).toBe(0);
            expect(state.players[0].manaPool.U).toBe(1);
        });
    });

    describe("trivial cases do NOT park", () => {
        it("single-color pool auto-picks and commits in one action", () => {
            const state = castState();
            // Overwrite the pool with a single color: no meaningful choice.
            state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };
            const result = tryAutoCommitPendingCast(state, "p1");
            expect(result).not.toBe(null);
            expect(state.pendingCast).toBeUndefined();
            expect(state.stack).toHaveLength(1);
            expect(state.players[0].manaPool.U).toBe(1);
        });

        it("leftover-set-identical pool auto-picks (no park)", () => {
            const state = castState();
            // {U:2,G:2} pay {1} always leaves {U,G} → not ambiguous.
            state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 2, C: 0 };
            const result = tryAutoCommitPendingCast(state, "p1");
            expect(result).not.toBe(null);
            expect(state.pendingCast).toBeUndefined();
        });
    });

    describe("validateManaSpendOrder rejects bad orders (CR 601.2g)", () => {
        const choice = { generic: 1, candidateColors: ["U", "G"] };
        const pool = { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 };

        it("rejects the wrong sum (too many entries)", () => {
            expect(() =>
                validateManaSpendOrder(choice, ["U", "G"], pool)
            ).toThrow(/exactly 1 mana/);
        });

        it("rejects a non-candidate color", () => {
            expect(() => validateManaSpendOrder(choice, ["W"], pool)).toThrow(
                /not a valid mana source/
            );
        });

        it("rejects an order exceeding the pool", () => {
            const bigChoice = { generic: 2, candidateColors: ["U", "G"] };
            // Two U demanded but only one U in pool.
            expect(() =>
                validateManaSpendOrder(bigChoice, ["U", "U"], pool)
            ).toThrow(/Not enough U mana/);
        });

        it("accepts a legal order", () => {
            expect(() =>
                validateManaSpendOrder(choice, ["U"], pool)
            ).not.toThrow();
        });
    });
});
