// CR 118.1 + CR 608.2h — the search sandbox pays "Sacrifice this creature" the
// way the mutation path does, snapshot included (issue #4317).
//
// The twin of `sacrificedColorsInSearch.bot.test.ts` for the SELF-sacrifice leg.
// `applyActivationCostsForSearch` removes the source in the search slice, and
// the search's push site resolves the ability with whatever it collects in
// `out.additionalSacrificeSnapshot`; without the snapshot the tree pays the
// creature and resolves "It deals damage equal to its power" for nothing, so
// the line prices as pure loss — the "tree models a different game than the
// server plays" bug (issue #2375).

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardDefinition } from "../../cards/types";
import { applyActivationCostsForSearch } from "../applyMove";
import { getPlayer, type StackItem } from "../state";

const SOURCE_ID = "test-self-sac-search-damager";
const LIVE_POWER = 5;

const definition: CardDefinition = {
    id: SOURCE_ID,
    rarity: "common",
    name: "Test Self-Sacrificing Search Damager",
    types: ["Creature"],
    manaCost: { R: 1 },
    power: 2,
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
registerTokenDefinition(definition);

describe("applyActivationCostsForSearch — the self-sacrifice snapshot (CR 608.2h)", () => {
    it("pays the sacrifice AND hands the live power to the pushed stack item", () => {
        const source = makeInstance(SOURCE_ID, {
            id: "src",
            power: LIVE_POWER,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [source],
                    manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        const out: {
            additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
        } = {};

        const paid = applyActivationCostsForSearch(
            state,
            "p1",
            {
                kind: "activate-ability",
                cardInstanceId: "src",
                abilityId: "damage-by-power",
            } as Parameters<typeof applyActivationCostsForSearch>[2],
            out
        );

        expect(paid).toBe(true);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "src")
        ).toBe(true);
        expect(out.additionalSacrificeSnapshot).toMatchObject({
            cardInstanceId: "src",
            power: LIVE_POWER,
        });
    });
});
