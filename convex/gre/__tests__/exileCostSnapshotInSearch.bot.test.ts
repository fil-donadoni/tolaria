// CR 118.1 / 608.2h (issue #2232) — the search sandboxes and exile-as-a-COST.
//
// Two halves, both bot-side: (a) `cost.exileThis` on a battlefield source must
// send the permanent to EXILE in the leaf, not to the graveyard — a line that
// banked the Cane as a graveyard resource evaluates a position live play never
// reaches; (b) the ISMCTS leaf must reconstruct the additional-cost EXILE
// snapshot, not just pay the cost.
//
// `applyActivationCostsForSearch` (`applyMove.ts`) already moves the cards a
// `cost.exileFromGraveyard` activation exiles. What it did NOT do is record
// WHICH card, and an ability whose effect reads the exiled card back —
// Necropolis, "Put X +0/+1 counters on this creature, where X is the exiled
// card's mana value" — resolves for X = 0 in a tree that never captured it.
// A zero-value activation scores exactly equal to `pass`, which is the same
// failure shape as the cost-free activations of issue #2155: the bot simply
// never plays the card.
//
// The mutation path takes this snapshot in `exileCostSnapshot` (`game.ts`) and
// rides it to the stack item as `additionalSacrificeSnapshot` (already the
// additional-cost victim field for BOTH departures, sacrifice and exile). This
// test pins that the search sandbox pushes an item carrying the SAME value, so
// the tree resolves the ability the way live play will.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveInSearch } from "../search";
import { applyActivationCostsForSearch } from "../applyMove";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "../state";

const BOT = "p2";

const NECROPOLIS = getCardByName("Necropolis").id;
const FELDONS_CANE = getCardByName("Feldon's Cane").id;
// Grizzly Bears — {1}{G}, mana value 2. The number under test.
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;

function board(): GameState {
    const necro = makeInstance(NECROPOLIS, {
        id: "necro",
        controllerId: BOT,
        ownerId: BOT,
    });
    const corpse = makeInstance(GRIZZLY_BEARS, {
        id: "corpse",
        controllerId: BOT,
        ownerId: BOT,
        zone: "graveyard",
    });
    return makeState({
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [
            makePlayer("p1"),
            makePlayer(BOT, { battlefield: [necro], graveyard: [corpse] }),
        ],
    });
}

function necropolisMove(state: GameState): Move {
    const move = enumerateMoves(state, BOT).find(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "necro" &&
            m.abilityId === "necropolis-counters"
    );
    expect(
        move,
        "the enumerator offers Necropolis' exile-cost activation"
    ).toBeDefined();
    return move!;
}

describe("exile-cost snapshot in the ISMCTS leaf (CR 118.1 / 608.2h)", () => {
    it("pushes the ability with the exiled card's mana value, so it resolves for X = 2", () => {
        const state = board();
        applyMoveInSearch(state, BOT, necropolisMove(state));

        // The cost was paid in the leaf…
        const bot = state.players[1];
        expect(bot.graveyard).toHaveLength(0);
        expect(bot.exile.some((c) => c.id === "corpse")).toBe(true);

        // …and the ability resolved (the leaf drains auto-passes) with X read
        // off the reconstructed snapshot, not defaulted to 0.
        while (state.stack.length > 0) resolveTopOfStack(state);
        const necro = state.players[1].battlefield.find(
            (c) => c.id === "necro"
        )!;
        expect(necro.counters?.["+0/+1"]).toBe(2);
    });
});

describe("cost.exileThis in the search fast-forward (CR 118.1 / 601.2h)", () => {
    it("removes the source to EXILE, never to the graveyard", () => {
        const cane = makeInstance(FELDONS_CANE, {
            id: "cane",
            controllerId: BOT,
            ownerId: BOT,
        });
        const state = makeState({
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [
                makePlayer("p1"),
                makePlayer(BOT, { battlefield: [cane] }),
            ],
        });

        expect(
            applyActivationCostsForSearch(state, BOT, {
                kind: "activate-ability",
                cardInstanceId: "cane",
                abilityId: "feldons-cane-shuffle",
                targets: [],
                confirmTargets: false,
                tapPlan: [],
            })
        ).toBe(true);

        const bot = state.players[1];
        expect(bot.exile.some((c) => c.id === "cane")).toBe(true);
        expect(bot.graveyard.some((c) => c.id === "cane")).toBe(false);
        expect(bot.battlefield.some((c) => c.id === "cane")).toBe(false);
    });
});
