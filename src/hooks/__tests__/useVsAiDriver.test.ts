// Driver integration (ADR 0001, issue #110): the full client path
// query(bot viewpoint) → gate → consultBrain (Worker; here the inline fallback
// in jsdom enumerates with the real GRE) → executor → existing mutation. Mocks
// only the Convex transport (useQuery/useMutation); everything else is the real
// spine. Proves a vs-AI bot enumerates from its own view and submits a legal
// move on the bot seat.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const calls: { ref: unknown; args: unknown }[] = [];
let currentState: unknown = undefined;

// Tag each mutation/query by a plain string so assertions never touch Convex's
// FunctionReference proxies (which throw on primitive coercion in the matcher).
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            getPublicState: "getPublicState",
            playCard: "playCard",
            announceCast: "announceCast",
            selectTarget: "selectTarget",
            confirmTargets: "confirmTargets",
            tapForPayment: "tapForPayment",
            activateAbility: "activateAbility",
            tapForActivationPayment: "tapForActivationPayment",
            toggleAttacker: "toggleAttacker",
            confirmAttackers: "confirmAttackers",
            selectBlocker: "selectBlocker",
            assignBlockerTarget: "assignBlockerTarget",
            confirmBlockers: "confirmBlockers",
            declareMulligan: "declareMulligan",
            passPriority: "passPriority",
        },
    },
}));

vi.mock("convex/react", () => ({
    useQuery: (_ref: unknown, args: unknown) =>
        args === "skip" ? undefined : currentState,
    useMutation: (ref: unknown) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));

// Imported after the mocks so the hook picks up the mocked transport.
const { useVsAiDriver } = await import("../useVsAiDriver");

const GAME = "game1" as Id<"games">;
const BOT = "u1-p2";
const HUMAN = "u1-p1";

const POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function player(id: string) {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { ...POOL },
    };
}

function botState(overrides: Record<string, unknown> = {}) {
    return {
        seq: 1,
        turn: 1,
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        players: [player(BOT), player(HUMAN)],
        stack: [],
        ...overrides,
    };
}

describe("useVsAiDriver (issue #110)", () => {
    beforeEach(() => {
        calls.length = 0;
        currentState = undefined;
        vi.useFakeTimers();
        // Deterministic random pick (first move).
        vi.spyOn(Math, "random").mockReturnValue(0);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("passes on the bot seat when the bot holds priority with no other move", async () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
        expect(calls[0].args).toEqual({ gameId: GAME, playerId: BOT });
    });

    it("does nothing when the human holds priority", async () => {
        currentState = botState({ priorityPlayerId: HUMAN });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);
    });

    it("declares a mulligan decision during the bot's mulligan window", async () => {
        currentState = botState({
            phase: "MULLIGAN",
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: BOT,
                bottoming: false,
            },
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        await vi.runAllTimersAsync();

        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("declareMulligan");
        expect(calls[0].args).toEqual({
            gameId: GAME,
            playerId: BOT,
            decision: "keep", // Math.random → 0 picks the first move (keep)
        });
    });

    it("does not act when there is no bot seat", async () => {
        currentState = botState();
        renderHook(() => useVsAiDriver(GAME, null));
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);
    });
});
