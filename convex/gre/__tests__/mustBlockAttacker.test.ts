// CR 509.1c — a turn-scoped, attacker-named block requirement ("Target creature
// blocks this creature this turn if able", Rampant Elephant, issue #3713):
// `restrictCombat` `"must-block"` → `SpellContext.setMustBlockAttacker` →
// `CardInstanceState.mustBlockAttackersThisTurn` → `getRequiredBlockerAssignments`.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { rampantElephant } from "../../cards/sets/inv/white.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    foldBlockRequirements,
    getRequiredBlockerAssignments,
} from "../combat";
import { finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";
import type { CardInstanceState, GameState } from "../state";

function creature(
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        ...overrides,
    });
}

function combatState(
    attackers: CardInstanceState[],
    blockers: CardInstanceState[]
): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", { battlefield: attackers }),
            makePlayer("p2", { battlefield: blockers }),
        ],
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function required(state: GameState): Record<string, string[]> {
    return getRequiredBlockerAssignments(
        state.players[0].battlefield,
        state.players[1].battlefield,
        state.combat!.attackerIds,
        state.combat!.blockerAssignments,
        state
    );
}

describe("Rampant Elephant's ability sets the requirement (CR 509.1c)", () => {
    it("resolves onto the TARGET blocker, naming the Elephant as the attacker", () => {
        const elephant = makeInstance(rampantElephant().id, {
            id: "ele",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elephant] }),
                makePlayer("p2", { battlefield: [creature("blk", "p2")] }),
            ],
        });
        resolveActivated(state, elephant, "rampant-elephant-must-block", [
            { type: "permanent", id: "blk" },
        ]);
        const blk = state.players[1].battlefield.find((c) => c.id === "blk")!;
        expect(blk.mustBlockAttackersThisTurn).toEqual(["ele"]);
        // The Elephant itself is untouched — the requirement lives on the blocker.
        expect(elephant.mustBlockAttackersThisTurn).toBeUndefined();
    });

    it("is a no-op when the targeted creature has left the battlefield (CR 608.2b)", () => {
        const elephant = makeInstance(rampantElephant().id, {
            id: "ele",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elephant] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elephant, "rampant-elephant-must-block", [
            { type: "permanent", id: "gone" },
        ]);
        expect(elephant.mustBlockAttackersThisTurn).toBeUndefined();
    });
});

describe("the requirement binds when able (CR 509.1c)", () => {
    it("forces the blocker onto the named attacker, and only that one", () => {
        const state = combatState(
            [
                creature("ele", "p1", { isAttacking: true }),
                creature("other", "p1", { isAttacking: true }),
            ],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        expect(required(state)).toEqual({ blk: ["ele"] });
    });

    it("applies in each declare-blockers step of the turn (the field persists)", () => {
        const state = combatState(
            [creature("ele", "p1", { isAttacking: true })],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        expect(required(state)).toEqual({ blk: ["ele"] });
        state.combat!.blockerAssignments = {};
        expect(required(state)).toEqual({ blk: ["ele"] });
    });

    it("is excused when the named creature is not attacking", () => {
        const state = combatState(
            [creature("ele", "p1"), creature("other", "p1")],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        state.combat!.attackerIds = ["other"];
        expect(required(state)).toEqual({});
    });

    it("is excused when the blocker is tapped", () => {
        const state = combatState(
            [creature("ele", "p1", { isAttacking: true })],
            [
                creature("blk", "p2", {
                    isTapped: true,
                    mustBlockAttackersThisTurn: ["ele"],
                }),
            ]
        );
        expect(required(state)).toEqual({});
    });

    it("is excused when the block would be illegal (attacker can't be blocked)", () => {
        const state = combatState(
            [
                creature("ele", "p1", {
                    isAttacking: true,
                    cantBeBlockedThisTurn: true,
                }),
            ],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        expect(required(state)).toEqual({});
    });

    it("is excused when the blocker can't block this turn", () => {
        const state = combatState(
            [creature("ele", "p1", { isAttacking: true })],
            [
                creature("blk", "p2", {
                    cantBlockThisTurn: true,
                    mustBlockAttackersThisTurn: ["ele"],
                }),
            ]
        );
        expect(required(state)).toEqual({});
    });

    it("maximises: a one-block creature with two requirements obeys exactly one", () => {
        const state = combatState(
            [
                creature("e1", "p1", { isAttacking: true }),
                creature("e2", "p1", { isAttacking: true }),
            ],
            [
                creature("blk", "p2", {
                    mustBlockAttackersThisTurn: ["e1", "e2"],
                }),
            ]
        );
        expect(required(state)).toEqual({ blk: ["e1"] });
    });

    it("maximises: two requirements on two blockers are both obeyed", () => {
        const state = combatState(
            [
                creature("e1", "p1", { isAttacking: true }),
                creature("e2", "p1", { isAttacking: true }),
            ],
            [
                creature("b1", "p2", { mustBlockAttackersThisTurn: ["e1"] }),
                creature("b2", "p2", { mustBlockAttackersThisTurn: ["e2"] }),
            ]
        );
        expect(required(state)).toEqual({ b1: ["e1"], b2: ["e2"] });
    });

    it("is folded into the declaration at confirm time", () => {
        const state = combatState(
            [creature("ele", "p1", { isAttacking: true })],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        foldBlockRequirements(state);
        expect(state.combat!.blockerAssignments).toEqual({ blk: ["ele"] });
    });
});

describe("lifecycle of the requirement", () => {
    it("is cleared at CLEANUP (CR 514.2)", () => {
        const state = combatState(
            [creature("ele", "p1")],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        finalizeCleanup(state);
        expect(
            state.players[1].battlefield[0].mustBlockAttackersThisTurn
        ).toBeUndefined();
    });

    it("survives a serialisation round trip", () => {
        const state = combatState(
            [creature("ele", "p1", { isAttacking: true })],
            [creature("blk", "p2", { mustBlockAttackersThisTurn: ["ele"] })]
        );
        const back = expandState(compactState(state));
        expect(
            back.players[1].battlefield[0].mustBlockAttackersThisTurn
        ).toEqual(["ele"]);
    });
});
