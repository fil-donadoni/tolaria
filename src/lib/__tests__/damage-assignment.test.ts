// Full-path test for combat-damage assignment (CR 702.19b / CR 702.2c, #2444):
// GRE seed builder → `projectPublicState` → the assigner panel's gating.
//
// The failure this guards is the "two pieces pass separately, fail together"
// shape: the server now REJECTS an assignment that gives the defending player
// damage while a blocker sits below its lethal threshold, so a panel computing
// lethal as raw toughness would happily offer a click the mutation refuses —
// and the player would see an unexplained error. Both sides must agree on the
// SAME numbers, read through the wire projection the panel actually gets.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import type { CardType, Color } from "@convex/cards/types";
import type { Combat, Player } from "~/types/game";
import {
    buildAutoDamageAssignments,
    buildDefaultDamageAssignments,
} from "@convex/gre/phases";
import {
    damageAssignmentLethalViolation,
    lethalThresholdsForSource,
} from "@convex/gre/damageAssignment";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import {
    assignmentIsRejected,
    damageAssignmentPlan,
} from "~/lib/damage-assignment";

function creature(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power,
        toughness,
        staticAbilities: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

function combatState(
    attackers: CardInstanceState[],
    defenderPermanents: CardInstanceState[],
    blockerAssignments: Record<string, string[]>,
    combatOverrides: Partial<NonNullable<GameState["combat"]>> = {}
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        players: [
            makePlayer("p1", { battlefield: attackers }),
            makePlayer("p2", { battlefield: defenderPermanents }),
        ],
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments,
            blockersConfirmed: true,
            damageConfirmed: false,
            ...combatOverrides,
        },
    });
}

/** The exact pair of values the panel reads: the projected combat and players
 *  from the viewer's own wire state — never a hand-built view. */
function projectedView(state: GameState): {
    combat: Combat;
    players: Player[];
} {
    const projected = projectPublicState(state, 1, "p1");
    return {
        combat: projected.combat as unknown as Combat,
        players: projected.players as unknown as Player[],
    };
}

describe("assigner panel agrees with the server (CR 702.19b, issue #2444)", () => {
    it("computes the same deathtouch threshold as the GRE, through the projection", () => {
        // CR 702.2c — a 4/4 trample+deathtouch attacker only owes its 3/3
        // blocker 1 damage.
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample", "deathtouch"],
            isAttacking: true,
        });
        const blocker = creature("blk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = combatState([attacker], [blocker], { blk: ["atk"] });
        state.combat!.damageAssignments = buildAutoDamageAssignments(
            state,
            "regular"
        );

        const { combat, players } = projectedView(state);
        const plan = damageAssignmentPlan(combat, players, "atk", "p2");

        expect(plan.thresholds).toEqual(
            lethalThresholdsForSource(state, "atk", {})
        );
        expect(plan.thresholds).toEqual({ blk: 1 });
        expect(plan.excessSinkId).toBe("p2");
    });

    it("carries marked damage across the wire into the threshold", () => {
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const blocker = creature("blk", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
            damageMarked: 2,
        });
        const state = combatState([attacker], [blocker], { blk: ["atk"] });

        const { combat, players } = projectedView(state);
        expect(
            damageAssignmentPlan(combat, players, "atk", "p2").thresholds
        ).toEqual({ blk: 1 });
    });

    it("does not lower the threshold for a protected blocker (CR 702.19b example 2)", () => {
        const attacker = creature("atk", 6, 6, {
            staticAbilities: ["trample"],
            colorOverride: ["G"] as Color[],
            isAttacking: true,
        });
        const blocker = creature("blk", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
            staticAbilities: ["protection from green"],
        });
        const state = combatState([attacker], [blocker], { blk: ["atk"] });

        const { combat, players } = projectedView(state);
        expect(
            damageAssignmentPlan(combat, players, "atk", "p2").thresholds
        ).toEqual({ blk: 2 });
    });

    it("targets the attacked planeswalker as the excess sink (CR 702.19f)", () => {
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const blocker = creature("blk", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const pw = creature("pw", 0, 0, {
            types: ["Planeswalker"] as CardType[],
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 4 },
        });
        const state = combatState(
            [attacker],
            [blocker, pw],
            { blk: ["atk"] },
            { attackTargets: { atk: "pw" } }
        );

        const { combat, players } = projectedView(state);
        expect(
            damageAssignmentPlan(combat, players, "atk", "p2").excessSinkId
        ).toBe("pw");
    });

    describe("the panel never offers a click the mutation would refuse", () => {
        /** 4/4 trampler blocked by a 1/3 and a 1/1 — the multi-blocker modal. */
        function twoBlockerState(): GameState {
            const attacker = creature("atk", 4, 4, {
                staticAbilities: ["trample"],
                isAttacking: true,
            });
            const big = creature("big", 1, 3, {
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            });
            const small = creature("small", 1, 1, {
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            });
            const state = combatState([attacker], [big, small], {
                big: ["atk"],
                small: ["atk"],
            });
            state.combat!.damageAssignments = buildDefaultDamageAssignments(
                state,
                "regular"
            );
            return state;
        }

        it("accepts the server's own pre-filled default", () => {
            const state = twoBlockerState();
            const seeded = state.combat!.damageAssignments!.atk;
            expect(seeded).toEqual({ big: 3, small: 1 });

            const { combat, players } = projectedView(state);
            const plan = damageAssignmentPlan(combat, players, "atk", "p2");
            expect(assignmentIsRejected(plan, seeded)).toBe(false);
            expect(
                damageAssignmentLethalViolation(state, "atk", seeded, ["p2"])
            ).toBeUndefined();
        });

        it("refuses to move damage off a blocker while the player is being hit", () => {
            const state = twoBlockerState();
            const illegal = { big: 2, small: 1, p2: 1 };

            const { combat, players } = projectedView(state);
            const plan = damageAssignmentPlan(combat, players, "atk", "p2");
            expect(assignmentIsRejected(plan, illegal)).toBe(true);
            // …and the server agrees, which is the whole point of sharing the
            // module: the UI gate and the mutation cannot drift apart.
            expect(
                damageAssignmentLethalViolation(state, "atk", illegal, ["p2"])
            ).toEqual({ blockerId: "big", threshold: 3 });
        });

        it("still allows deliberate under-assignment with nothing to the player", () => {
            const state = twoBlockerState();
            const wasteful = { big: 1, small: 0 };

            const { combat, players } = projectedView(state);
            const plan = damageAssignmentPlan(combat, players, "atk", "p2");
            expect(assignmentIsRejected(plan, wasteful)).toBe(false);
            expect(
                damageAssignmentLethalViolation(state, "atk", wasteful, ["p2"])
            ).toBeUndefined();
        });
    });
});
