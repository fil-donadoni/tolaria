// CR 614.1 — "damage that would reduce your life total to less than N reduces
// it to N instead" (Worship), declared as `CardDefinition.damageLifeFloor` and
// expanded into a "damage" replacement. Driven through the real
// `runDamageReplacement` funnel.

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
import { runDamageReplacement } from "../state";

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

function hit(opts: {
    life: number;
    amount: number;
    creature?: boolean;
    target?: string;
    sourceStatic?: string[];
    def?: CardDefinition;
}): number {
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
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        life: opts.life,
                        battlefield:
                            opts.creature === false
                                ? [worship]
                                : [worship, bear],
                    }),
                    makePlayer("p2", { life: opts.life }),
                ],
            });
            const out = runDamageReplacement(
                state,
                "bolt",
                "p2",
                { type: "player", id: opts.target ?? "p1" },
                opts.amount,
                false,
                false
            );
            return out?.amount ?? 0;
        })
    );
}

describe("damage life floor (CR 614.1)", () => {
    it("expands into one 'other'-kind damage replacement and drops the field", () => {
        const expanded = expandDefinition(WORSHIP);
        expect(expanded.damageLifeFloor).toBeUndefined();
        expect(
            expanded.replacementEffects!.map((r) => [r.id, r.damageEffectKind])
        ).toEqual([["test-worship-damage-life-floor", "other"]]);
    });

    it("clamps lethal damage so the life total lands on the floor", () => {
        expect(hit({ life: 3, amount: 10 })).toBe(2);
    });

    it("clamps exactly-lethal damage", () => {
        expect(hit({ life: 3, amount: 3 })).toBe(2);
    });

    it("leaves damage that stays at or above the floor alone", () => {
        expect(hit({ life: 3, amount: 2 })).toBe(2);
        expect(hit({ life: 20, amount: 5 })).toBe(5);
    });

    it("deals nothing when the life total is already at the floor", () => {
        expect(hit({ life: 1, amount: 4 })).toBe(0);
    });

    it("does not apply without a creature the controller controls", () => {
        expect(hit({ life: 3, amount: 10, creature: false })).toBe(10);
    });

    it("does not protect the opponent", () => {
        expect(hit({ life: 3, amount: 10, target: "p2" })).toBe(10);
    });

    it("an unconditional floor ignores the board", () => {
        const def: CardDefinition = {
            ...WORSHIP,
            id: "test-damage-life-floor-uncond",
            damageLifeFloor: { floor: 1 },
        };
        expect(hit({ life: 3, amount: 10, creature: false, def })).toBe(2);
    });
});
