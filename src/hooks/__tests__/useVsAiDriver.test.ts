// Driver integration (ADR 0001, issue #110): the full client path
// query(bot viewpoint) → gate → consultBrain (Worker; here the inline fallback
// in jsdom enumerates with the real GRE) → executor → existing mutation. Mocks
// only the Convex transport (useQuery/useMutation); everything else is the real
// spine. Proves a vs-AI bot enumerates from its own view and submits a legal
// move on the bot seat.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import { getCardByName } from "@convex/cards";
import { makeInstance } from "@convex/cards/__tests__/setup";

const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id;

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
            confirmDamage: "confirmDamage",
            declareMulligan: "declareMulligan",
            submitResolutionChoice: "submitResolutionChoice",
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

    it("keeps a reasonable opening hand during the bot's mulligan window", async () => {
        // The keep/mull decision is the cheap gate heuristic (issue #145), not
        // the Worker search: a hand with >=1 land and >=1 spell is kept.
        const botSeat = player(BOT);
        botSeat.hand = [
            makeInstance(MOUNTAIN, {
                id: "m1",
                controllerId: BOT,
                zone: "hand",
            }),
            makeInstance(BEARS, { id: "b1", controllerId: BOT, zone: "hand" }),
        ] as never;
        currentState = botState({
            phase: "MULLIGAN",
            players: [botSeat, player(HUMAN)],
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
            decision: "keep",
        });
    });

    it("mulligans a zero-land opening hand", async () => {
        const botSeat = player(BOT);
        botSeat.hand = Array.from({ length: 7 }, (_, i) =>
            makeInstance(BEARS, {
                id: `b${i}`,
                controllerId: BOT,
                zone: "hand",
            })
        ) as never;
        currentState = botState({
            phase: "MULLIGAN",
            players: [botSeat, player(HUMAN)],
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
            decision: "mull",
        });
    });

    it("does not act when there is no bot seat", async () => {
        currentState = botState();
        renderHook(() => useVsAiDriver(GAME, null));
        await vi.runAllTimersAsync();
        expect(calls).toHaveLength(0);
    });

    // Issue #113: a trivial priority pass skips the Worker + think beat and fires
    // passPriority IMMEDIATELY (no timer), so routine passes never stall.
    it("passes immediately, before any think beat, on a trivial window", () => {
        currentState = botState({ priorityPlayerId: BOT });
        renderHook(() => useVsAiDriver(GAME, BOT));
        // No timer advanced: the pass must already have fired synchronously.
        expect(calls).toHaveLength(1);
        expect(calls[0].ref).toBe("passPriority");
    });

    // Issue #113: a worthwhile window (a play available in the bot's main phase)
    // does NOT short-circuit — it waits for the think beat, then drives a move.
    it("defers to the search on a worthwhile window (no immediate pass)", async () => {
        currentState = botState({
            priorityPlayerId: BOT,
            players: [
                {
                    ...player(BOT),
                    hand: [
                        makeInstance(MOUNTAIN, {
                            controllerId: BOT,
                            ownerId: BOT,
                            id: "land1",
                            zone: "hand",
                        }),
                    ],
                },
                player(HUMAN),
            ],
        });
        renderHook(() => useVsAiDriver(GAME, BOT));
        // Nothing fired synchronously: this window is searched, not insta-passed.
        expect(calls).toHaveLength(0);
        await vi.runAllTimersAsync();
        // After the think beat the bot acts (the search picks a real move).
        expect(calls.length).toBeGreaterThan(0);
    });
});
