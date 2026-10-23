// `cost.addCounter` on the Bot path (CR 122.1 / 118.1 / 118.3): the enumerator
// offers the activation with no affordability gate (the leg is always
// payable), and the search-side cost application places the counter through
// the same `addCounterToCard` mutator the mutation uses.
import { describe, expect, it } from "vitest";
import { preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { applyActivationCostsForSearch } from "../applyMove";
import { enumerateMoves, type Move } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const BOT = "p2";
const PAYER_ID = "00000000-0000-4000-8000-000064920011";

preloadDefinitions([
    {
        id: PAYER_ID,
        name: "Synthetic Search Counter Payer",
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        power: 0,
        toughness: 1,
        activatedAbilities: [
            {
                id: "search-counter-gain",
                oracleText:
                    "Put a -1/-1 counter on this creature: You gain 3 life.",
                cost: { addCounter: { type: "-1/-1", count: 1 } },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
]);

function board() {
    const src = makeInstance(PAYER_ID, {
        id: "src",
        controllerId: BOT,
        ownerId: BOT,
        zone: "battlefield",
        isSummoningSick: false,
    });
    return makeState({
        players: [makePlayer("p1"), makePlayer(BOT, { battlefield: [src] })],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
    });
}

describe("cost.addCounter — Bot reachability and search payment", () => {
    it("is enumerated even when the counter will kill the source, and the search pays it", () => {
        const state = board();
        const move = enumerateMoves(state, BOT).find(
            (m): m is Extract<Move, { kind: "activate-ability" }> =>
                m.kind === "activate-ability" && m.cardInstanceId === "src"
        );
        expect(move).toBeDefined();

        expect(applyActivationCostsForSearch(state, BOT, move!)).toBe(true);
        const src = state.players
            .find((p) => p.id === BOT)!
            .battlefield.find((c) => c.id === "src")!;
        expect(src.counters).toEqual({ "-1/-1": 1 });
    });
});
