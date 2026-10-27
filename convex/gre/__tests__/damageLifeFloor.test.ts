// CR 120.4c / 614.1 — "damage that would reduce your life total to less than N
// reduces it to N instead" (Worship), declared as `CardDefinition.damageLifeFloor`
// and expanded into a replacement on the RESULT of damage (life loss), seen
// after prevention (CR 120.4b). Driven through a real damage sink.

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { dealDamageFromPermanentToPlayer } from "../state";
import type { GameState } from "../state";

const WORSHIP: CardDefinition = {
    id: "test-damage-life-floor-worship",
    name: "Test Worship",
    rarity: "rare",
    types: ["Enchantment"],
    oracleText:
        "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.",
    damageLifeFloor: { floor: 1, whileControlling: "Creature" },
};

const CREATURE: CardDefinition = {
    id: "test-damage-life-floor-bear",
    name: "Test Bear",
    rarity: "common",
    types: ["Creature"],
    power: 2,
    toughness: 2,
};

function run(opts: {
    life: number;
    amount: number;
    creature?: boolean;
    target?: string;
    halfDownShield?: boolean;
    def?: CardDefinition;
}): { state: GameState; lifeOfTarget: number } {
    const def = opts.def ?? WORSHIP;
    return withTemporaryDefinition(def, () =>
        withTemporaryDefinition(CREATURE, () => {
            const worship = makeInstance(def.id, {
                id: "worship",
                controllerId: "p1",
            });
            const bear = makeInstance(CREATURE.id, {
                id: "bear",
                controllerId: "p1",
            });
            const source = makeInstance(CREATURE.id, {
                id: "attacker",
                controllerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        life: opts.life,
                        battlefield:
                            opts.creature === false
                                ? [worship]
                                : [worship, bear],
                    }),
                    makePlayer("p2", {
                        life: opts.life,
                        battlefield: [source],
                    }),
                ],
            });
            const target = opts.target ?? "p1";
            if (opts.halfDownShield)
                state.playerDamagePrevention = [
                    {
                        playerId: target,
                        match: {},
                        mode: "half-down",
                        remaining: 1,
                        duration: { phase: "end-of-turn" },
                    },
                ];
            dealDamageFromPermanentToPlayer(
                state,
                source,
                "p2",
                target,
                opts.amount
            );
            return {
                state,
                lifeOfTarget: state.players.find((p) => p.id === target)!.life,
            };
        })
    );
}

describe("damage life floor (CR 120.4c, 614.1)", () => {
    it("expands into one damage-lifeloss replacement and drops the field", () => {
        const expanded = expandDefinition(WORSHIP);
        expect(expanded.damageLifeFloor).toBeUndefined();
        expect(
            expanded.replacementEffects!.map((r) => [r.id, r.eventKind])
        ).toEqual([["test-worship-damage-life-floor", "damage-lifeloss"]]);
    });

    it("lands lethal damage on the floor", () => {
        expect(run({ life: 3, amount: 10 }).lifeOfTarget).toBe(1);
        expect(run({ life: 3, amount: 3 }).lifeOfTarget).toBe(1);
    });

    it("leaves damage that stays at or above the floor alone", () => {
        expect(run({ life: 3, amount: 2 }).lifeOfTarget).toBe(1);
        expect(run({ life: 20, amount: 5 }).lifeOfTarget).toBe(15);
    });

    it("loses nothing when already at the floor, but the damage is still dealt", () => {
        const { state, lifeOfTarget } = run({ life: 1, amount: 4 });
        expect(lifeOfTarget).toBe(1);
        const dealt = (state.pendingEvents ?? []).filter(
            (e) => e.type === "DAMAGE_DEALT"
        );
        expect(dealt).toHaveLength(1);
        expect(dealt[0]).toMatchObject({ amount: 4 });
        expect(
            (state.pendingEvents ?? []).some((e) => e.type === "LIFE_LOST")
        ).toBe(false);
    });

    it("emits LIFE_LOST for the life actually lost, not the damage", () => {
        const { state } = run({ life: 3, amount: 10 });
        expect(
            (state.pendingEvents ?? []).filter((e) => e.type === "LIFE_LOST")
        ).toEqual([expect.objectContaining({ amount: 2, fromDamage: true })]);
    });

    it("sees the damage AFTER prevention (CR 120.4b before 120.4c)", () => {
        // 10 damage, half prevented -> 5 dealt; 3 life - 5 -> floored to 1.
        // (Clamping the damage first would deal 2, halve it to 1, leave 2.)
        expect(
            run({ life: 3, amount: 10, halfDownShield: true }).lifeOfTarget
        ).toBe(1);
    });

    it("does not apply without a creature the controller controls", () => {
        expect(run({ life: 3, amount: 10, creature: false }).lifeOfTarget).toBe(
            -7
        );
    });

    it("does not protect the opponent", () => {
        expect(run({ life: 3, amount: 10, target: "p2" }).lifeOfTarget).toBe(
            -7
        );
    });

    it("an unconditional floor ignores the board", () => {
        const def: CardDefinition = {
            ...WORSHIP,
            id: "test-damage-life-floor-uncond",
            damageLifeFloor: { floor: 1 },
        };
        expect(
            run({ life: 3, amount: 10, creature: false, def }).lifeOfTarget
        ).toBe(1);
    });
});
