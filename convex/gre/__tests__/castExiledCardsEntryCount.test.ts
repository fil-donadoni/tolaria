// CR 607.2q / 702.66 / 614.1c (issue #9422) — cards exiled to pay a spell's
// cost (Delve) are linked to the permanent that spell becomes: "This creature
// enters with a +1/+1 counter on it for each instant and sorcery card exiled
// with it" (Murktide Regent, issue #8626) is the
// `EntersWithCount.cardsExiledWithIt` member.
//
// Layers, one file:
//   - GRE unit: the frontend-safe oracle `resolveEntersWithCounters` and
//     `cardsStillExiled` (CR 607.2a — only cards still in exile count).
//   - game.ts integration: the real cast commit (`tryAutoCommitPendingCast`
//     over a parked delve `pendingCast`) stamps the exiled ids on the stack
//     item, a save/load keeps them, and `resolveTopOfStack` reads them at
//     entry.
//   - Wire format: `projectPublicState` shows the entry counters.

import { describe, expect, it } from "vitest";
import { tryAutoCommitPendingCast } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { resolveEntersWithCounters } from "../../cards/entersWith";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compactState, expandState } from "../serialize";
import { cardsStillExiled, resolveTopOfStack, type GameState } from "../state";

const SPELLS_ONLY = {
    cardsExiledWithIt: { types: ["Instant", "Sorcery"] },
} as const;

/** A delve creature whose only text is the counted entry clause — a
 *  Murktide-shaped variant, registered only for the test's extent. */
const regent: CardDefinition = {
    ...getCardByName("Grizzly Bears"),
    id: "test-delve-entry-count",
    name: "Test Delve Entry Count",
    manaCost: { X: 5, U: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 3,
    toughness: 3,
    staticAbilities: ["delve"],
    entersWith: { counters: [{ type: "+1/+1", count: SPELLS_ONLY }] },
};

const INSTANT = getCardByName("Disrupt").id;
const SORCERY = getCardByName("Treasure Cruise").id;
const LAND = getCardByName("Mountain").id;

function gy(id: string, cardId: string) {
    return makeInstance(cardId, {
        id,
        zone: "graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });
}

/** p1 casts the regent delving `picked` out of a graveyard of two instants,
 *  one sorcery and one land; two blue mana pay the coloured pips. */
function parkedDelveCast(picked: string[]): GameState {
    const card = makeInstance(regent.id, {
        id: "regent",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [card],
                graveyard: [
                    gy("i1", INSTANT),
                    gy("i2", INSTANT),
                    gy("s1", SORCERY),
                    gy("l1", LAND),
                ],
                manaPool: { U: 2, C: 5 - picked.length },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "regent",
        manaCost: { X: 5 - picked.length, U: 2 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 0,
            excludeInstanceId: "regent",
            offsetGeneric: { min: 0, max: 4 },
            pickedCardIds: picked,
        },
    };
    return state;
}

function plusOnes(state: GameState): number {
    const live = state.players[0].battlefield.find((c) => c.id === "regent");
    expect(live).toBeDefined();
    return live!.counters?.["+1/+1"] ?? 0;
}

describe("cardsExiledWithIt entry count — oracle (CR 607.2q)", () => {
    const def = { entersWith: regent.entersWith };

    it("counts only the listed card types among the cards exiled with it", () => {
        expect(
            resolveEntersWithCounters(def, {
                manaSpentToCast: {},
                cardsExiledWithIt: [
                    { types: ["Instant"] },
                    { types: ["Sorcery"] },
                    { types: ["Land"] },
                    { types: ["Artifact", "Creature"] },
                ],
            })
        ).toEqual({ "+1/+1": 2 });
    });

    it("an absent type filter counts every card exiled with it", () => {
        expect(
            resolveEntersWithCounters(
                {
                    entersWith: {
                        counters: [
                            {
                                type: "+1/+1",
                                count: { cardsExiledWithIt: {} },
                            },
                        ],
                    },
                },
                {
                    manaSpentToCast: {},
                    cardsExiledWithIt: [
                        { types: ["Instant"] },
                        { types: ["Land"] },
                    ],
                }
            )
        ).toEqual({ "+1/+1": 2 });
    });

    it("an uncast entry (no cards exiled with it) enters with no counters", () => {
        expect(resolveEntersWithCounters(def, { manaSpentToCast: {} })).toEqual(
            {}
        );
    });

    it("cardsStillExiled drops a card that has left exile (CR 607.2a / 400.7)", () => {
        withTemporaryDefinition(regent, () => {
            const state = parkedDelveCast([]);
            const p1 = state.players[0];
            p1.exile.push({ ...p1.graveyard[0], zone: "exile" });
            expect(cardsStillExiled(state, ["i1", "i2"])).toEqual([
                { types: ["Instant"] },
            ]);
            expect(cardsStillExiled(state, undefined)).toBeUndefined();
        });
    });
});

describe("cardsExiledWithIt entry count — delve cast → entry (CR 702.66 / 607.2q)", () => {
    it("the delve commit stamps the exiled ids and the permanent counts the instants and sorceries", () => {
        withTemporaryDefinition(regent, () => {
            const state = parkedDelveCast(["i1", "i2", "s1", "l1"]);
            expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
            const item = state.stack.find((s) => s.id === "regent")!;
            expect(item.castExiledCardIds?.slice().sort()).toEqual([
                "i1",
                "i2",
                "l1",
                "s1",
            ]);

            // A cast parked on the stack across a save keeps the link.
            const reloaded = expandState(compactState(state));
            expect(
                reloaded.stack.find((s) => s.id === "regent")?.castExiledCardIds
                    ?.length
            ).toBe(4);

            resolveTopOfStack(reloaded);
            expect(plusOnes(reloaded)).toBe(3);
            const live = reloaded.players[0].battlefield.find(
                (c) => c.id === "regent"
            ) as { castExiledCardIds?: string[] };
            expect(live.castExiledCardIds).toBeUndefined();

            const view = projectPublicState(reloaded, 1, "p2");
            const seen = view.players[0].battlefield.find(
                (c) => c.id === "regent"
            );
            expect(seen?.counters?.["+1/+1"]).toBe(3);
        });
    });

    it("a card that left exile before the spell resolved no longer counts", () => {
        withTemporaryDefinition(regent, () => {
            const state = parkedDelveCast(["i1", "s1"]);
            expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
            const p1 = state.players[0];
            const idx = p1.exile.findIndex((c) => c.id === "i1");
            const [gone] = p1.exile.splice(idx, 1);
            p1.hand.push({ ...gone, zone: "hand" });

            resolveTopOfStack(state);
            expect(plusOnes(state)).toBe(1);
        });
    });

    it("cast with no delve: no link, no counters", () => {
        withTemporaryDefinition(regent, () => {
            const state = parkedDelveCast([]);
            delete state.pendingCast!.exileFromGraveyardChoice;
            expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
            expect(
                state.stack.find((s) => s.id === "regent")?.castExiledCardIds
            ).toBeUndefined();
            resolveTopOfStack(state);
            expect(plusOnes(state)).toBe(0);
        });
    });
});
