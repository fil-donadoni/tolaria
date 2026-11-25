// Which targets a combat-damage source may assign to after a blocker left
// combat (CR 510.1c, CR 509.1h). The departed blocker keeps its block-graph
// slot as a tombstone (`mintDepartedCombatantId`); it is no damage target.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { earthElemental, hillGiant } from "../../cards/sets/lea/red.cards";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { getEffectiveBlockGraph } from "../banding";
import {
    assignableDamageTargetsForSource,
    combatDamageAssignmentCompleteness,
} from "../damageAssignment";
import {
    buildAutoDamageAssignments,
    buildDefaultDamageAssignments,
} from "../phases";
import {
    isDepartedCombatantId,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../state";

function permanent(
    defId: string,
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        ...overrides,
    });
}

/** p1's Earth Elemental (4/5) blocked by `blockerIds` (Grizzly Bears), of
 *  which `leaving` then die — through the engine's own departure path, so
 *  their slots are the tombstones a game produces. */
function blockedThenLeft(
    blockerIds: string[],
    leaving: string[],
    staticAbilities: string[] = []
): GameState {
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    permanent(earthElemental().id, "atk", "p1", {
                        isAttacking: true,
                        staticAbilities,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: blockerIds.map((id) =>
                    permanent(grizzlyBears().id, id, "p2", { isBlocking: true })
                ),
            }),
        ],
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: Object.fromEntries(
                blockerIds.map((id) => [id, ["atk"]])
            ),
            blockersConfirmed: true,
            blockedAttackerIds: ["atk"],
        },
    });
    for (const id of leaving) removePermanentTo(state, id, "graveyard");
    return state;
}

const seed = (state: GameState) =>
    buildDefaultDamageAssignments(state, "regular").atk;

describe("assignable damage targets after a blocker left (CR 510.1c)", () => {
    it("keeps the tombstone in the block graph but not among the targets", () => {
        const state = blockedThenLeft(["b1", "b2"], ["b1"]);
        const graph =
            getEffectiveBlockGraph(state).blockersByAttacker["atk"] ?? [];
        expect(graph.filter(isDepartedCombatantId)).toHaveLength(1);
        expect(graph).toContain("b2");

        expect(assignableDamageTargetsForSource(state, "atk")).toEqual({
            targetIds: ["b2"],
        });
    });

    it("seeds full power on the one live blocker, and that default is complete", () => {
        const state = blockedThenLeft(["b1", "b2"], ["b1"]);
        expect(seed(state)).toEqual({ b2: 4 });
        expect(
            combatDamageAssignmentCompleteness(state, "atk", seed(state))
        ).toEqual({ complete: true, assigned: 4, required: 4 });
    });

    it("a trampler seeds lethal on the live blocker and the rest on the player, nothing on the tombstone", () => {
        const state = blockedThenLeft(["b1", "b2"], ["b1"], ["trample"]);
        expect(assignableDamageTargetsForSource(state, "atk")).toEqual({
            targetIds: ["b2"],
            excessSinkId: "p2",
        });
        expect(seed(state)).toEqual({ b2: 2, p2: 2 });
    });

    it("with every blocker gone it assigns nothing and owes nothing", () => {
        const state = blockedThenLeft(["b1", "b2"], ["b1", "b2"]);
        expect(assignableDamageTargetsForSource(state, "atk")).toEqual({
            targetIds: [],
        });
        expect(seed(state)).toEqual({});
        expect(combatDamageAssignmentCompleteness(state, "atk", {})).toEqual({
            complete: true,
            assigned: 0,
            required: 0,
        });
    });

    it("neither seed builder names a lone departed blocker", () => {
        const state = blockedThenLeft(["b1"], ["b1"]);
        expect(seed(state)).toEqual({});
        expect(
            buildAutoDamageAssignments(state, "regular").atk
        ).toBeUndefined();
    });

    it("a banding blocker's departed band member is no target either (CR 702.22k)", () => {
        const state = blockedThenLeft(["b1"], []);
        state.players[0].battlefield.push(
            permanent(hillGiant().id, "atk2", "p1", { isAttacking: true })
        );
        state.combat!.attackerIds = ["atk", "atk2"];
        state.combat!.bands = [{ bandId: "band", memberIds: ["atk", "atk2"] }];
        removePermanentTo(state, "atk", "graveyard");

        expect(assignableDamageTargetsForSource(state, "b1")).toEqual({
            targetIds: ["atk2"],
        });
        expect(buildDefaultDamageAssignments(state, "regular").b1).toEqual({
            atk2: 2,
        });
    });
});
