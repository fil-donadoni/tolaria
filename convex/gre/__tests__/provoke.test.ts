// Provoke (CR 702.39).
//
// CR 702.39a — "Whenever this creature attacks, you may choose to have target
// creature defending player controls block this creature this combat if able. If
// you do, untap that creature."
// CR 702.39b — "If a creature has multiple instances of provoke, each triggers
// separately."
//
// The trigger is derived from the live keyword multiset, so every board here goes
// through the production path: `emitAttackersDeclaredEvents` → the trigger scan →
// the target announcement → the stack → `resolveTopOfStack` → the may choice.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    PROVOKE_TRIGGER,
    PROVOKE_TRIGGER_ID,
} from "../../cards/abilities/provoke";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { finalizeTargetSelection } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getRequiredBlockerAssignments } from "../combat";
import { validateAbilityEffectScript } from "../effects/validate";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import { advancePhase, emitAttackersDeclaredEvents } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    beginApplyingStaticEffects,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const PROVOKER: CardDefinition = {
    id: "test-only-provoker",
    rarity: "common",
    name: "Test Provoker",
    oracleText: "Provoke",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 1,
    toughness: 1,
    staticAbilities: ["provoke"],
};

const VANILLA: CardDefinition = {
    id: "test-only-vanilla",
    rarity: "common",
    name: "Test Vanilla",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

const PROVOKE_ANTHEM: CardDefinition = {
    id: "test-only-provoke-anthem",
    rarity: "common",
    name: "Test Provoke Anthem",
    oracleText: "All Bear creatures have provoke.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView) =>
                target.subtypes.includes("Bear"),
            keyword: "provoke",
        },
    ],
};

function withDefs(run: () => void): void {
    withTemporaryDefinition(PROVOKER, () =>
        withTemporaryDefinition(VANILLA, () =>
            withTemporaryDefinition(PROVOKE_ANTHEM, run)
        )
    );
}

function creature(
    def: CardDefinition,
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        ...overrides,
    });
}

function combat(
    attacker: CardInstanceState,
    defenderBattlefield: CardInstanceState[],
    attackerExtra: CardInstanceState[] = []
): GameState {
    attacker.isAttacking = true;
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker, ...attackerExtra] }),
            makePlayer("p2", { battlefield: defenderBattlefield }),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

function provokeOnStack(state: GameState): number {
    return state.stack.filter(
        (s) => s.triggeredAbilityId === PROVOKE_TRIGGER_ID
    ).length;
}

/** The requirement as the declaration fold reads it. */
function forcedBlocks(state: GameState): Record<string, string[]> {
    return getRequiredBlockerAssignments(
        state.players[0].battlefield,
        state.players[1].battlefield,
        state.combat?.attackerIds ?? [],
        {},
        state
    );
}

function resolveAndAnswer(state: GameState, accept: boolean): void {
    resolveTopOfStack(state);
    applyMayPaySubmit(state, { playerId: "p1", accept });
}

describe("Provoke (CR 702.39a)", () => {
    it("the body is a valid script on ATTACKERS_DECLARED", () => {
        expect(
            validateAbilityEffectScript(
                PROVOKE_TRIGGER,
                "Provoke",
                "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });

    it("accepting untaps the target and requires it to block this attacker", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2", { isTapped: true });
            const state = combat(creature(PROVOKER, "atk", "p1"), [blocker]);
            emitAttackersDeclaredEvents(state);
            expect(provokeOnStack(state)).toBe(1);
            expect(state.stack[state.stack.length - 1].targets).toEqual([
                { type: "permanent", id: "blk" },
            ]);
            resolveAndAnswer(state, true);
            expect(blocker.isTapped).toBeFalsy();
            expect(forcedBlocks(state)).toEqual({ blk: ["atk"] });
        });
    });

    it("declining leaves the target tapped and unrequired", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2", { isTapped: true });
            const state = combat(creature(PROVOKER, "atk", "p1"), [blocker]);
            emitAttackersDeclaredEvents(state);
            resolveAndAnswer(state, false);
            expect(blocker.isTapped).toBe(true);
            expect(blocker.mustBlockAttackersThisCombat).toBeUndefined();
        });
    });

    it("targets only a creature the defending player controls (CR 506.2)", () => {
        withDefs(() => {
            const state = combat(
                creature(PROVOKER, "atk", "p1"),
                [],
                [creature(VANILLA, "own", "p1")]
            );
            emitAttackersDeclaredEvents(state);
            // CR 603.3d — no legal target: the ability is removed from the stack.
            expect(provokeOnStack(state)).toBe(0);
            expect(state.pendingChoices ?? []).toEqual([]);
        });
    });

    it("a real target choice is announced as the trigger goes on the stack (CR 603.3d)", () => {
        withDefs(() => {
            const chosen = creature(VANILLA, "chosen", "p2");
            const other = creature(VANILLA, "other", "p2");
            const state = combat(creature(PROVOKER, "atk", "p1"), [
                other,
                chosen,
            ]);
            emitAttackersDeclaredEvents(state);
            const pending = state.pendingTarget!;
            expect(pending.playerId).toBe("p1");
            pending.selected = [{ type: "permanent", id: "chosen" }];
            finalizeTargetSelection(state, pending, "p1");
            resolveAndAnswer(state, true);
            expect(forcedBlocks(state)).toEqual({ chosen: ["atk"] });
        });
    });

    it("a creature granted provoke by a static effect triggers (printed or granted)", () => {
        withDefs(() => {
            const anthem = creature(PROVOKE_ANTHEM, "anthem", "p1");
            const state = combat(
                creature(VANILLA, "bear", "p1"),
                [creature(VANILLA, "blk", "p2")],
                [anthem]
            );
            beginApplyingStaticEffects(state, anthem);
            emitAttackersDeclaredEvents(state);
            expect(provokeOnStack(state)).toBe(1);
            resolveAndAnswer(state, true);
            expect(forcedBlocks(state)).toEqual({ blk: ["bear"] });
        });
    });

    it("a blocker that cannot legally block is untapped but not forced (CR 509.1c)", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2", {
                isTapped: true,
                cantBlockThisTurn: true,
            });
            const state = combat(creature(PROVOKER, "atk", "p1"), [blocker]);
            emitAttackersDeclaredEvents(state);
            resolveAndAnswer(state, true);
            expect(blocker.isTapped).toBeFalsy();
            expect(forcedBlocks(state)).toEqual({});
        });
    });

    it("with the attacker gone in response, the target still untaps and nothing binds", () => {
        withDefs(() => {
            const attacker = creature(PROVOKER, "atk", "p1");
            const blocker = creature(VANILLA, "blk", "p2", { isTapped: true });
            const state = combat(attacker, [blocker]);
            emitAttackersDeclaredEvents(state);
            // CR 113.7a — the ability exists independently of its source.
            removePermanentTo(state, attacker.id, "graveyard");
            resolveAndAnswer(state, true);
            expect(blocker.isTapped).toBeFalsy();
            expect(blocker.mustBlockAttackersThisCombat).toBeUndefined();
        });
    });

    it("the requirement survives a save and reaches the client through the fold", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2", { isTapped: true });
            const state = combat(creature(PROVOKER, "atk", "p1"), [blocker]);
            emitAttackersDeclaredEvents(state);
            resolveAndAnswer(state, true);
            const restored = expandState(compactState(state));
            expect(forcedBlocks(restored)).toEqual({ blk: ["atk"] });
            const view = projectPublicState(restored, 1, "p2");
            const slim = view.players[1].battlefield.find(
                (c) => c.id === "blk"
            )!;
            expect(slim.isTapped).toBeFalsy();
        });
    });

    it("wire: the trigger and its target reach both seats while on the stack", () => {
        withDefs(() => {
            const state = combat(creature(PROVOKER, "atk", "p1"), [
                creature(VANILLA, "blk", "p2"),
            ]);
            emitAttackersDeclaredEvents(state);
            for (const viewer of ["p1", "p2"]) {
                const item = projectPublicState(state, 1, viewer).stack.find(
                    (s) => s.triggeredAbilityId === PROVOKE_TRIGGER_ID
                );
                expect(item?.targets).toEqual([
                    { type: "permanent", id: "blk" },
                ]);
            }
        });
    });
});

describe("Provoke's duration: this combat, not this turn (CR 702.39a, 509.1c)", () => {
    function acceptedOnto(blocker: CardInstanceState): GameState {
        const state = combat(creature(PROVOKER, "atk", "p1"), [blocker]);
        emitAttackersDeclaredEvents(state);
        resolveAndAnswer(state, true);
        state.stack = [];
        return state;
    }

    it("ends with the combat phase, so an extra combat does not re-bind it", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2");
            const state = acceptedOnto(blocker);
            expect(blocker.mustBlockAttackersThisCombat).toEqual(["atk"]);
            state.phase = "END_OF_COMBAT";
            advancePhase(state);
            expect(blocker.mustBlockAttackersThisCombat).toBeUndefined();
            state.combat = {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            expect(forcedBlocks(state)).toEqual({});
        });
    });

    it("a turn-scoped requirement on the same creature outlives the combat (CR 509.1c)", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2", {
                mustBlockAttackersThisTurn: ["atk"],
            });
            const state = combat(creature(PROVOKER, "atk", "p1"), [blocker]);
            state.phase = "END_OF_COMBAT";
            advancePhase(state);
            expect(blocker.mustBlockAttackersThisTurn).toEqual(["atk"]);
        });
    });

    it("a named attacker changing zones ends the requirement (CR 400.7)", () => {
        withDefs(() => {
            const blocker = creature(VANILLA, "blk", "p2");
            const state = acceptedOnto(blocker);
            const attacker = state.players[0].battlefield[0];
            removePermanentTo(state, attacker.id, "hand");
            expect(blocker.mustBlockAttackersThisCombat).toBeUndefined();
        });
    });
});

describe("Provoke's instances (CR 702.39b)", () => {
    it("two instances trigger separately and can name two blockers", () => {
        withDefs(() => {
            const state = combat(
                creature(PROVOKER, "atk", "p1", {
                    staticAbilities: ["provoke", "provoke"],
                }),
                [creature(VANILLA, "b1", "p2"), creature(VANILLA, "b2", "p2")]
            );
            emitAttackersDeclaredEvents(state);
            resolveTriggerOrder(state);
            for (const id of ["b1", "b2"]) {
                const pending = state.pendingTarget!;
                pending.selected = [{ type: "permanent", id }];
                finalizeTargetSelection(state, pending, "p1");
            }
            expect(provokeOnStack(state)).toBe(2);
            resolveAndAnswer(state, true);
            resolveAndAnswer(state, true);
            expect(forcedBlocks(state)).toEqual({
                b1: ["atk"],
                b2: ["atk"],
            });
        });
    });
});

describe("Provoke on a creature that lost its abilities (CR 613.1f)", () => {
    it("a removed occurrence is no instance", () => {
        withDefs(() => {
            const state = combat(
                creature(PROVOKER, "atk", "p1", { staticAbilities: [] }),
                [creature(VANILLA, "blk", "p2")]
            );
            emitAttackersDeclaredEvents(state);
            expect(provokeOnStack(state)).toBe(0);
        });
    });
});
