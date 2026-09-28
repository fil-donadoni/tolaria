// CR 509.1g — "target creature blocking or blocked by {self}" (Cromat, issue
// #4320). The `combatPartnerOfSource` directive binds the source's id into the
// registered `combatPartnerOf` filter (`applySourceDirectives`, `gre/rules.ts`);
// this file pins the three places that bound requirement is read:
//
//   - announcement: `activateAbilityOnState` offers only the source's combat
//     partners, and `applyOneTargetSelection` (the accepted set) agrees;
//   - resolution: the CR 608.2b re-check rebuilds the SAME bound requirement,
//     so a partner that left combat is an illegal target, while a SOURCE that
//     left the battlefield still partners by last-known information.
//
// The Bot's enumerator is pinned in `combatPartnerTarget.bot.test.ts`; the
// client highlight in `src/lib/__tests__/combat-partner-target.fullpath.test.ts`.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup";
import type { GameState } from "../state";
import {
    getPlayer,
    regenerateOrDestroy,
    removePermanentFromCombat,
    resolveTopOfStack,
} from "../state";
import { activateAbilityOnState, applyOneTargetSelection } from "../../game";

const CROMAT = "7d9e0a23-d2a8-40a6-9076-ed6fb539141b"; // Cromat, APC 94
const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears
const DESTROY = "cromat-destroy-combat-partner";

/** p1's Cromat in combat with p2's `partner`; p2's `bystander` is on the
 *  battlefield but out of combat. `role` is Cromat's side of the pair. */
function board(role: "attacking" | "blocking"): GameState {
    const cromat = makeInstance(CROMAT, {
        id: "cromat",
        controllerId: "p1",
        ownerId: "p1",
        ...(role === "attacking"
            ? { isAttacking: true }
            : { isBlocking: true }),
    });
    const partner = makeInstance(BEARS, {
        id: "partner",
        controllerId: "p2",
        ownerId: "p2",
        ...(role === "attacking"
            ? { isBlocking: true }
            : { isAttacking: true }),
    });
    const bystander = makeInstance(BEARS, {
        id: "bystander",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: role === "attacking" ? "p1" : "p2",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: [role === "attacking" ? "cromat" : "partner"],
            confirmed: true,
            blockerAssignments:
                role === "attacking"
                    ? { partner: ["cromat"] }
                    : { cromat: ["partner"] },
            blockersConfirmed: true,
            damageConfirmed: false,
        },
        players: [
            makePlayer("p1", {
                battlefield: [cromat],
                manaPool: { W: 1, U: 0, B: 1, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [partner, bystander] }),
        ],
    });
}

const onBattlefield = (state: GameState, id: string) =>
    state.players.some((p) => p.battlefield.some((c) => c.id === id));

describe("Cromat — target creature blocking or blocked by {self} (CR 509.1g, issue #4320)", () => {
    for (const role of ["attacking", "blocking"] as const) {
        it(`announcement: Cromat ${role} — the partner is accepted, the bystander refused`, () => {
            const state = board(role);
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "cromat",
                abilityId: DESTROY,
            });
            expect(state.pendingTarget?.combatPartnerOf).toBe("cromat");
            expect(() =>
                applyOneTargetSelection(state, "p1", {
                    targetType: "permanent",
                    targetId: "bystander",
                })
            ).toThrow(/blocking or blocked by/);
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "partner",
            });
            expect(state.stack.at(-1)?.targets).toEqual([
                { type: "permanent", id: "partner" },
            ]);
            resolveTopOfStack(state);
            expect(onBattlefield(state, "partner")).toBe(false);
            expect(onBattlefield(state, "bystander")).toBe(true);
        });
    }

    it("announcement: with Cromat out of combat there is no legal target, so no activation (CR 601.2c via 602.2b)", () => {
        const state = board("attacking");
        state.combat = undefined;
        getPlayer(state, "p1").battlefield[0].isAttacking = undefined;
        getPlayer(state, "p2").battlefield[0].isBlocking = undefined;
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "cromat",
                abilityId: DESTROY,
            })
        ).toThrow();
        expect(state.stack).toHaveLength(0);
    });

    it("resolution: a partner removed from combat is no longer a legal target (CR 506.4 / 608.2b)", () => {
        const state = board("attacking");
        const cromat = getPlayer(state, "p1").battlefield[0];
        removePermanentFromCombat(state, "partner");
        resolveActivated(state, cromat, DESTROY, [
            { type: "permanent", id: "partner" },
        ]);
        expect(onBattlefield(state, "partner")).toBe(true);
    });

    it("resolution: an attacker that regenerated left combat, so it no longer partners the Cromat that blocked it (CR 701.19a / 506.4)", () => {
        const state = board("blocking");
        const cromat = getPlayer(state, "p1").battlefield[0];
        const partner = getPlayer(state, "p2").battlefield[0];
        partner.regenerationShields = 1;
        // The regeneration rider taps it and removes it from combat — while
        // Cromat's own block assignment still names it.
        regenerateOrDestroy(state, "partner");
        expect(onBattlefield(state, "partner")).toBe(true);
        expect(state.combat?.blockerAssignments.cromat).toContain("partner");
        resolveActivated(state, cromat, DESTROY, [
            { type: "permanent", id: "partner" },
        ]);
        expect(onBattlefield(state, "partner")).toBe(true);
    });

    it("resolution: Cromat gone from the battlefield still partners by last-known information (CR 608.2b)", () => {
        const state = board("attacking");
        const cromat = getPlayer(state, "p1").battlefield[0];
        // The ability is on the stack; Cromat then leaves (its own {G}{U}).
        state.stack.push({
            ...cromat,
            zone: "stack",
            castById: "p1",
            abilityId: DESTROY,
            targets: [{ type: "permanent", id: "partner" }],
        });
        getPlayer(state, "p1").battlefield = [];
        getPlayer(state, "p1").library.unshift({ ...cromat, zone: "library" });
        resolveTopOfStack(state);
        expect(onBattlefield(state, "partner")).toBe(false);
    });
});
