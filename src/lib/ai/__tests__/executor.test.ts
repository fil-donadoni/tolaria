// Bot executor (ADR 0001, issue #109): every BotAction fires the correct
// EXISTING mutation, on the bot seat, with the right args. This is the
// GRE→game.ts contract for the bot — catches wrong-mutation / wrong-seat bugs.
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { executeBotAction, type BotMutations } from "../executor";

const GAME = "game1" as Id<"games">;
const BOT = "u1-p2";

function fakeMutations() {
    return {
        declareMulligan: vi.fn().mockResolvedValue(null),
        confirmAttackers: vi.fn().mockResolvedValue(null),
        confirmBlockers: vi.fn().mockResolvedValue(null),
        passPriority: vi.fn().mockResolvedValue(null),
    } satisfies BotMutations;
}

describe("executeBotAction (issue #109)", () => {
    it("keep → declareMulligan(keep) on the bot seat", async () => {
        const m = fakeMutations();
        const fired = await executeBotAction(
            { kind: "keep" },
            { gameId: GAME, botId: BOT, mutations: m }
        );
        expect(fired).toBe(true);
        expect(m.declareMulligan).toHaveBeenCalledWith({
            gameId: GAME,
            playerId: BOT,
            decision: "keep",
        });
    });

    it("declare-attackers → confirmAttackers on the bot seat", async () => {
        const m = fakeMutations();
        await executeBotAction(
            { kind: "declare-attackers" },
            { gameId: GAME, botId: BOT, mutations: m }
        );
        expect(m.confirmAttackers).toHaveBeenCalledWith({
            gameId: GAME,
            playerId: BOT,
        });
    });

    it("declare-blockers → confirmBlockers on the bot seat", async () => {
        const m = fakeMutations();
        await executeBotAction(
            { kind: "declare-blockers" },
            { gameId: GAME, botId: BOT, mutations: m }
        );
        expect(m.confirmBlockers).toHaveBeenCalledWith({
            gameId: GAME,
            playerId: BOT,
        });
    });

    it("pass → passPriority on the bot seat", async () => {
        const m = fakeMutations();
        await executeBotAction(
            { kind: "pass" },
            { gameId: GAME, botId: BOT, mutations: m }
        );
        expect(m.passPriority).toHaveBeenCalledWith({
            gameId: GAME,
            playerId: BOT,
        });
    });

    it("none → no mutation fired", async () => {
        const m = fakeMutations();
        const fired = await executeBotAction(
            { kind: "none" },
            { gameId: GAME, botId: BOT, mutations: m }
        );
        expect(fired).toBe(false);
        expect(m.declareMulligan).not.toHaveBeenCalled();
        expect(m.confirmAttackers).not.toHaveBeenCalled();
        expect(m.confirmBlockers).not.toHaveBeenCalled();
        expect(m.passPriority).not.toHaveBeenCalled();
    });
});
