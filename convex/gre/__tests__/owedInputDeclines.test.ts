// Issue #9001 — the auth-free decline cores (`gre/owedInputDeclines.ts`).
// Each core runs on a plain `GameState` with no Convex context and reports
// whether it changed the state, so a server-side caller with no `ctx.auth`
// (the Bot liveness deadline, PRD issue #8998) can tell progress from a no-op.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    cancelActivationOnState,
    cancelAttackTaxOnState,
    cancelCastOnState,
    cancelTargetOnState,
    confirmBlockersOnState,
    declareNoBlockersOnState,
    passPriorityOnState,
} from "../owedInputDeclines";
import type { GameState, StackItem } from "../state";

const LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // Savannah Lions — {W}
const PLAINS = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains — {T}: add {W}
const CHANGED = { changed: true };

/** p1 tapped a Plains for {W} toward a payment still open. */
function p1WithTappedPlains() {
    return makePlayer("p1", {
        hand: [makeInstance(LIONS, { id: "lions", zone: "hand" })],
        battlefield: [
            makeInstance(PLAINS, { id: "plains", isTapped: true }),
            makeInstance(grizzlyBears().id, {
                id: "attacker",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ],
        manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
    });
}

function plainsOf(state: GameState) {
    return state.players[0].battlefield.find((c) => c.id === "plains")!;
}

/** p1 attacks with a Bear; p2's Bear is assigned to block it. */
function blockersOpen(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "attacker",
                        controllerId: "p1",
                        ownerId: "p1",
                        isAttacking: true,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears().id, {
                        id: "blocker",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: ["attacker"],
            confirmed: true,
            blockerAssignments: { blocker: ["attacker"] },
            blockersConfirmed: false,
        },
    });
}

describe("passPriorityOnState (CR 117.3d / 117.4)", () => {
    it("hands priority to the next player and counts the pass", () => {
        const state = makeState({ priorityPlayerId: "p1" });

        expect(passPriorityOnState(state, "p1")).toEqual(CHANGED);

        expect(state.priorityPlayerId).toBe("p2");
        expect(state.passCount).toBe(1);
    });

    it("reports a pass from a player without priority as a no-op, state untouched", () => {
        const state = makeState({ priorityPlayerId: "p2" });
        const before = structuredClone(state);

        expect(passPriorityOnState(state, "p1")).toEqual({
            changed: false,
            reason: "not-priority-holder",
        });

        expect(state).toEqual(before);
    });
});

describe("confirmBlockersOnState (CR 509.1 / 509.2)", () => {
    it("locks in the assigned blocks and gives the active player priority", () => {
        const state = blockersOpen();

        expect(confirmBlockersOnState(state, "p2")).toEqual(CHANGED);

        expect(state.combat!.blockersConfirmed).toBe(true);
        expect(state.combat!.blockerAssignments).toEqual({
            blocker: ["attacker"],
        });
        expect(
            state.players[1].battlefield.find((c) => c.id === "blocker")!
                .isBlocking
        ).toBe(true);
        expect(state.priorityPlayerId).toBe("p1");
        expect(state.passCount).toBe(0);
    });
});

describe("declareNoBlockersOnState (CR 509.1a)", () => {
    it("drops every assignment and confirms an empty declaration", () => {
        const state = blockersOpen();
        state.combat!.pendingBlockerId = "blocker";

        expect(declareNoBlockersOnState(state, "p2")).toEqual(CHANGED);

        expect(state.combat!.blockersConfirmed).toBe(true);
        expect(state.combat!.blockerAssignments).toEqual({});
        expect(state.combat!.pendingBlockerId).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "blocker")!
                .isBlocking
        ).toBeFalsy();
        expect(state.priorityPlayerId).toBe("p1");
    });
});

describe("cancelAttackTaxOnState (CR 508.1h / 733.1)", () => {
    it("untaps the tax payment, refunds its mana and reopens attacker selection", () => {
        const state = makeState({
            players: [p1WithTappedPlains(), makePlayer("p2")],
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackerIds: ["attacker"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
                pendingAttackManaTax: {
                    playerId: "p1",
                    cost: { generic: 2 },
                    reason: "attack tax",
                    tappedLandIds: ["plains"],
                },
            },
        });

        expect(cancelAttackTaxOnState(state, "p1")).toEqual(CHANGED);

        expect(plainsOf(state).isTapped).toBe(false);
        expect(state.players[0].manaPool.W).toBe(0);
        expect(state.combat!.pendingAttackManaTax).toBeUndefined();
        expect(state.combat!.attackerIds).toEqual([]);
    });
});

describe("cancelTargetOnState (CR 603.3d / 601.2)", () => {
    it("declining a mandatory TRIGGER target removes the trigger from the stack", () => {
        const state = makeState();
        state.stack.push({
            id: "trig",
            card: { id: "trigger-source" },
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
            types: [],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            castById: "p1",
        } as unknown as StackItem);
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "trig",
            targetType: "any",
            count: 1,
            selected: [],
            kind: "trigger",
        } as GameState["pendingTarget"];

        expect(cancelTargetOnState(state, "p1")).toEqual(CHANGED);

        expect(state.stack).toEqual([]);
        expect(state.pendingTarget).toBeUndefined();
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("cancelling an ANNOUNCED cast's target selection rewinds it — the card stays in hand", () => {
        const state = makeState({
            players: [p1WithTappedPlains(), makePlayer("p2")],
        });
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "lions",
            targetType: "any",
            count: 1,
            selected: [],
            kind: "cast",
        } as GameState["pendingTarget"];

        expect(cancelTargetOnState(state, "p1")).toEqual(CHANGED);

        expect(state.pendingTarget).toBeUndefined();
        expect(state.stack).toEqual([]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lions"]);
    });
});

describe("cancelCastOnState (CR 601.2 / 733.1)", () => {
    it("reverses the payment taps and clears the pending cast", () => {
        const state = makeState({
            players: [p1WithTappedPlains(), makePlayer("p2")],
            pendingCast: {
                playerId: "p1",
                cardInstanceId: "lions",
                manaCost: { W: 1 },
                tappedLandIds: ["plains"],
            },
        });

        expect(cancelCastOnState(state, "p1")).toEqual(CHANGED);

        expect(state.pendingCast).toBeUndefined();
        expect(plainsOf(state).isTapped).toBe(false);
        expect(state.players[0].manaPool.W).toBe(0);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lions"]);
    });
});

describe("cancelActivationOnState (CR 602.2 / 733.1)", () => {
    it("reverses the payment taps and clears the pending activation", () => {
        const state = makeState({
            players: [p1WithTappedPlains(), makePlayer("p2")],
            pendingActivation: {
                playerId: "p1",
                cardInstanceId: "attacker",
                abilityId: "pump",
                manaCost: { W: 1 },
                tappedLandIds: ["plains"],
                tapSource: false,
                sacrificeSource: false,
            },
        });

        expect(cancelActivationOnState(state, "p1")).toEqual(CHANGED);

        expect(state.pendingActivation).toBeUndefined();
        expect(plainsOf(state).isTapped).toBe(false);
        expect(state.players[0].manaPool.W).toBe(0);
    });
});
