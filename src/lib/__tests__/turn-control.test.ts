// Turn Control on the client (CR 723, ADR 0181): the lens a controlled
// player's board reads its state through, the lock the turn-based
// declarations need on top of it, and the seat a controller's board follows.
import { describe, expect, it } from "vitest";
import { computeViewerSeat, informationSeatsFor } from "@convex/soloViewer";
import {
    computeActingSeat,
    computeHasPriority,
    computePriorityState,
    isSelectingAttackers,
    isWaitingOnOpponent,
} from "~/lib/priority";
import {
    isSeatLocked,
    lockedSeatView,
    turnControlNotice,
    type AnsweredState,
} from "~/lib/turn-control";

const CONTROL = [
    { controlledId: "bob", controllerId: "alice", active: true as const },
];

type TestState = AnsweredState & { activePlayerId: string; phase: string };

function bobsControlledTurn(overrides: Partial<TestState> = {}): TestState {
    return {
        turnControls: CONTROL,
        activePlayerId: "bob",
        priorityPlayerId: "bob",
        phase: "PRECOMBAT_MAIN",
        players: [
            { id: "alice", hand: [null], graveyard: [], exile: [] },
            // Bob's zones as the wire carries them for bob himself.
            {
                id: "bob",
                hand: [{ id: "h1", legalActions: ["play"] }],
                graveyard: [{ id: "g1", legalActions: ["cast"] }],
                exile: [{ id: "e1" }],
            },
        ],
        ...overrides,
    };
}

describe("lockedSeatView — the controlled player's reading of the state (CR 723.5)", () => {
    it("is the identity for a seat nobody else controls", () => {
        const state = bobsControlledTurn();
        expect(lockedSeatView(state, "alice")).toBe(state);
        const free = bobsControlledTurn({ turnControls: undefined });
        expect(lockedSeatView(free, "bob")).toBe(free);
        // A pending control locks nothing yet (CR 723.1).
        const pending = bobsControlledTurn({
            turnControls: [{ controlledId: "bob", controllerId: "alice" }],
        });
        expect(isSeatLocked(pending, "bob")).toBe(false);
    });

    it("restates every owed input as the controller's", () => {
        const state = bobsControlledTurn({
            pendingCast: { playerId: "bob" },
            pendingActivation: { playerId: "bob" },
            pendingTarget: { playerId: "bob" },
            pendingChoices: [{ playerId: "bob" }, { playerId: "alice" }],
            combat: {
                damageAssignerIds: { c1: "bob", c2: "alice" },
                pendingAttackManaTax: { playerId: "bob" },
                pendingAttackSacrifice: { playerId: "bob" },
            },
        });
        const view = lockedSeatView(state, "bob");
        expect(view.priorityPlayerId).toBe("alice");
        expect(view.pendingCast?.playerId).toBe("alice");
        expect(view.pendingActivation?.playerId).toBe("alice");
        expect(view.pendingTarget?.playerId).toBe("alice");
        expect(view.pendingChoices?.map((c) => c.playerId)).toEqual([
            "alice",
            "alice",
        ]);
        expect(view.combat?.damageAssignerIds).toEqual({
            c1: "alice",
            c2: "alice",
        });
        expect(view.combat?.pendingAttackManaTax?.playerId).toBe("alice");
        expect(view.combat?.pendingAttackSacrifice?.playerId).toBe("alice");
        // Display facts are untouched: it is still bob's turn (CR 723.3).
        expect(view.activePlayerId).toBe("bob");
        // The input is not mutated.
        expect(state.priorityPlayerId).toBe("bob");
    });

    it("strips the local seat's card actions and leaves the cards", () => {
        const view = lockedSeatView(bobsControlledTurn(), "bob");
        const bob = view.players.find((p) => p.id === "bob")!;
        expect(bob.hand).toEqual([{ id: "h1", legalActions: [] }]);
        expect(bob.graveyard).toEqual([{ id: "g1", legalActions: [] }]);
        expect(bob.exile).toEqual([{ id: "e1" }]);
    });
});

describe("the board's priority reads for a controlled player", () => {
    const ctxFor = (state: TestState) => ({
        playerId: "bob",
        activePlayerId: state.activePlayerId,
        priorityPlayerId: state.priorityPlayerId!,
        phase: state.phase,
        actingLocked: true,
    });

    it("the controlled player never holds priority on their own controlled turn", () => {
        const ctx = ctxFor(lockedSeatView(bobsControlledTurn(), "bob"));
        expect(computeHasPriority(ctx)).toBe(false);
        expect(computePriorityState(ctx)).toBe("opponent");
        expect(computeActingSeat(ctx)).toBe("opponent");
    });

    it("the lock alone already refuses priority — the raw state says it is bob's", () => {
        const ctx = ctxFor(bobsControlledTurn());
        expect(computeHasPriority(ctx)).toBe(false);
        expect(computePriorityState(ctx)).toBe("opponent");
        expect(computeHasPriority({ ...ctx, actingLocked: false })).toBe(true);
    });

    it("attack declaration is the controller's: the active controlled player is waiting, not selecting", () => {
        const ctx = {
            ...ctxFor(lockedSeatView(bobsControlledTurn(), "bob")),
            phase: "DECLARE_ATTACKERS",
            combat: { attackerIds: [], confirmed: false } as never,
        };
        expect(isSelectingAttackers(ctx)).toBe(false);
        expect(isWaitingOnOpponent(ctx)).toBe(true);
        // Without the lock the same position reads as bob's to declare.
        expect(isSelectingAttackers({ ...ctx, actingLocked: false })).toBe(
            true
        );
    });
});

describe("the seat a board views (computeViewerSeat) and what it sees (CR 723.4)", () => {
    const viewerCtx = (priorityPlayerId: string) => ({
        activePlayerId: "bob",
        priorityPlayerId,
        phase: "PRECOMBAT_MAIN",
        playerIds: ["alice", "bob"],
        turnControls: CONTROL,
    });

    it("the controller follows the controlled seat while it owes input, and returns to their own", () => {
        expect(computeViewerSeat(viewerCtx("bob"), "alice")).toBe("bob");
        expect(computeViewerSeat(viewerCtx("alice"), "alice")).toBe("alice");
    });

    it("the controlled player stays on their own seat", () => {
        expect(computeViewerSeat(viewerCtx("bob"), "bob")).toBe("bob");
        expect(computeViewerSeat(viewerCtx("alice"), "bob")).toBe("bob");
    });

    it("with no control nobody leaves their seat", () => {
        const ctx = { ...viewerCtx("bob"), turnControls: undefined };
        expect(computeViewerSeat(ctx, "alice")).toBe("alice");
    });

    it("the controller sees both seats' information; the controlled player only their own", () => {
        const view = { turnControls: CONTROL };
        expect(informationSeatsFor(view, "alice", "bob")).toEqual(["alice"]);
        expect(informationSeatsFor(view, "alice", "alice")).toEqual(["bob"]);
        expect(informationSeatsFor(view, "bob", "bob")).toEqual([]);
        expect(informationSeatsFor({}, "alice", "alice")).toEqual([]);
    });
});

describe("turnControlNotice", () => {
    it("names the controller to the controlled player and the controlled seat to the controller", () => {
        const view = { turnControls: CONTROL };
        expect(turnControlNotice(view, "bob")).toEqual({
            kind: "controlled",
            byId: "alice",
        });
        expect(turnControlNotice(view, "alice")).toEqual({
            kind: "controlling",
            seatId: "bob",
        });
    });

    it("is silent with no control, a pending one, or control of oneself (CR 723.9)", () => {
        expect(turnControlNotice({}, "alice")).toBeNull();
        expect(
            turnControlNotice(
                {
                    turnControls: [
                        { controlledId: "bob", controllerId: "alice" },
                    ],
                },
                "alice"
            )
        ).toBeNull();
        expect(
            turnControlNotice(
                {
                    turnControls: [
                        {
                            controlledId: "bob",
                            controllerId: "bob",
                            active: true,
                        },
                    ],
                },
                "bob"
            )
        ).toBeNull();
    });
});
