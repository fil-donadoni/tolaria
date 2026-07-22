// Integration: the vs-AI Bot rehydrates its viewpoint Projection into a search
// world whose Libraries are populated to their wire count (issue #136). Drives
// the real GRE → projectPublicState → projectedToGameState path so a simulated
// draw pulls a placeholder instead of tripping the deck-out SBA (CR 704.5b) and
// scoring a phantom terminal. See `../state-adapter.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import { drawCard } from "@convex/gre/state";
import { checkGameOverSBA } from "@convex/gre/sba";
import { evaluate, WIN_SCORE } from "@convex/gre";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectedToGameState } from "../state-adapter";

const MOUNTAIN = getCardByName("Mountain").id;

function libraryOf(playerId: string, count: number) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(MOUNTAIN, {
            controllerId: playerId,
            ownerId: playerId,
            id: `${playerId}-lib-${i}`,
            zone: "library",
        })
    );
}

/** Rehydrate `state` from `viewerId`'s wire projection — the exact path the
 *  Brain takes before search. */
function rehydrateFor(viewerId: string, state = makeState()) {
    return projectedToGameState(projectPublicState(state, 1, viewerId));
}

describe("AI library rehydration (issue #136)", () => {
    it("populates each library to its wire count after projection", () => {
        const state = makeState({
            turn: 5,
            players: [
                makePlayer("bot", { library: libraryOf("bot", 30) }),
                makePlayer("human", { library: libraryOf("human", 25) }),
            ],
        });
        const world = rehydrateFor("bot", state);
        expect(world.players.find((p) => p.id === "bot")!.library).toHaveLength(
            30
        );
        expect(
            world.players.find((p) => p.id === "human")!.library
        ).toHaveLength(25);
    });

    it("a simulated draw from a non-empty library does not deck the player out", () => {
        const state = makeState({
            turn: 5,
            players: [
                makePlayer("bot", { library: libraryOf("bot", 10) }),
                makePlayer("human", { library: libraryOf("human", 10) }),
            ],
        });
        const world = rehydrateFor("bot", state);
        const bot = world.players.find((p) => p.id === "bot")!;

        const drawn = drawCard(bot);
        expect(drawn).not.toBeNull();
        expect(bot.hasDrawnFromEmpty).toBeFalsy();
        expect(bot.library).toHaveLength(9);
        expect(checkGameOverSBA(world)).toBe(false);
    });

    it("a draw from a genuinely empty library still decks the player out (CR 704.5b)", () => {
        const state = makeState({
            turn: 5,
            players: [
                makePlayer("bot", { library: [] }),
                makePlayer("human", { library: libraryOf("human", 10) }),
            ],
        });
        const world = rehydrateFor("bot", state);
        const bot = world.players.find((p) => p.id === "bot")!;
        expect(bot.library).toHaveLength(0);

        const drawn = drawCard(bot);
        expect(drawn).toBeNull();
        expect(bot.hasDrawnFromEmpty).toBe(true);
        expect(checkGameOverSBA(world)).toBe(true);
        expect(world.gameOver?.loserId).toBe("bot");
    });

    it("forcing the opponent to draw is NOT a phantom terminal win (Braingeyser)", () => {
        const state = makeState({
            turn: 5,
            players: [
                makePlayer("bot", { library: libraryOf("bot", 20) }),
                makePlayer("human", { library: libraryOf("human", 7) }),
            ],
        });
        const world = rehydrateFor("bot", state);
        const human = world.players.find((p) => p.id === "human")!;

        // Braingeyser X=5 at the opponent: five forced draws, library 7 -> 2.
        for (let i = 0; i < 5; i++) expect(drawCard(human)).not.toBeNull();
        expect(human.hasDrawnFromEmpty).toBeFalsy();
        expect(checkGameOverSBA(world)).toBe(false);
        // The bot must value this by material, never as a win.
        expect(evaluate(world, "bot")).toBeLessThan(WIN_SCORE);
    });
});
