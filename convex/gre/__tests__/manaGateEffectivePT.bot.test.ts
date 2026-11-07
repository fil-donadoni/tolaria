// CR 613.4 / 602.1b — the Bot's mana-payment planner reads the same effective
// power the tap mutation does, so a spell funded only by a power-gated mana
// ability is enumerated exactly when the server would pay for it. The pump is a
// registry entry on purpose: `planManaPayment` threads no registry argument, so
// only the board `manaGateBattlefields` builds can carry it.

import { describe, expect, it } from "vitest";
import { getCardByName, getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import type { ContinuousEffect } from "../continuousEffects";
import { enumerateMoves, planManaPayment } from "../moves";
import { getLegalActions } from "../rules";
import type { CardInstanceState } from "../state";

const THREE_THREE = getCardByName("Hill Giant").id;
const ONE_GREEN_INSTANT = getCardByName("Giant Growth").id;

/** The source's ONLY mana ability is gated, so the plan stands or falls on the
 *  gate: no free option of the same colour can fund it instead. */
const GATED_SOURCE: CardDefinition = {
    ...getDefinition(getCardByName("Llanowar Elves").id),
    activatedAbilities: [
        {
            id: "gated-mana",
            oracleText:
                "{T}: Add {G}. Activate only if you control a creature with power 4 or greater.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
            canActivate: (source, view) =>
                view.players
                    .find((p) => p.id === source.controllerId)!
                    .battlefield.some((c) => (c.power ?? 0) >= 4),
        },
    ],
};

function pump(instanceId: string, power: number): ContinuousEffect {
    return {
        id: "ce-pump",
        layer: 7,
        sublayer: "7c",
        timestamp: 10,
        expiry: { kind: "indefinite", controllerId: "p1" },
        affected: { kind: "instances", instanceIds: [instanceId] },
        payload: { kind: "pt-modify", power, toughness: 0 },
        characteristicDefining: false,
    } as ContinuousEffect;
}

function planFor(giantOverrides: Partial<CardInstanceState>, power: number) {
    return withTemporaryDefinition(GATED_SOURCE, () => {
        const spell = makeInstance(ONE_GREEN_INSTANT, {
            id: "spell",
            zone: "hand",
        });
        const giant = makeInstance(THREE_THREE, {
            id: "giant",
            ...giantOverrides,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [spell],
                    battlefield: [
                        makeInstance(GATED_SOURCE.id, { id: "source" }),
                        giant,
                    ],
                }),
                makePlayer("p2"),
            ],
            continuousEffects: power === 0 ? [] : [pump(giant.id, power)],
        });
        const player = state.players[0]!;
        return {
            plan: planManaPayment(state, player, { G: 1 }),
            castMoves: enumerateMoves(state, "p1").filter(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === spell.id
            ),
            gateAllowsCast: getLegalActions(state, player, spell).includes(
                "cast"
            ),
        };
    });
}

describe("planner ↔ gate agreement on a power-gated mana ability (CR 613.4)", () => {
    it("a registry pump to power 4: the gate and the planner both fund the cast", () => {
        const { plan, castMoves, gateAllowsCast } = planFor({}, 1);
        expect(plan).toEqual([{ cardInstanceId: "source" }]);
        expect(gateAllowsCast).toBe(true);
        expect(castMoves.length).toBeGreaterThan(0);
    });

    it("+1/+1 counters to power 5: the gate and the planner both fund the cast", () => {
        const { plan, castMoves, gateAllowsCast } = planFor(
            { counters: { "+1/+1": 2 } },
            0
        );
        expect(plan).toEqual([{ cardInstanceId: "source" }]);
        expect(gateAllowsCast).toBe(true);
        expect(castMoves.length).toBeGreaterThan(0);
    });

    it("no creature at power 4: neither funds it", () => {
        const { plan, castMoves, gateAllowsCast } = planFor({}, 0);
        expect(plan).toBeNull();
        expect(gateAllowsCast).toBe(false);
        expect(castMoves).toHaveLength(0);
    });
});
