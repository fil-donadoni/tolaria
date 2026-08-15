// Lethal damage for combat-damage assignment (CR 702.19b / CR 702.2c, #2444).
//
// `bun run cr 702.19b`:
//   "The controller of an attacking creature with trample first assigns damage
//    to the creature(s) blocking it. Once all those blocking creatures are
//    assigned lethal damage, any excess damage is assigned as its controller
//    chooses among those blocking creatures and the player, planeswalker, or
//    battle the creature is attacking. When checking for assigned lethal
//    damage, take into account damage already marked on the creature and damage
//    from other creatures that's being assigned during the same combat damage
//    step, but not any abilities or effects that might change the amount of
//    damage that's actually dealt. The attacking creature's controller need not
//    assign lethal damage to all those blocking creatures but in that case
//    can't assign any damage to the player or planeswalker it's attacking."
//
// `bun run cr 702.2c`:
//   "Any nonzero amount of combat damage assigned to a creature by a source
//    with deathtouch is considered to be lethal damage for the purposes of
//    determining if excess damage is being dealt."
//
// Before #2444 all three seed sites in `phases.ts` used raw effective
// toughness, and `setDamageAssignment` enforced no minimum at all.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType, Color } from "../../cards/types";
import { buildAutoDamageAssignments } from "../phases";
import {
    attackTargetExcessSink,
    damageAssignmentLethalViolation,
    lethalThresholdsForSource,
} from "../damageAssignment";
import { lethalDamageThreshold } from "../lethalDamage";
import { isProtectedFromSource } from "../protection";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";

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

function blocker(
    id: string,
    power: number,
    toughness: number,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return creature(id, power, toughness, {
        controllerId: "p2",
        ownerId: "p2",
        isBlocking: true,
        ...overrides,
    });
}

/** One attacker, blockers assigned to it, sitting in the combat damage step. */
function combatState(
    attackers: CardInstanceState[],
    blockers: CardInstanceState[],
    blockerAssignments: Record<string, string[]>,
    combatOverrides: Partial<NonNullable<GameState["combat"]>> = {}
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        players: [
            makePlayer("p1", { battlefield: attackers }),
            makePlayer("p2", { battlefield: blockers }),
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

describe("lethal damage threshold (CR 702.19b / CR 702.2c, issue #2444)", () => {
    it("deathtouch collapses the trample threshold to 1 (CR 702.2c)", () => {
        // A 4/4 with trample AND deathtouch blocked by a 3/3: one point IS
        // lethal damage, so 3 of the 4 trample through. Pre-#2444 the engine
        // put 3 on the blocker and 1 on the player.
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample", "deathtouch"],
            isAttacking: true,
        });
        const blk = blocker("blk", 3, 3);
        const state = combatState([attacker], [blk], { blk: ["atk"] });

        expect(buildAutoDamageAssignments(state, "regular")).toEqual({
            atk: { blk: 1, p2: 3 },
        });
    });

    it("subtracts damage already marked on the blocker (CR 702.19b)", () => {
        // A plain 4/4 trampler into a 3/3 that already carries 2 damage: only
        // 1 more is lethal, so 3 trample through.
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const blk = blocker("blk", 3, 3, { damageMarked: 2 });
        const state = combatState([attacker], [blk], { blk: ["atk"] });

        expect(buildAutoDamageAssignments(state, "regular")).toEqual({
            atk: { blk: 1, p2: 3 },
        });
    });

    it("subtracts damage other creatures assign in the SAME step (CR 702.19b example 1)", () => {
        // CR 702.19b's own first example: "A 2/2 creature that can block an
        // additional creature blocks two attackers: a 1/1 with no abilities and
        // a 3/3 with trample. The active player could assign 1 damage from the
        // first attacker and 1 damage from the second to the blocking creature,
        // and 2 damage to the defending player from the creature with trample."
        const small = creature("small", 1, 1, { isAttacking: true });
        const trampler = creature("tramp", 3, 3, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const wall = blocker("wall", 2, 2);
        // The 2/2 blocks BOTH attackers (Two-Headed Giant of Foriys shape); the
        // seed builder walks `attackerIds` in declaration order, so the 1/1's
        // point of damage is already on the board's books when the trampler's
        // threshold is computed.
        const state = combatState(
            [small, trampler],
            [wall],
            { wall: ["small", "tramp"] },
            {}
        );

        expect(buildAutoDamageAssignments(state, "regular")).toEqual({
            small: { wall: 1 },
            tramp: { wall: 1, p2: 2 },
        });
    });

    it("does NOT subtract protection — CR 702.19b example 2 (pro-green 2/2)", () => {
        // "A 6/6 green creature with trample is blocked by a 2/2 creature with
        // protection from green. The attacking creature's controller must
        // assign at least 2 damage to the blocker, even though that damage will
        // be prevented by the blocker's protection ability."
        const attacker = creature("atk", 6, 6, {
            staticAbilities: ["trample"],
            // CR 613.1d layer-5 colour set — makes the attacker genuinely
            // green, so the blocker's protection is live below.
            colorOverride: ["G"] as Color[],
            isAttacking: true,
        });
        const blk = blocker("blk", 2, 2, {
            staticAbilities: ["protection from green"],
        });
        const state = combatState([attacker], [blk], { blk: ["atk"] });

        // The protection is genuinely live — this is not a test of an inert
        // keyword. It is simply irrelevant to the ASSIGNMENT budget.
        expect(isProtectedFromSource(blk, attacker, false)).toBe(true);
        expect(buildAutoDamageAssignments(state, "regular")).toEqual({
            atk: { blk: 2, p2: 4 },
        });
    });

    it("floors at 0 and never goes negative for an over-damaged blocker", () => {
        expect(
            lethalDamageThreshold({
                effectiveToughness: 2,
                damageMarked: 5,
                sourceHasDeathtouch: false,
            })
        ).toBe(0);
    });

    it("another source's deathtouch damage already satisfies the threshold (CR 702.2c)", () => {
        expect(
            lethalDamageThreshold({
                effectiveToughness: 7,
                sourceHasDeathtouch: false,
                other: { amount: 1, fromDeathtouch: true },
            })
        ).toBe(0);
    });
});

describe("setDamageAssignment lethal minimum (CR 702.19b, issue #2444)", () => {
    /** 4/4 trampler blocked by a 3/3 and a 1/1 — a manual (2+ blocker) split. */
    function twoBlockerState(): GameState {
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const big = blocker("big", 1, 3);
        const small = blocker("small", 1, 1);
        return combatState([attacker], [big, small], {
            big: ["atk"],
            small: ["atk"],
        });
    }

    it("rejects damage to the defending player while a blocker is under-assigned", () => {
        const state = twoBlockerState();
        const violation = damageAssignmentLethalViolation(
            state,
            "atk",
            { big: 2, small: 1, p2: 1 },
            ["p2"]
        );
        expect(violation).toEqual({ blockerId: "big", threshold: 3 });
    });

    it("permits deliberate under-assignment when nothing goes to the player", () => {
        // CR 702.19b: "The attacking creature's controller need not assign
        // lethal damage to all those blocking creatures but in that case can't
        // assign any damage to the player or planeswalker it's attacking."
        const state = twoBlockerState();
        expect(
            damageAssignmentLethalViolation(
                state,
                "atk",
                { big: 1, small: 0 },
                ["p2"]
            )
        ).toBeUndefined();
    });

    it("permits the player's share once every blocker is at its threshold", () => {
        const state = twoBlockerState();
        expect(
            damageAssignmentLethalViolation(
                state,
                "atk",
                { big: 3, small: 1 },
                ["p2"]
            )
        ).toBeUndefined();
    });

    it("counts the same step's other assignments when validating (CR 702.19b)", () => {
        // A second attacker has already been assigned 2 onto the 3-toughness
        // blocker this step, so 1 from this attacker is now lethal for it.
        const state = twoBlockerState();
        state.combat!.damageAssignments = { other: { big: 2 } };
        expect(
            damageAssignmentLethalViolation(
                state,
                "atk",
                { big: 1, small: 1, p2: 2 },
                ["p2"]
            )
        ).toBeUndefined();
    });
});

describe("trample excess sink (CR 702.19f, issue #2444)", () => {
    it("is the attacked planeswalker, not the defending player", () => {
        // CR 702.19f — "If a creature without trample over planeswalkers is
        // attacking a planeswalker, none of its combat damage can be assigned
        // to the defending player."
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const blk = blocker("blk", 1, 1);
        const pw = creature("pw", 0, 0, {
            types: ["Planeswalker"] as CardType[],
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty: 4 },
        });
        const state = combatState(
            [attacker],
            [blk, pw],
            { blk: ["atk"] },
            { attackTargets: { atk: "pw" } }
        );

        expect(attackTargetExcessSink(state, "atk", "p2")).toBe("pw");
        expect(buildAutoDamageAssignments(state, "regular")).toEqual({
            atk: { blk: 1, pw: 3 },
        });
    });
});

describe("wire format: thresholds survive projection (issue #2444)", () => {
    it("the projected blocker still yields the same lethal threshold", () => {
        // `projectPublicState` slims `card` to `{ id }` and reshapes zones. The
        // threshold reads `damageMarked`, `staticAbilities` and effective
        // toughness off the blocker — all three must cross the wire, or the
        // assigner UI computes a different budget from the server and offers
        // clicks the mutation refuses.
        const attacker = creature("atk", 4, 4, {
            staticAbilities: ["trample"],
            isAttacking: true,
        });
        const blk = blocker("blk", 3, 3, { damageMarked: 2 });
        const state = combatState([attacker], [blk], { blk: ["atk"] });

        expect(lethalThresholdsForSource(state, "atk", {})).toEqual({ blk: 1 });

        const projected = projectPublicState(state, 1, "p1");
        const projectedBlocker = projected.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "blk")!;
        expect(projectedBlocker.damageMarked).toBe(2);
        expect(
            lethalDamageThreshold({
                effectiveToughness: projectedBlocker.toughness!,
                damageMarked: projectedBlocker.damageMarked,
                sourceHasDeathtouch: false,
            })
        ).toBe(1);
        expect(projected.combat?.damageAssignments).toEqual(
            state.combat?.damageAssignments
        );
    });
});
