// Driver integration (ADR 0001, issue #109): the full client path
// brain → consultBrain (Worker, here inline-fallback in jsdom) → executor →
// existing mutation. Mocks only the Convex mutation transport; everything else
// is the real spine. Proves a vs-AI bot submits a real pass on the bot seat.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { BotView } from "~/lib/ai/brain";

const calls: { ref: unknown; args: unknown }[] = [];

// Tag each mutation by a plain string so assertions never touch Convex's
// FunctionReference proxies (which throw on primitive coercion in the matcher).
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            declareMulligan: "declareMulligan",
            confirmAttackers: "confirmAttackers",
            confirmBlockers: "confirmBlockers",
            passPriority: "passPriority",
        },
    },
}));

vi.mock("convex/react", () => ({
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

// Imported after the mock so the hook picks up the mocked useMutation.
const { useVsAiDriver } = await import("../useVsAiDriver");

const GAME = "game1" as Id<"games">;
const BOT = "u1-p2";
const HUMAN = "u1-p1";

function view(overrides: Partial<BotView>): BotView {
    return {
        botId: BOT,
        phase: "PRECOMBAT_MAIN",
        priorityPlayerId: BOT,
        activePlayerId: BOT,
        hasCombat: false,
        attackersConfirmed: false,
        blockersConfirmed: false,
        ...overrides,
    };
}

describe("useVsAiDriver (issue #109)", () => {
    beforeEach(() => {
        calls.length = 0;
        vi.useFakeTimers();
    });

    it("submits passPriority on the bot seat when the bot holds priority", async () => {
        renderHook(() => useVsAiDriver(GAME, view({ priorityPlayerId: BOT })));
        await vi.runAllTimersAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(calls[0].args).toEqual({ gameId: GAME, playerId: BOT });
    });

    it("does nothing when the human holds priority", async () => {
        renderHook(() =>
            useVsAiDriver(GAME, view({ priorityPlayerId: HUMAN }))
        );
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);
    });

    it("keeps the bot's opening hand during its mulligan window", async () => {
        renderHook(() =>
            useVsAiDriver(
                GAME,
                view({ phase: "MULLIGAN", mulliganDeclaringId: BOT })
            )
        );
        await vi.runAllTimersAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("declareMulligan");
        expect(calls[0].args).toEqual({
            gameId: GAME,
            playerId: BOT,
            decision: "keep",
        });
    });

    it("does not act when there is no bot view", async () => {
        renderHook(() => useVsAiDriver(GAME, null));
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);
    });
});
