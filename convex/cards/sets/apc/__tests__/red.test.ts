// Per-card behaviour tests for APC red cards (`convex/cards/sets/apc/red.ts`).
//
// Bloodfire Infusion is hand-tail (issue #4319). Its two card-level claims no
// Op test makes:
//
//   * the cost names the ENCHANTED creature, never a chosen one — with a second
//     creature on the board the victim must still be the Aura's host
//     (CR 303.4b), and an Aura whose host is gone has no legal payment;
//   * the damage is the victim's power as last known information (CR 608.2h),
//     dealt to EVERY creature, the activator's own included.
//
// Driven through the real activation entry point and the real resolution, by
// registry id — never by name.
import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { activateAbilityOnState } from "../../../../game";
import { resolveTopOfStack } from "../../../../gre/state";
import { checkStateBasedActions } from "../../../../gre/sba";
import type { CardInstanceState, GameState } from "../../../../gre/state";

const ABILITY_ID = "bloodfire-infusion-sweep";
const BLOODFIRE_INFUSION_ID = "2639e9b7-ed8c-48fd-a8b7-b99d8dad4bc0";
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function creature(
    id: string,
    controllerId: string,
    power: number,
    toughness: number
): CardInstanceState {
    return makeInstance(GRIZZLY_BEARS_ID, {
        id,
        controllerId,
        ownerId: controllerId,
        power,
        toughness,
    });
}

/** p1 controls the Aura on `host` (3/3) plus a bystander 2/5; p2 has a 2/2. */
function board(opts: { attachedTo?: string } = {}): GameState {
    const aura = makeInstance(BLOODFIRE_INFUSION_ID, {
        id: "aura",
        controllerId: "p1",
        ownerId: "p1",
        attachedTo: "attachedTo" in opts ? opts.attachedTo : "host",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    aura,
                    creature("host", "p1", 3, 3),
                    creature("bystander", "p1", 2, 5),
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [creature("foe", "p2", 2, 2)] }),
        ],
    });
}

function activate(state: GameState): void {
    activateAbilityOnState(state, {
        playerId: "p1",
        cardInstanceId: "aura",
        abilityId: ABILITY_ID,
    });
}

function onBattlefield(state: GameState, id: string) {
    return state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);
}

describe("Bloodfire Infusion (APC, issue #4319)", () => {
    it("is the registry definition the tests below drive", () => {
        expect(getDefinition(BLOODFIRE_INFUSION_ID).name).toBe(
            "Bloodfire Infusion"
        );
    });

    it("sacrifices the enchanted creature as the cost, never a chosen one (CR 303.4b)", () => {
        const state = board();
        activate(state);

        // The bystander was a legal `Creature` but not the host: nothing to pick.
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(onBattlefield(state, "host")).toBeUndefined();
        expect(onBattlefield(state, "bystander")).toBeDefined();
    });

    it("deals the sacrificed creature's power to each creature (CR 608.2h)", () => {
        const state = board();
        activate(state);
        // CR 704.5m — the Aura is binned before the ability resolves, so the
        // damage comes from a source that has already left the battlefield.
        checkStateBasedActions(state);
        expect(onBattlefield(state, "aura")).toBeUndefined();
        resolveTopOfStack(state);

        // 3 damage: kills the 2/2 foe, marks the 2/5 bystander (survives).
        expect(onBattlefield(state, "foe")).toBeUndefined();
        expect(onBattlefield(state, "bystander")?.damageMarked).toBe(3);
    });

    it("has no legal payment once the Aura is not attached to a creature", () => {
        const state = board({ attachedTo: undefined });
        expect(() => activate(state)).toThrow(/sacrifice cost/i);
        expect(onBattlefield(state, "host")).toBeDefined();
    });
});
