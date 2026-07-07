import { describe, it, expect } from "vitest";
import {
    tryAutoCommitPendingCast,
    tryAutoCommitPendingActivation,
    abandonPendingPayment,
} from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";

const LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // Savannah Lions — {W}
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains — {T}: add {W}

/** Mid-payment snapshot: p1 announced Savannah Lions, tapped a Plains for {W}.
 *  Mana is in the pool and the cost is fully covered, so the only thing
 *  separating this state from a committed cast is priority. */
function paymentInProgress(overrides: Partial<GameState> = {}): GameState {
    const lions = makeInstance(LIONS, { id: "lions", zone: "hand" });
    const plains = makeInstance(PLAINS, { id: "plains", isTapped: true });
    const p1 = makePlayer("p1", {
        hand: [lions],
        battlefield: [plains],
        manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
    });
    return makeState({
        players: [p1, makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "lions",
            manaCost: { W: 1 },
            tappedLandIds: ["plains"],
        },
        ...overrides,
    });
}

describe("payment priority guard (CR 601.2 / 601.2i)", () => {
    it("commits the cast when the payer still has priority", () => {
        const state = paymentInProgress({ priorityPlayerId: "p1" });

        const result = tryAutoCommitPendingCast(state, "p1");

        expect(result).not.toBeNull();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].castById).toBe("p1");
        // Spell left the hand.
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("refuses to commit when priority has moved to the opponent", () => {
        // The bug: a stale pendingCast lingered after the payer passed/ended
        // their turn. A later auto-tap must NOT push the spell on the opponent's
        // turn (sorcery-speed cast at an illegal time).
        const state = paymentInProgress({ priorityPlayerId: "p2" });

        const result = tryAutoCommitPendingCast(state, "p1");

        expect(result).toBeNull();
        // Nothing reached the stack; the spell is still in hand.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1);
        // pendingCast is left for the abandon path to roll back, not committed.
        expect(state.pendingCast).toBeDefined();
    });
});

describe("tryAutoCommitPendingActivation — double-tap source race", () => {
    it("drops the payment silently when the source is already tapped", () => {
        // A double-click on a land paying a {T}-cost ability re-enters commit
        // after the source got tapped by the first click. This must be a silent
        // no-op (drop the pending payment), not a thrown server error surfaced
        // to the user for a misclick.
        const source = makeInstance(PLAINS, { id: "src", isTapped: true });
        const p1 = makePlayer("p1", { battlefield: [source] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            pendingActivation: {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: "mana",
                manaCost: {},
                tappedLandIds: [],
                tapSource: true,
                sacrificeSource: false,
            },
        });

        // Must not throw "Source became tapped during payment"; returns null.
        const result = tryAutoCommitPendingActivation(state, "p1");
        expect(result).toBeNull();
        // Payment dropped; nothing reached the stack.
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });
});

describe("abandonPendingPayment — rollback on surrendered priority", () => {
    it("rolls back the tapped land and clears the cast for the owner", () => {
        const state = paymentInProgress();

        abandonPendingPayment(state, "p1");

        expect(state.pendingCast).toBeUndefined();
        const plains = state.players[0].battlefield.find(
            (c) => c.id === "plains"
        )!;
        expect(plains.isTapped).toBe(false);
        // Mana returned to nothing — no phantom {W} left floating.
        expect(state.players[0].manaPool.W).toBe(0);
        // Spell stays in hand; nothing was cast.
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });

    it("does not touch a pending cast that belongs to another player", () => {
        const state = paymentInProgress();

        abandonPendingPayment(state, "p2");

        expect(state.pendingCast).toBeDefined();
        const plains = state.players[0].battlefield.find(
            (c) => c.id === "plains"
        )!;
        expect(plains.isTapped).toBe(true);
    });
});
