// Deathtouch (CR 702.2 / CR 704.5h, issue #957).
//
// CR 702.2b — "Any nonzero amount of combat damage assigned to a creature by a
// source with deathtouch is considered to be lethal damage… A creature that has
// been dealt damage by a source with deathtouch since the last time state-based
// actions were checked is destroyed as a state-based action" (CR 704.5h). The
// engine records the marker at every damage sink via `markDeathtouchIfApplicable`
// (reading the source's EFFECTIVE, layer-6-materialized staticAbilities — granted
// deathtouch counts, ability-loss-stripped deathtouch does not) and the lethal
// check consults `hasLethalDamage` (toughness OR deathtouch). Indestructible and
// regeneration still get their say through `destroyWithReplacements`.
import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../state";
import type { CardType } from "../../cards/types";
import { resolveFight } from "../state";
import { applyAllCombatDamage } from "../phases";
import { makePlayer, makeState } from "../../cards/__tests__/setup";

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

/** p1 (active) attacks; `blockerAssignments` maps blocker id -> attacker ids. */
function combatState(
    p1Field: CardInstanceState[],
    p2Field: CardInstanceState[],
    combat: Partial<GameState["combat"]> & { attackerIds: string[] }
): GameState {
    return makeState({
        phase: "COMBAT_DAMAGE",
        activePlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: p1Field }),
            makePlayer("p2", { battlefield: p2Field }),
        ],
        combat: {
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
            damageConfirmed: false,
            ...combat,
        } as GameState["combat"],
    });
}

const alive = (state: GameState, playerIdx: number, id: string): boolean =>
    state.players[playerIdx].battlefield.some((c) => c.id === id);

describe("deathtouch combat destruction (CR 704.5h, AC1/AC2)", () => {
    it("a 1/1 deathtouch blocker destroys the 5/5 it blocks", () => {
        // Attacker 5/5 (p1) blocked by Baleful-Strix-like 1/1 deathtouch (p2).
        // The blocker deals only 1 damage but deathtouch makes it lethal.
        const attacker = creature("atk", 5, 5);
        const strix = creature("strix", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying", "deathtouch"],
        });
        const state = combatState([attacker], [strix], {
            attackerIds: ["atk"],
            blockerAssignments: { strix: ["atk"] },
            blockedAttackerIds: ["atk"],
        });

        applyAllCombatDamage(state, { atk: { strix: 5 } });

        // The 5/5 is destroyed by 1 deathtouch damage...
        expect(alive(state, 0, "atk")).toBe(false);
        // ...and the 1/1 strix dies to the 5 normal damage it took.
        expect(alive(state, 1, "strix")).toBe(false);
    });

    it("a deathtouch attacker with a high-toughness blocker still kills it", () => {
        // Deathtouch 1/1 attacker (p1) vs a 0/20 wall blocker (p2). 1 damage is
        // lethal; the attacker survives (wall has 0 power).
        const strix = creature("strix", 1, 1, {
            staticAbilities: ["deathtouch"],
        });
        const wall = creature("wall", 0, 20, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = combatState([strix], [wall], {
            attackerIds: ["strix"],
            blockerAssignments: { wall: ["strix"] },
            blockedAttackerIds: ["strix"],
        });

        applyAllCombatDamage(state, { strix: { wall: 1 } });

        expect(alive(state, 1, "wall")).toBe(false);
        expect(alive(state, 0, "strix")).toBe(true);
    });

    it("a non-deathtouch 1/1 does NOT destroy the 5/5 it blocks (control)", () => {
        const attacker = creature("atk", 5, 5);
        const chump = creature("chump", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = combatState([attacker], [chump], {
            attackerIds: ["atk"],
            blockerAssignments: { chump: ["atk"] },
            blockedAttackerIds: ["atk"],
        });

        applyAllCombatDamage(state, { atk: { chump: 5 } });

        // 5/5 took 1 non-deathtouch damage → survives.
        expect(alive(state, 0, "atk")).toBe(true);
        expect(alive(state, 1, "chump")).toBe(false);
    });
});

describe("deathtouch vs indestructible / regeneration (CR 704.5h)", () => {
    it("does NOT destroy an indestructible creature (CR 702.12b)", () => {
        const strix = creature("strix", 1, 1, {
            staticAbilities: ["deathtouch"],
        });
        const wall = creature("wall", 0, 20, {
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["indestructible"],
        });
        const state = combatState([strix], [wall], {
            attackerIds: ["strix"],
            blockerAssignments: { wall: ["strix"] },
            blockedAttackerIds: ["strix"],
        });

        applyAllCombatDamage(state, { strix: { wall: 1 } });

        expect(alive(state, 1, "wall")).toBe(true);
    });

    it("a regeneration shield saves the creature and clears the marker", () => {
        const strix = creature("strix", 1, 1, {
            staticAbilities: ["deathtouch"],
        });
        const wall = creature("wall", 0, 20, {
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = combatState([strix], [wall], {
            attackerIds: ["strix"],
            blockerAssignments: { wall: ["strix"] },
            blockedAttackerIds: ["strix"],
        });

        applyAllCombatDamage(state, { strix: { wall: 1 } });

        const saved = state.players[1].battlefield.find((c) => c.id === "wall");
        expect(saved).toBeDefined();
        // The regen replacement healed the damage AND cleared the deathtouch
        // marker, so a subsequent SBA window would not re-destroy it.
        expect(saved!.dealtDeathtouchDamage).toBeUndefined();
        expect(saved!.damageMarked).toBeUndefined();
    });
});

describe("deathtouch non-combat damage (CR 704.5h, AC3)", () => {
    it("a deathtouch source destroys a creature via fight", () => {
        // resolveFight routes through markDamageFromPermanentSource; a 1/1
        // deathtouch fighting a 4/4 kills it with 1 damage.
        const strix = creature("strix", 1, 1, {
            staticAbilities: ["deathtouch"],
        });
        const big = creature("big", 4, 4);
        const state = combatState([strix, big], [], {
            attackerIds: [],
        });

        resolveFight(state, "strix", "big");

        // The 4/4 is destroyed by 1 deathtouch damage; the 1/1 dies to the 4.
        expect(alive(state, 0, "big")).toBe(false);
        expect(alive(state, 0, "strix")).toBe(false);
    });
});

describe("deathtouch respects the effective ability set (CR 613 layer 6, AC5)", () => {
    it("deathtouch GRANTED by a continuous effect is lethal", () => {
        // Printed body has no deathtouch; a layer-6 keyword-grant materialized
        // "deathtouch" onto the instance's staticAbilities array.
        const granted = creature("granted", 1, 1, {
            staticAbilities: ["deathtouch"],
        });
        const wall = creature("wall", 0, 20, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = combatState([granted], [wall], {
            attackerIds: ["granted"],
            blockerAssignments: { wall: ["granted"] },
            blockedAttackerIds: ["granted"],
        });

        applyAllCombatDamage(state, { granted: { wall: 1 } });

        expect(alive(state, 1, "wall")).toBe(false);
    });
});
