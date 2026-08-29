// `confirmDamage` must reject an INCOMPLETE combat-damage assignment instead
// of silently applying the shortfall (issue #2906).
//
// `bun run cr 510.1a`:
//   "each attacking and blocking creature ... assigns its combat damage,
//    divided as its controller chooses among the creatures blocking or
//    blocked by it ... An attacking or blocking creature's combat damage
//    assignment is illegal if ... it does not assign a total amount of
//    damage that's greater than or equal to the creature's power."
//
// `bun run cr 510.1e`:
//   "Second, all combat damage that's been assigned is dealt simultaneously."
//   (Read together with 510.1a: the assignment is checked for compliance
//    before it's dealt — an illegal one is refused, not applied partially.)
//
// Before this fix, `setDamageAssignment` only rejected a total ABOVE the
// source's power; `confirmDamage` re-validated nothing at all, so a proposal
// left short of the source's power was confirmed and applied as-is — the
// missing damage simply never happened, with nothing in the event log to say
// why. Same harness discipline as `damageAssignmentLethalMinimum.test.ts`:
// the seam is the registered mutation's own `_handler`, never a
// reimplementation of the confirm loop.

import { describe, it, expect } from "vitest";
import { confirmDamage } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { twoHeadedGiantOfForiys } from "../cards/sets/lea/red";
import { grizzlyBears } from "../cards/sets/lea/green";
import type { GameState, CardInstanceState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;

type Args = { gameId: Id<"games">; playerId: string };

const confirm = (ctx: Parameters<typeof runMutation>[1], playerId = "p1") =>
    runMutation<Args, void>(
        confirmDamage as unknown as Handler<Args, void>,
        ctx,
        { gameId: GAME_ID, playerId }
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

/** p1 (active) in the combat damage step, `atk` blocked by `blockers`, with
 *  `damageAssignments` pre-filled the way the modal seeds it and `atk`'s
 *  assigner recorded as `p1` (a 2+-blocker source always requires manual
 *  confirmation). */
function damageStepState(
    atk: CardInstanceState,
    blockers: CardInstanceState[],
    assignments: Record<string, number>,
    stateOverrides: Partial<GameState> = {}
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [atk], life: 20 }),
            makePlayer("p2", { battlefield: blockers, life: 20 }),
        ],
        combat: {
            attackerIds: [atk.id],
            confirmed: true,
            blockerAssignments: Object.fromEntries(
                blockers.map((b) => [b.id, [atk.id]])
            ),
            // Recorded at declare-blockers confirm time (CR 509.1h) and kept
            // through the damage step even if every blocker later dies — see
            // `recordBlockedAttackers`. Without it a since-emptied blocker
            // set would misread as "never blocked" and hit the defender free.
            blockedAttackerIds: [atk.id],
            blockersConfirmed: true,
            damageConfirmed: false,
            damageAssignments: { [atk.id]: assignments },
            damageAssignerIds: { [atk.id]: "p1" },
            damageAssignmentConfirmedBy: [],
        },
        ...stateOverrides,
    });
}

/** 5-power attacker (Two-Headed Giant of Foriys, buffed to 5/5) blocked by
 *  two 2/2 Grizzly Bears. */
function fivePowerVsTwoBears(
    assignments: Record<string, number>,
    atkOverrides: Partial<CardInstanceState> = {}
): GameState {
    const atk = permanent(twoHeadedGiantOfForiys.id, "atk", "p1", {
        isAttacking: true,
        power: 5,
        toughness: 5,
        staticAbilities: [],
        ...atkOverrides,
    });
    // Toughness bumped well above any split tested here — SBA lethal-damage
    // death is not what these tests are about, and a dead blocker vanishing
    // from the battlefield would make the post-confirm assertions moot.
    const b1 = permanent(grizzlyBears.id, "b1", "p2", {
        isBlocking: true,
        toughness: 10,
    });
    const b2 = permanent(grizzlyBears.id, "b2", "p2", {
        isBlocking: true,
        toughness: 10,
    });
    return damageStepState(atk, [b1, b2], assignments);
}

describe("confirmDamage rejects an incomplete assignment (CR 510.1a/e, issue #2906)", () => {
    it("REJECTS a total below the source's effective power", async () => {
        // 5 power, only 4 assigned (2 + 2) — the missing point would
        // otherwise be silently discarded.
        const h = makeMutationCtx("p1", [
            gameStateSeed(fivePowerVsTwoBears({ b1: 2, b2: 2 })),
        ]);

        await expect(confirm(h.ctx)).rejects.toThrow(
            /atk's combat damage assignment is incomplete: 4 of 5 assigned/
        );
        // No partial write: nothing was confirmed, nothing was dealt.
        const state = h.state();
        expect(state.combat!.damageConfirmed).toBe(false);
        expect(state.combat!.damageAssignmentConfirmedBy).toEqual([]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b1")!
                .damageMarked ?? 0
        ).toBe(0);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b2")!
                .damageMarked ?? 0
        ).toBe(0);
    });

    it("PERMITS a complete assignment and applies the damage", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(fivePowerVsTwoBears({ b1: 2, b2: 3 })),
        ]);

        await confirm(h.ctx);
        const state = h.state();
        expect(state.combat!.damageConfirmed).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b1")!
                .damageMarked
        ).toBe(2);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b2")!
                .damageMarked
        ).toBe(3);
    });

    it("reads EFFECTIVE power for a buffed source — a complete assignment against the buffed total confirms", async () => {
        // Base 4/4 Two-Headed Giant of Foriys, +1/+1 counter making it
        // effectively 5/5. The stored assignment totals 5 (the buffed
        // amount): confirming must succeed, not reject against the raw base
        // power of 4.
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                fivePowerVsTwoBears(
                    { b1: 2, b2: 3 },
                    {
                        power: 4,
                        toughness: 4,
                        counters: { "+1/+1": 1 },
                    }
                )
            ),
        ]);

        await confirm(h.ctx);
        expect(h.state().combat!.damageConfirmed).toBe(true);
    });

    it("REJECTS a shrunk source whose stale map still totals the higher base amount", async () => {
        // Base 5/5, but a -1/-1 counter shrinks it to effectively 4/4. The
        // map still totals 5 (as if nothing changed) — that now OVERSHOOTS
        // the creature's real power and must be rejected, not applied as 5
        // damage from a 4-power creature.
        const h = makeMutationCtx("p1", [
            gameStateSeed(
                fivePowerVsTwoBears(
                    { b1: 2, b2: 3 },
                    { counters: { "-1/-1": 1 } }
                )
            ),
        ]);

        await expect(confirm(h.ctx)).rejects.toThrow(
            /atk's combat damage assignment is incomplete: 5 of 4 assigned/
        );
    });

    it("confirms with NO damage dealt when every blocker left the battlefield mid-window", async () => {
        // Both blockers removed from the battlefield after the assignment
        // was entered (e.g. a removal spell resolved while priority was
        // open) but the stale map is untouched. CR 510.1b/c/d: a source
        // whose legal target set has emptied assigns no combat damage at
        // all — zero is complete, not a rejection.
        const state = fivePowerVsTwoBears({ b1: 2, b2: 3 });
        state.players[1].battlefield = [];

        const h = makeMutationCtx("p1", [gameStateSeed(state)]);
        await confirm(h.ctx);

        const after = h.state();
        expect(after.combat!.damageConfirmed).toBe(true);
        expect(after.players[1].life).toBe(20);
    });

    it("does not count damage assigned to a target that left combat toward the total", async () => {
        // b2 died; the map still lists its share. Only b1's live 2 counts,
        // so the total is short of the 5-power requirement even though the
        // RAW map sums to 5.
        const state = fivePowerVsTwoBears({ b1: 2, b2: 3 });
        state.players[1].battlefield = state.players[1].battlefield.filter(
            (c) => c.id !== "b2"
        );

        const h = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(confirm(h.ctx)).rejects.toThrow(
            /atk's combat damage assignment is incomplete: 2 of 5 assigned/
        );
    });
});
