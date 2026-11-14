// loadScenarioIntoGame — the refusal for a Game with no saved state: a missing
// Game and a pregame Game (coin-toss gate, CR 103.1) read differently.
import { describe, it, expect } from "vitest";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { ScenarioSpec } from "../../debugScenarioSpec";

import { loadScenarioIntoGame } from "../scenarioLoad";

const spec = { cards: [] } as unknown as ScenarioSpec;
const gameId = "g1" as Id<"games">;

function ctxWith(row: unknown): MutationCtx {
    // `getLatestGameState` reads `gameStates` through this query chain and
    // finds nothing; `get` answers the `games` row lookup.
    const query = {
        withIndex: () => query,
        order: () => query,
        first: async () => null,
    };
    return {
        db: { get: async () => row, query: () => query },
    } as unknown as MutationCtx;
}

describe("loadScenarioIntoGame — no saved state", () => {
    it("says the Game has no state yet when its row exists (pregame gate)", async () => {
        await expect(
            loadScenarioIntoGame(ctxWith({ _id: gameId }), gameId, spec)
        ).rejects.toThrow(/no state yet/);
    });

    it("keeps 'Game not found' for a Game id with no row", async () => {
        await expect(
            loadScenarioIntoGame(ctxWith(null), gameId, spec)
        ).rejects.toThrow("Game not found");
    });
});
