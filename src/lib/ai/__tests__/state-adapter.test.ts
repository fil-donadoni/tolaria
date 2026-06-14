// state-adapter (issue #110): the bot's projected wire view rehydrates into a
// GameState the GRE enumerator can read — nulled opponent-hand placeholders and
// hidden library contents are dropped, everything else is preserved.
import { describe, expect, it } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import { projectedToGameState } from "../state-adapter";

const POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function projected(): PublicGameState {
    return {
        seq: 7,
        turn: 3,
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "bot",
        priorityPlayerId: "bot",
        players: [
            {
                id: "bot",
                name: "bot",
                bgColor: "#000",
                life: 20,
                hand: [
                    {
                        id: "h1",
                        card: { id: "x" },
                        legalActions: [],
                    } as never,
                ],
                library: { count: 12 },
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: { ...POOL },
            },
            {
                id: "human",
                name: "human",
                bgColor: "#111",
                life: 20,
                // Opponent hand projected as nulls.
                hand: [null, null, null],
                library: { count: 9 },
                graveyard: [],
                exile: [],
                battlefield: [],
                manaPool: { ...POOL },
            },
        ],
        stack: [],
    } as unknown as PublicGameState;
}

describe("projectedToGameState (issue #110)", () => {
    it("keeps the bot's own hand cards", () => {
        const gs = projectedToGameState(projected());
        const bot = gs.players.find((p) => p.id === "bot")!;
        expect(bot.hand).toHaveLength(1);
        expect(bot.hand[0].id).toBe("h1");
    });

    it("drops nulled opponent-hand placeholders", () => {
        const gs = projectedToGameState(projected());
        const human = gs.players.find((p) => p.id === "human")!;
        expect(human.hand).toHaveLength(0);
    });

    it("reduces hidden libraries to an empty array", () => {
        const gs = projectedToGameState(projected());
        for (const p of gs.players) expect(p.library).toEqual([]);
    });

    it("preserves top-level decision fields", () => {
        const gs = projectedToGameState(projected());
        expect(gs.phase).toBe("PRECOMBAT_MAIN");
        expect(gs.priorityPlayerId).toBe("bot");
        expect(gs.activePlayerId).toBe("bot");
    });
});
