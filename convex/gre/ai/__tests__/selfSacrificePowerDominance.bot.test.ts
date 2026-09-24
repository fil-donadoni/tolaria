// CR 118.1 + CR 608.2h — the dominance probe pays "Sacrifice this creature" the
// way the real payment does, snapshot included (issue #4317).
//
// `applyProbeActivation` is a FOURTH payment site beside the three mutation
// paths and the search sandbox. Without the snapshot the probe resolved "It
// deals damage equal to its power" as a CR 608.2b skip, saw no change but the
// forgiven cost, judged the activation a dominated no-op and pruned it from
// every search — so the Bot would never play a card of this shape.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import type { CardDefinition } from "../../../cards/types";
import { enumerateMoves, type Move } from "../../moves";
import { isDominatedNoOpMove } from "../dominance";

function sacrificer(
    id: string,
    amount: number | { sacrificed: { read: "power" } }
) {
    const definition: CardDefinition = {
        id,
        rarity: "common",
        name: `Test Probe Sacrificer ${id}`,
        types: ["Creature"],
        manaCost: { R: 1 },
        power: 2,
        toughness: 2,
        activatedAbilities: [
            {
                id: "damage",
                oracleText:
                    "{R}, Sacrifice this creature: It deals damage to target creature.",
                cost: { mana: { R: 1 }, sacrifice: true },
                useStack: true,
                effects: [{ op: "dealDamage", amount, to: { target: 0 } }],
                targetRequirement: { type: "Creature", count: 1 },
            },
        ],
    };
    registerTokenDefinition(definition);
    return definition;
}

function activation(id: string) {
    const source = makeInstance(id, { id: "src", power: 5 });
    const foe = makeInstance(id, {
        id: "foe",
        controllerId: "p2",
        ownerId: "p2",
        toughness: 1,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [source],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [foe] }),
        ],
    });
    const move = enumerateMoves(state, "p1").find(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "src" &&
            m.targets.some((t) => t.id === "foe")
    );
    return { state, move };
}

describe("dominance probe — the self-sacrifice snapshot (CR 608.2h)", () => {
    it("does NOT prune 'It deals damage equal to its power' — the damage kills the target", () => {
        const { state, move } = activation(
            sacrificer("test-probe-power", { sacrificed: { read: "power" } }).id
        );
        expect(move).toBeDefined();
        expect(isDominatedNoOpMove(state, "p1", move!)).toBe(false);
    });

    it("control: a fixed-damage twin was never pruned", () => {
        const { state, move } = activation(
            sacrificer("test-probe-fixed", 2).id
        );
        expect(move).toBeDefined();
        expect(isDominatedNoOpMove(state, "p1", move!)).toBe(false);
    });
});
