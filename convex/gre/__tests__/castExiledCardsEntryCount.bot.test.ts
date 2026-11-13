// CR 607.2q / 702.66 (issue #9422) — the search executor stamps its delve
// exiles on the stack item exactly as `commitCast` does, so the Bot's tree
// sees a "for each instant and sorcery card exiled with it" creature
// (Murktide Regent) enter with its counters instead of as a bare body.

import { describe, expect, it } from "vitest";
import { getCardByName, withTemporaryDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { applyMoveForSearch } from "../applyMove";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const regent: CardDefinition = {
    ...getCardByName("Grizzly Bears"),
    id: "test-delve-entry-count-bot",
    name: "Test Delve Entry Count Bot",
    manaCost: { X: 5, U: 2 },
    types: ["Creature"],
    subtypes: ["Dragon"],
    power: 3,
    toughness: 3,
    staticAbilities: ["delve"],
    entersWith: {
        counters: [
            {
                type: "+1/+1",
                count: { cardsExiledWithIt: { types: ["Instant", "Sorcery"] } },
            },
        ],
    },
};

const INSTANT = getCardByName("Disrupt").id;
const LAND = getCardByName("Mountain").id;
const ISLAND = getCardByName("Island").id;

describe("applyMoveForSearch — delve link to the entering permanent (CR 607.2q)", () => {
    it("the delved instants become the permanent's +1/+1 counters", () => {
        withTemporaryDefinition(regent, () => {
            const BOT = "p2";
            const card = makeInstance(regent.id, {
                id: "regent",
                controllerId: BOT,
                ownerId: BOT,
                zone: "hand",
            });
            const graveyard = [
                ...[0, 1, 2].map((i) =>
                    makeInstance(INSTANT, {
                        id: `i${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "graveyard",
                    })
                ),
                ...[0, 1].map((i) =>
                    makeInstance(LAND, {
                        id: `l${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "graveyard",
                    })
                ),
            ];
            // Two Islands pay {U}{U} and nothing of the {5}: all five
            // graveyard cards are the forced delve.
            const bot = makePlayer(BOT, {
                hand: [card],
                graveyard,
                battlefield: [0, 1].map((i) =>
                    makeInstance(ISLAND, { id: `isle${i}`, controllerId: BOT })
                ),
            });
            const state = makeState({
                players: [makePlayer("p1"), bot],
                activePlayerId: BOT,
                priorityPlayerId: BOT,
                phase: "PRECOMBAT_MAIN",
            });
            const move = enumerateMoves(state, BOT).find(
                (m) => m.kind === "cast-spell" && m.cardInstanceId === "regent"
            );
            expect(move).toBeDefined();
            const next = applyMoveForSearch(state, BOT, move!);
            const nextBot = next.players.find((p) => p.id === BOT)!;
            expect(nextBot.exile).toHaveLength(5);
            const live = nextBot.battlefield.find((c) => c.id === "regent");
            expect(live?.counters?.["+1/+1"]).toBe(3);
        });
    });
});
