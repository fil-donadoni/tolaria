// The CR 702.19b lethal minimum, driven through the REGISTERED
// `setDamageAssignment` mutation (issue #2444; review finding on PR #2483).
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
// Why this file exists on top of `convex/gre/__tests__/lethal-damage-assignment.test.ts`:
// that suite proves the SEED builders and the pure helpers. It never reaches the
// mutation, so deleting the whole `damageAssignmentLethalViolation` guard from
// `setDamageAssignment` (and the rewritten `excessSinkIds` target-legality
// branch beside it) left the suite entirely green — the classic shape-3
// proof-of-failure hole ("the test never reaches the code"). Issue #2444 asks
// explicitly for a full-path GRE -> game.ts integration test, and this is it.
//
// Same harness discipline as `combatDeclarationCap.test.ts`: this project has
// no convex-test harness, so the seam is a stub `MutationCtx` driving the
// registered mutation's own `_handler` (`gameMutationHarness.ts`) — never a
// reimplementation of the mutation body, which would share the bug's premise.

import { describe, it, expect } from "vitest";
import { setDamageAssignment } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { twoHeadedGiantOfForiys, hillGiant } from "../cards/sets/lea/red";
import { grizzlyBears } from "../cards/sets/lea/green";
import { lilianaOfTheVeil } from "../cards/sets/isd/black";
import type { GameState, CardInstanceState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type Args = {
    gameId: Id<"games">;
    playerId: string;
    attackerId: string;
    assignments: Record<string, number>;
};

const assign = (
    ctx: Parameters<typeof runMutation>[1],
    attackerId: string,
    assignments: Record<string, number>,
    playerId = "p1"
) =>
    runMutation<Args, void>(
        setDamageAssignment as unknown as Handler<Args, void>,
        ctx,
        { gameId: GAME_ID, playerId, attackerId, assignments }
    );

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

/** p1 (active) in the combat damage step with `attackers` declared and
 *  `blockerAssignments` in force; damage is open and p1 assigns for `atk`. */
function damageStepState(
    attackers: CardInstanceState[],
    defenderPermanents: CardInstanceState[],
    blockerAssignments: Record<string, string[]>,
    combatOverrides: Partial<NonNullable<GameState["combat"]>> = {}
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
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
            damageAssignments: {},
            damageAssignerIds: Object.fromEntries(
                attackers.map((a) => [a.id, "p1"])
            ),
            ...combatOverrides,
        },
    });
}

/** 4/4 trampler (Two-Headed Giant of Foriys) blocked by a 3/3 Hill Giant. */
function tramplerVsThreeThree(
    attackerOverrides: Partial<CardInstanceState> = {},
    blockerOverrides: Partial<CardInstanceState> = {}
): GameState {
    const atk = permanent(twoHeadedGiantOfForiys.id, "atk", "p1", {
        isAttacking: true,
        ...attackerOverrides,
    });
    const blk = permanent(hillGiant.id, "blk", "p2", {
        isBlocking: true,
        ...blockerOverrides,
    });
    return damageStepState([atk], [blk], { blk: ["atk"] });
}

describe("setDamageAssignment enforces the CR 702.19b lethal minimum (issue #2444)", () => {
    it("REJECTS damage to the defending player while the blocker is under-assigned", async () => {
        // 4/4 trampler, 3/3 blocker with no marked damage: the threshold is 3.
        // Assigning 2 to the blocker and 2 to the player is exactly the pair
        // CR 702.19b forbids.
        const h = makeMutationCtx("p1", [
            gameStateSeed(tramplerVsThreeThree()),
        ]);

        await expect(assign(h.ctx, "atk", { blk: 2, p2: 2 })).rejects.toThrow(
            /blk must be assigned lethal damage \(3\)/
        );
        // No partial write: the rejected proposal never reaches the state.
        expect(h.state().combat!.damageAssignments).toEqual({});
    });

    it("PERMITS deliberate under-assignment when nothing goes to the sink (CR 702.19b's own allowance)", async () => {
        // Same board, same under-assignment — but with no damage to the player,
        // so the pair is not formed. "The attacking creature's controller need
        // not assign lethal damage to all those blocking creatures."
        const h = makeMutationCtx("p1", [
            gameStateSeed(tramplerVsThreeThree()),
        ]);

        await assign(h.ctx, "atk", { blk: 2 });
        expect(h.state().combat!.damageAssignments).toEqual({
            atk: { blk: 2 },
        });
    });

    it("PERMITS lethal to the blocker plus the excess through", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(tramplerVsThreeThree()),
        ]);

        await assign(h.ctx, "atk", { blk: 3, p2: 1 });
        expect(h.state().combat!.damageAssignments).toEqual({
            atk: { blk: 3, p2: 1 },
        });
    });

    it("subtracts damage already marked on the blocker (CR 702.19b)", async () => {
        // The 3/3 already carries 2 damage, so 1 more is lethal and 3 may
        // trample through. A raw-toughness threshold would reject this.
        const h = makeMutationCtx("p1", [
            gameStateSeed(tramplerVsThreeThree({}, { damageMarked: 2 })),
        ]);

        await assign(h.ctx, "atk", { blk: 1, p2: 3 });
        expect(h.state().combat!.damageAssignments).toEqual({
            atk: { blk: 1, p2: 3 },
        });
    });

    it("collapses the threshold to 1 for a deathtouch source (CR 702.2c)", async () => {
        // Deathtouch granted onto the trampler (no catalogue card carries both
        // printed): any nonzero assignment is lethal, so 1/3 is legal.
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                tramplerVsThreeThree({
                    staticAbilities: ["trample", "deathtouch"],
                })
            ),
        ]);

        await assign(h.ctx, "atk", { blk: 1, p2: 3 });
        expect(h.state().combat!.damageAssignments).toEqual({
            atk: { blk: 1, p2: 3 },
        });
    });

    it("takes into account damage another creature assigns in the SAME step (CR 702.19b)", async () => {
        // CR 702.19b's first example: a 2/2 that can block an additional
        // creature blocks a 1/1 and a 3/3 trampler. With the 1/1's point of
        // damage already in this step's map, 1 from the trampler is lethal and
        // 2 may go to the player.
        const small = permanent(grizzlyBears.id, "small", "p1", {
            isAttacking: true,
            power: 1,
            toughness: 1,
        });
        const trampler = permanent(twoHeadedGiantOfForiys.id, "tramp", "p1", {
            isAttacking: true,
            power: 3,
            toughness: 3,
        });
        const wall = permanent(twoHeadedGiantOfForiys.id, "wall", "p2", {
            isBlocking: true,
            power: 2,
            toughness: 2,
            staticAbilities: [],
        });
        const state = damageStepState([small, trampler], [wall], {
            wall: ["small", "tramp"],
        });
        state.combat!.damageAssignments = { small: { wall: 1 } };

        const h = makeMutationCtx("p1", [gameStateSeed(state)]);
        await assign(h.ctx, "tramp", { wall: 1, p2: 2 });
        expect(h.state().combat!.damageAssignments!.tramp).toEqual({
            wall: 1,
            p2: 2,
        });
    });

    it("REJECTS the same split when no other creature has assigned to the blocker yet", async () => {
        // Identical board and identical proposal, minus the 1/1's contribution
        // to this step's map: now 1 is short of the 2/2's threshold of 2, and
        // the pair is illegal. This is what proves the previous test's pass is
        // the same-step subtraction and not a blanket permission.
        const small = permanent(grizzlyBears.id, "small", "p1", {
            isAttacking: true,
            power: 1,
            toughness: 1,
        });
        const trampler = permanent(twoHeadedGiantOfForiys.id, "tramp", "p1", {
            isAttacking: true,
            power: 3,
            toughness: 3,
        });
        const wall = permanent(twoHeadedGiantOfForiys.id, "wall", "p2", {
            isBlocking: true,
            power: 2,
            toughness: 2,
            staticAbilities: [],
        });
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                damageStepState([small, trampler], [wall], {
                    wall: ["small", "tramp"],
                })
            ),
        ]);

        await expect(
            assign(h.ctx, "tramp", { wall: 1, p2: 2 })
        ).rejects.toThrow(/wall must be assigned lethal damage \(2\)/);
    });
});

describe("setDamageAssignment excess-sink legality (CR 702.19f, issue #2444)", () => {
    /** The trampler is attacking a planeswalker, so per CR 702.19f the ONE
     *  object its excess may go to is that planeswalker — not the player. */
    function attackingPlaneswalker(): GameState {
        const atk = permanent(twoHeadedGiantOfForiys.id, "atk", "p1", {
            isAttacking: true,
        });
        const blk = permanent(hillGiant.id, "blk", "p2", { isBlocking: true });
        const pw = permanent(lilianaOfTheVeil.id, "pw", "p2", {
            counters: { loyalty: 3 },
        });
        return damageStepState([atk], [blk, pw], { blk: ["atk"] }, {
            attackTargets: { atk: "pw" },
        } as Partial<NonNullable<GameState["combat"]>>);
    }

    it("accepts excess onto the attacked planeswalker", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(attackingPlaneswalker()),
        ]);

        await assign(h.ctx, "atk", { blk: 3, pw: 1 });
        expect(h.state().combat!.damageAssignments).toEqual({
            atk: { blk: 3, pw: 1 },
        });
    });

    it("REJECTS the defending player as a damage target while a planeswalker is being attacked (CR 702.19f)", async () => {
        // The player is not the sink here and is not a blocker either, so the
        // target-legality loop must refuse it outright.
        const h = makeMutationCtx("p1", [
            gameStateSeed(attackingPlaneswalker()),
        ]);

        await expect(assign(h.ctx, "atk", { blk: 3, p2: 1 })).rejects.toThrow(
            /p2 is not a legal damage target for atk/
        );
    });

    it("applies the lethal minimum to the planeswalker sink too", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(attackingPlaneswalker()),
        ]);

        await expect(assign(h.ctx, "atk", { blk: 2, pw: 2 })).rejects.toThrow(
            /blk must be assigned lethal damage \(3\)/
        );
    });

    it("still refuses sink damage from a creature WITHOUT trample (CR 702.19b applies only to tramplers)", async () => {
        const atk = permanent(hillGiant.id, "atk", "p1", { isAttacking: true });
        const blk = permanent(hillGiant.id, "blk", "p2", { isBlocking: true });
        const h = makeMutationCtx("p1", [
            gameStateSeed(damageStepState([atk], [blk], { blk: ["atk"] })),
        ]);

        await expect(assign(h.ctx, "atk", { blk: 2, p2: 1 })).rejects.toThrow(
            /Only creatures with trample can assign damage to the defending player/
        );
    });
});
