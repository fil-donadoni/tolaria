// Per-player Match Clock (issue #2308): the pure arithmetic
// (`convex/matchClock.ts`), then the REAL path through the registered
// handlers — `chooseFirstPlayer` builds Game 1, a seat-addressed mutation
// persists a position through `saveGameState`, and the board's own clock read
// (`getGameTick`) shows the charged remainders; the expiry job ends the Match;
// a clocked Bo3 carries its remainders across the sideboarding window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getCardByName } from "../cards";
import {
    chooseFirstPlayer,
    concede,
    createSoloGame,
    declareMulligan,
    expireMatchClock,
    expireSideboardWindow,
} from "../game";
import { getGameTick } from "../gameReads";
import { getLatestGameState } from "../gameStateStore";
import {
    advanceClock,
    clockBudgetMs,
    clockExpiresAt,
    expiredPlayerId,
    initialTickClock,
    liveRemainingMs,
    SIDEBOARD_WINDOW_MS,
    type TickClock,
} from "../matchClock";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "./gameMutationHarness.fixture";

const BUDGET = 25 * 60_000;
const T0 = 1_800_000_000_000;

describe("matchClock arithmetic (issue #2308)", () => {
    const fresh = (): TickClock =>
        initialTickClock({ budgetMs: BUDGET }, ["a", "b"]);

    it("a new Game starts every seat from the carried remainder, else the budget", () => {
        expect(
            initialTickClock(
                {
                    budgetMs: BUDGET,
                    remaining: [{ playerId: "a", remainingMs: 1_000 }],
                },
                ["a", "b"]
            ).players
        ).toEqual([
            { playerId: "a", remainingMs: 1_000 },
            { playerId: "b", remainingMs: BUDGET },
        ]);
    });

    it("charges the elapsed time to the player who was running, then starts the awaited one", () => {
        const running = advanceClock(fresh(), "a", T0, false);
        expect(running.runningPlayerId).toBe("a");
        const next = advanceClock(running, "b", T0 + 7_000, false);
        expect(next.players).toEqual([
            { playerId: "a", remainingMs: BUDGET - 7_000 },
            { playerId: "b", remainingMs: BUDGET },
        ]);
        expect(next.runningPlayerId).toBe("b");
        expect(next.runningSince).toBe(T0 + 7_000);
    });

    it("a game over stops every clock; an unknown awaited id runs none", () => {
        const running = advanceClock(fresh(), "a", T0, false);
        expect(
            advanceClock(running, "b", T0 + 1, true).runningPlayerId
        ).toBeUndefined();
        expect(
            advanceClock(running, "nobody", T0 + 1, false).runningPlayerId
        ).toBeUndefined();
    });

    it("only the running clock moves, and it runs out exactly at its instant", () => {
        const running = advanceClock(fresh(), "a", T0, false);
        expect(liveRemainingMs(running, "b", T0 + 60_000)).toBe(BUDGET);
        expect(clockExpiresAt(running)).toBe(T0 + BUDGET);
        expect(expiredPlayerId(running, T0 + BUDGET - 1)).toBeNull();
        expect(expiredPlayerId(running, T0 + BUDGET)).toBe("a");
        expect(liveRemainingMs(running, "a", T0 + BUDGET + 5)).toBe(0);
    });

    it("refuses a budget outside the bounds or not a whole number of minutes", () => {
        expect(clockBudgetMs(15)).toBe(15 * 60_000);
        expect(() => clockBudgetMs(0)).toThrow();
        expect(() => clockBudgetMs(121)).toThrow();
        expect(() => clockBudgetMs(2.5)).toThrow();
    });
});

// ── The real path ───────────────────────────────────────────────────────────

const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id;
const DECK = [
    ...Array.from({ length: 12 }, () => ({
        cardId: MOUNTAIN,
        cardName: "Mountain",
    })),
    ...Array.from({ length: 8 }, () => ({
        cardId: BEARS,
        cardName: "Grizzly Bears",
    })),
];

function seat(id: string, name: string) {
    return {
        id,
        name,
        bgColor: "#000000",
        deck: { id: `deck-${id}`, name: "Deck", format: "freeform" },
        score: 0,
        ready: false,
    };
}

/** Alice (`u1`) and Bob (`u2`) at a Constructed Bo3's coin toss — exactly
 *  what `createGame` + `joinGame` leave behind — with or without a clock. */
function pregame(clocked: boolean): MutationStub {
    const players = [seat("u1", "Alice"), seat("u2", "Bob")];
    return makeMutationCtx("u1", [
        { _id: "u1", __table: "users", nickname: "Alice" },
        { _id: "u2", __table: "users", nickname: "Bob" },
        {
            _id: "match-1",
            __table: "matches",
            bestOf: 3,
            status: "pregame",
            players,
            currentGameNumber: 1,
            currentGameId: "game-1",
            playDrawChooserId: "u1",
            ...(clocked ? { clock: { budgetMs: BUDGET } } : {}),
            createdAt: 0,
            updatedAt: 0,
        },
        ...["u1", "u2"].map((playerId, i) => ({
            _id: `match-deck-${i}`,
            __table: "matchDecks",
            matchId: "match-1",
            playerId,
            maindeck: DECK,
            sideboard: [],
        })),
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
            matchId: "match-1",
            gameNumber: 1,
            status: "pregame",
            players: players.map(({ id, name, bgColor, deck }) => ({
                id,
                name,
                bgColor,
                deck,
            })),
            createdAt: 0,
            updatedAt: 0,
        },
    ]);
}

type Job = {
    id: string;
    at: number;
    /** The scheduled function's name, e.g. `game:expireMatchClock`. */
    fn: string;
    args: Row;
    cancelled: boolean;
};

const EXPIRE_CLOCK = "game:expireMatchClock";
const EXPIRE_WINDOW = "game:expireSideboardWindow";

/** A recording scheduler on the stub's ctx: the clock's expiry and the
 *  sideboarding window are both armed through it. */
function recordJobs(stub: MutationStub): Job[] {
    const jobs: Job[] = [];
    (stub.ctx as unknown as { scheduler: unknown }).scheduler = {
        runAfter: async (
            delay: number,
            ref: FunctionReference<"mutation", "internal">,
            args: Row
        ) => {
            const id = `job-${jobs.length + 1}`;
            jobs.push({
                id,
                at: Date.now() + delay,
                fn: getFunctionName(ref),
                args,
                cancelled: false,
            });
            return id;
        },
        cancel: async (id: string) => {
            const job = jobs.find((j) => j.id === id);
            if (job) job.cancelled = true;
        },
    };
    return jobs;
}

/** The board's own clock read. */
async function boardClock(
    stub: MutationStub,
    gameId = "game-1"
): Promise<TickClock | undefined> {
    const tick = await (
        getGameTick as unknown as {
            _handler: (ctx: MutationCtx, a: Row) => Promise<Row | null>;
        }
    )._handler(stub.ctx, { gameId });
    return tick?.clock as TickClock | undefined;
}

const remainingOf = (clock: TickClock, playerId: string) =>
    clock.players.find((p) => p.playerId === playerId)!.remainingMs;
const otherOf = (playerId: string) => (playerId === "u1" ? "u2" : "u1");
const liveJobs = (jobs: Job[]) => jobs.filter((j) => !j.cancelled);

async function startGameOne(stub: MutationStub) {
    await runMutation(chooseFirstPlayer, stub.asUser("u1"), {
        matchId: "match-1" as Id<"matches">,
        choice: "play",
    });
}

/** The awaited player answers the mulligan prompt — a seat-addressed
 *  mutation persisting through `saveGameState` like any other action. */
async function keep(stub: MutationStub, playerId: string) {
    await runMutation(declareMulligan, stub.asUser(playerId), {
        gameId: "game-1" as Id<"games">,
        playerId,
        decision: "keep",
    });
}

describe("Match Clock through the real handlers (issue #2308)", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T0);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("charges the awaited player at each save and keeps exactly one expiry job armed", async () => {
        const stub = pregame(true);
        const jobs = recordJobs(stub);
        await startGameOne(stub);

        const first = await boardClock(stub);
        expect(first).toBeDefined();
        const runner = first!.runningPlayerId!;
        expect(["u1", "u2"]).toContain(runner);
        expect(remainingOf(first!, "u1")).toBe(BUDGET);
        expect(remainingOf(first!, "u2")).toBe(BUDGET);
        expect(liveJobs(jobs)).toHaveLength(1);
        expect(liveJobs(jobs)[0]).toMatchObject({
            at: T0 + BUDGET,
            fn: EXPIRE_CLOCK,
            args: { gameId: "game-1", playerId: runner },
        });

        vi.setSystemTime(T0 + 10_000);
        await keep(stub, runner);

        const after = await boardClock(stub);
        expect(remainingOf(after!, runner)).toBe(BUDGET - 10_000);
        expect(remainingOf(after!, otherOf(runner))).toBe(BUDGET);
        expect(after!.runningPlayerId).toBe(otherOf(runner));
        // The runner's job was cancelled; the new runner's is the only one.
        expect(liveJobs(jobs)).toHaveLength(1);
        expect(liveJobs(jobs)[0]).toMatchObject({
            at: T0 + 10_000 + BUDGET,
            args: { playerId: otherOf(runner) },
        });
    });

    it("a clock running out ends the Match against that player — an action past zero cannot escape it", async () => {
        const stub = pregame(true);
        const jobs = recordJobs(stub);
        await startGameOne(stub);
        const runner = (await boardClock(stub))!.runningPlayerId!;

        // The flag falls; the runner's answer lands before the job fires.
        vi.setSystemTime(T0 + BUDGET + 50);
        await keep(stub, runner);
        const frozen = await boardClock(stub);
        expect(frozen!.runningPlayerId).toBe(runner);
        const armed = liveJobs(jobs);
        expect(armed).toHaveLength(1);
        expect(armed[0].args.playerId).toBe(runner);

        // A stale job naming the other player does nothing.
        await runMutation(expireMatchClock, stub.ctx, {
            gameId: "game-1",
            playerId: otherOf(runner),
        });
        expect(stub.doc("match-1").status).not.toBe("finished");

        await runMutation(expireMatchClock, stub.ctx, armed[0].args);
        const match = stub.doc("match-1");
        expect(match.status).toBe("finished");
        expect(match.winner).toBe(otherOf(runner));
        expect(stub.doc("game-1").status).toBe("finished");
        const final = await getLatestGameState(
            stub.ctx,
            "game-1" as Id<"games">
        );
        expect(final!.state.gameOver).toMatchObject({
            loserId: runner,
            timedOut: true,
        });
        expect((await boardClock(stub))!.runningPlayerId).toBeUndefined();
    });

    it("a clocked Bo3 hands its remainders to Game 2 through the sideboarding window", async () => {
        const stub = pregame(true);
        const jobs = recordJobs(stub);
        await startGameOne(stub);
        const runner = (await boardClock(stub))!.runningPlayerId!;
        vi.setSystemTime(T0 + 10_000);
        await keep(stub, runner);
        vi.setSystemTime(T0 + 25_000);
        await runMutation(concede, stub.asUser("u1"), {
            gameId: "game-1" as Id<"games">,
            playerId: "u1",
        });

        const between = stub.doc("match-1");
        expect(between.status).toBe("sideboarding");
        const carried = (
            between.clock as {
                remaining: { playerId: string; remainingMs: number }[];
            }
        ).remaining;
        const left = (id: string) =>
            carried.find((r) => r.playerId === id)!.remainingMs;
        expect(left(runner)).toBe(BUDGET - 10_000);
        expect(left(otherOf(runner))).toBe(BUDGET - 15_000);
        expect(between.sideboardDeadlineAt).toBe(
            T0 + 25_000 + SIDEBOARD_WINDOW_MS
        );
        const windowJob = liveJobs(jobs).find((j) => j.fn === EXPIRE_WINDOW);
        expect(windowJob).toMatchObject({
            at: T0 + 25_000 + SIDEBOARD_WINDOW_MS,
            args: { matchId: "match-1", gameNumber: 1 },
        });
        // No clock runs between Games.
        expect(liveJobs(jobs).filter((j) => j.fn === EXPIRE_CLOCK)).toEqual([]);

        vi.setSystemTime(T0 + 25_000 + SIDEBOARD_WINDOW_MS);
        await runMutation(expireSideboardWindow, stub.ctx, windowJob!.args);
        const next = stub.doc("match-1");
        expect(next.status).toBe("playing");
        expect(next.currentGameNumber).toBe(2);
        expect(next.sideboardDeadlineAt).toBeUndefined();
        const g2 = await boardClock(stub, next.currentGameId as string);
        expect(remainingOf(g2!, runner)).toBe(BUDGET - 10_000);
        expect(remainingOf(g2!, otherOf(runner))).toBe(BUDGET - 15_000);

        // The window job is spent: a second run is a no-op.
        await runMutation(expireSideboardWindow, stub.ctx, windowJob!.args);
        expect(stub.doc("match-1").currentGameNumber).toBe(2);
    });

    it("an unclocked Match carries no clock and arms nothing", async () => {
        const stub = pregame(false);
        const jobs = recordJobs(stub);
        await startGameOne(stub);
        await keep(stub, "u1");
        expect(await boardClock(stub)).toBeUndefined();
        expect(jobs).toEqual([]);
    });

    it("a plain solo game refuses a clock (one user races no one)", async () => {
        const stub = pregame(false);
        await expect(
            runMutation(createSoloGame, stub.ctx, {
                name: "Solo",
                deck: { id: "d", name: "D", format: "freeform", cards: DECK },
                clockMinutes: 15,
            })
        ).rejects.toThrow(/only available against the Bot or another player/);
    });
});
