// CR 118.1 + CR 608.2h + CR 208.1 — an ability whose COST is "Sacrifice this
// creature" reads the sacrificed source's last known power at resolution
// (Cinder Shade, Flame Elemental: "It deals damage equal to its power to target
// creature", issue #4317 / #1417).
//
// The source is in the graveyard before the ability resolves, and a fixed
// self-sacrifice (`cost.sacrifice`) has no `SacrificeSelection`, so nothing
// stamped `StackItem.additionalSacrificeSnapshot` for it: the `sacrificed`
// value resolved `undefined` and the effect was a silent CR 608.2b skip. Three
// payment sites pay the leg — the immediate commit and the deferred commit
// (`gre/activation.ts`) and the targeted commit (`finalizeTargetSelection`,
// `game.ts`) — each of which is driven here through its REAL entry point.
//
// The instance's own `power` (5) differs from the printed one (2) on purpose:
// the snapshot must be the LIVE, layer-applied value, not the definition's.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardDefinition, TargetSelection } from "../../cards/types";
import { finalizeTargetSelection } from "../../game";
import {
    activateAbilityOnState,
    tryAutoCommitPendingActivation,
} from "../activation";
import { sacrificeSourceSnapshot } from "../sacrificeChoice";
import { getPlayer, resolveTopOfStack, type GameState } from "../state";

const PRINTED_POWER = 2;
const LIVE_POWER = 5;

const DAMAGE_ID = "test-self-sac-damage-power";
const LIFE_FREE_ID = "test-self-sac-life-free";
const LIFE_MANA_ID = "test-self-sac-life-mana";

/** The shape `/grammar-rule` compiles Flame Elemental to (the golden fixture). */
const damageSource: CardDefinition = {
    id: DAMAGE_ID,
    rarity: "common",
    name: "Test Self-Sacrificing Damager",
    types: ["Creature"],
    subtypes: ["Elemental"],
    manaCost: { R: 1 },
    power: PRINTED_POWER,
    toughness: 2,
    activatedAbilities: [
        {
            id: "damage-by-power",
            oracleText:
                "{R}, Sacrifice this creature: It deals damage equal to its power to target creature.",
            cost: { mana: { R: 1 }, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "dealDamage",
                    amount: { sacrificed: { read: "power" } },
                    to: { target: 0 },
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        },
    ],
};

/** An untargeted twin, so the immediate and deferred commits are reachable. */
function lifeSource(
    id: string,
    cost: { R?: number; tap?: true }
): CardDefinition {
    return {
        id,
        rarity: "common",
        name: `Test Self-Sacrificing Gainer ${id}`,
        types: ["Creature"],
        manaCost: { R: 1 },
        power: PRINTED_POWER,
        toughness: 2,
        activatedAbilities: [
            {
                id: "gain-by-power",
                oracleText: "Sacrifice this creature: You gain life.",
                cost: {
                    ...(cost.R ? { mana: { R: cost.R } } : {}),
                    ...(cost.tap ? { tap: true } : {}),
                    sacrifice: true,
                },
                useStack: true,
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { sacrificed: { read: "power" } },
                    },
                ],
            },
        ],
    };
}

registerTokenDefinition(damageSource);
registerTokenDefinition(lifeSource(LIFE_FREE_ID, {}));
registerTokenDefinition(lifeSource(LIFE_MANA_ID, { R: 1, tap: true }));

function board(sourceId: string, floatingR = 1, foeToughness = 10): GameState {
    const source = makeInstance(sourceId, {
        id: "src",
        power: LIVE_POWER,
    });
    const foe = makeInstance(sourceId, {
        id: "foe",
        controllerId: "p2",
        ownerId: "p2",
        toughness: foeToughness,
    });
    return makeState({
        players: [
            // The mana leg is paid from a floating {R}: the payment site under
            // test is the SACRIFICE leg, not land tapping.
            makePlayer("p1", {
                battlefield: [source],
                manaPool: { W: 0, U: 0, B: 0, R: floatingR, G: 0, C: 0 },
            }),
            makePlayer("p2", { battlefield: [foe] }),
        ],
    });
}

describe("sacrificeSourceSnapshot (CR 608.2h)", () => {
    it("reads the layer-applied power, not the printed one", () => {
        const state = board(DAMAGE_ID);
        const src = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "src"
        )!;
        const snapshot = sacrificeSourceSnapshot(state, src);
        expect(snapshot).toMatchObject({
            cardInstanceId: "src",
            power: LIVE_POWER,
            toughness: 2,
            mv: 1,
        });
        // Taking the snapshot must not move the source: the caller pays the leg.
        expect(getPlayer(state, "p1").battlefield.includes(src)).toBe(true);
    });
});

describe("self-sacrifice cost snapshot, through the real activation entry points", () => {
    it("immediate commit: a mana-free sacrifice stamps the snapshot", () => {
        const state = board(LIFE_FREE_ID);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "gain-by-power",
        });
        expect(state.stack[0]?.additionalSacrificeSnapshot?.power).toBe(
            LIVE_POWER
        );
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(20 + LIVE_POWER);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
    });

    it("deferred commit: a mana + tap + sacrifice cost parks, then stamps the snapshot", () => {
        // No floating mana: the announcement parks in `pendingActivation` until
        // the cost is covered, and the sacrifice leg is paid at THAT commit.
        const state = board(LIFE_MANA_ID, 0);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "gain-by-power",
        });
        expect(state.pendingActivation).toBeDefined();
        expect(state.stack).toHaveLength(0);
        getPlayer(state, "p1").manaPool.R = 1;
        tryAutoCommitPendingActivation(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0]?.additionalSacrificeSnapshot?.power).toBe(
            LIVE_POWER
        );
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(20 + LIVE_POWER);
    });

    it("targeted commit: 'It deals damage equal to its power to target creature'", () => {
        const state = board(DAMAGE_ID);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "damage-by-power",
        });
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: "foe" }] as TargetSelection[];
        finalizeTargetSelection(state, pt, "p1");
        expect(state.stack[0]?.additionalSacrificeSnapshot?.power).toBe(
            LIVE_POWER
        );
        resolveTopOfStack(state);
        const foe = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "foe"
        )!;
        expect(foe.damageMarked).toBe(LIVE_POWER);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
    });
});
