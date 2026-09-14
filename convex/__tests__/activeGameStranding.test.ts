// The lobby's active-game banner, at the seam it actually reads (issue #3336).
//
// The stranding: a Match left `playing` with `currentGameId` pointing at a
// FINISHED Game. `myActiveGame` surfaced it as an active game, the banner
// derived its buttons from `status === "playing"` alone and so offered
// `leaveGame`, which accepts only `waiting`/`pregame` and threw — while
// `lobbyActionGate`'s `hasActiveGame` kept every other lobby action disabled.
// One account, no in-app way out; on the shared dev deployment it also reds
// every lobby-gated surface of `bun run check:ui`.
//
// Two halves, both asserted here through the REAL query handler rather than a
// hand-built view: the orphan PRODUCER is closed (a drawn Game now settles its
// Match, CR 104.4a), and for the orphan's legitimate twin — a Bo3 between
// Games — the projection carries what the banner needs to offer an action the
// server accepts, with `leaveGame`'s own refusal naming the real status.
//
// The project has no convex-test harness (see `adminAuth.test.ts`), so this
// drives the registered handlers against the in-memory ctx, exactly like
// `limitedPairingMatch.test.ts`.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { GameState } from "../gre/state";
import { finalizeGameOver, leaveGame, myActiveGame } from "../game";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";

const USER = "user1";
const SEAT_A = `${USER}-p1`;
const SEAT_B = `${USER}-p2`;

type Handler<A, R> = { _handler: (ctx: never, args: A) => Promise<R> };

const runMyActiveGame = (ctx: QueryCtx) =>
    (
        myActiveGame as unknown as Handler<Record<string, never>, unknown>
    )._handler(ctx as never, {});

const runLeaveGame = (ctx: MutationCtx, gameId: string) =>
    (leaveGame as unknown as Handler<{ gameId: Id<"games"> }, null>)._handler(
        ctx as never,
        { gameId: gameId as Id<"games"> }
    );

function seat(id: string) {
    return {
        id,
        name: id,
        bgColor: "#000",
        deck: { id: "d", name: "Deck", format: "vintage" },
        score: 0,
        ready: false,
    };
}

/** A solo Match + its current Game, both seeded at the statuses the scenario
 *  needs. Solo because that is the mode the stuck dev account was in and the
 *  one `check:ui` walks. */
function world(
    matchStatus: string,
    gameStatus: string,
    overrides: {
        bestOf?: 1 | 3;
        currentGameNumber?: number;
    } = {}
) {
    const match: InMemoryRow = {
        _id: "match1",
        bestOf: overrides.bestOf ?? 1,
        status: matchStatus,
        players: [seat(SEAT_A), seat(SEAT_B)],
        currentGameNumber: overrides.currentGameNumber ?? 1,
        currentGameId: "game1",
        createdAt: 0,
        updatedAt: 0,
    };
    const game: InMemoryRow = {
        _id: "game1",
        name: "Solo game",
        status: gameStatus,
        matchId: "match1",
        solo: true,
        vsAi: false,
        players: [seat(SEAT_A), seat(SEAT_B)],
        createdAt: 0,
        updatedAt: 0,
    };
    return makeInMemoryDb(
        {
            users: [{ _id: USER, name: "Tester", email: "t@example.com" }],
            matches: [match],
            games: [game],
        },
        { identitySubject: `${USER}|session1` }
    );
}

/** A drawn game over, exactly as the engine writes it: CR 104.4a leaves
 *  `winnerId`/`loserId` empty (`SpellContext.drawGame`, `checkGameOverSBA`'s
 *  simultaneous-loss branch). */
const DRAWN = {
    gameOver: { winnerId: "", loserId: "", reason: "draw", isDraw: true },
} as unknown as GameState;

describe("a drawn Game settles its Match (CR 104.4a, issue #3336)", () => {
    it("finishes the Bo1 Match instead of leaving it pointing at a finished Game", async () => {
        const db = world("playing", "playing");

        await finalizeGameOver(db.ctx, "game1" as Id<"games">, 1, DRAWN);

        expect(db.tables.games[0].status).toBe("finished");
        // The orphan, in one assertion: before the fix this stayed "playing".
        expect(db.tables.matches[0].status).toBe("finished");
        expect(db.tables.matches[0].winner).toBeUndefined();
    });

    it("frees the lobby — `myActiveGame` reports nothing to resume or leave", async () => {
        const db = world("playing", "playing");

        await finalizeGameOver(db.ctx, "game1" as Id<"games">, 1, DRAWN);

        // Through the projection the lobby actually subscribes to: a finished
        // Match is not an ACTIVE_MATCH_STATUS, so `hasActiveGame` is false and
        // every primary action is enabled again.
        expect(await runMyActiveGame(db.ctx)).toBeNull();
    });

    it("a drawn Game 1 of a Bo3 routes to sideboarding, not to a stranded `playing`", async () => {
        const db = world("playing", "playing", {
            bestOf: 3,
            currentGameNumber: 1,
        });

        await finalizeGameOver(db.ctx, "game1" as Id<"games">, 1, DRAWN);

        expect(db.tables.matches[0].status).toBe("sideboarding");
        expect(
            (db.tables.matches[0].players as { score: number }[]).every(
                (p) => p.score === 0
            )
        ).toBe(true);
    });
});

describe("a drawn Limited pairing lands in the standings (issue #3336 review)", () => {
    it("records the drawn Match as a played 0-0 pairing", async () => {
        // Settling the Match on a draw makes `recordLimitedPairingResult`
        // REACHABLE for a winner-less game over — before this fix
        // `finalizeGameOver` returned before it, so a drawn pairing was
        // silently never recorded and its round could never complete.
        const db = makeInMemoryDb(
            {
                users: [{ _id: USER, name: "Tester" }],
                limitedEvents: [
                    {
                        _id: "event1",
                        status: "playing",
                        currentRound: 1,
                        seats: [],
                        rounds: [
                            {
                                roundNumber: 1,
                                startedAt: 0,
                                pairings: [
                                    { seatA: 0, seatB: 1, matchId: "match1" },
                                ],
                            },
                        ],
                        updatedAt: 0,
                    },
                ],
                matches: [
                    {
                        _id: "match1",
                        bestOf: 1,
                        status: "playing",
                        players: [seat(SEAT_A), seat(SEAT_B)],
                        currentGameNumber: 1,
                        currentGameId: "game1",
                        limitedEventId: "event1",
                        limitedPairing: { round: 1, seatA: 0, seatB: 1 },
                        createdAt: 0,
                        updatedAt: 0,
                    },
                ],
                games: [
                    {
                        _id: "game1",
                        name: "Pairing game",
                        status: "playing",
                        matchId: "match1",
                        players: [seat(SEAT_A), seat(SEAT_B)],
                        createdAt: 0,
                        updatedAt: 0,
                    },
                ],
            },
            { identitySubject: `${USER}|session1` }
        );

        await finalizeGameOver(db.ctx, "game1" as Id<"games">, 1, DRAWN);

        const pairing = (
            db.tables.limitedEvents[0].rounds as {
                pairings: {
                    result?: { winsA: number; winsB: number; source: string };
                }[];
            }[]
        )[0].pairings[0];
        // `limited/standings.ts` scores an equal-wins "played" result as a
        // draw — 1 point each — which is the right outcome for a drawn Game.
        expect(pairing.result).toEqual({
            winsA: 0,
            winsB: 0,
            source: "played",
        });
    });
});

describe("the banner's offered action is one the server accepts (issue #3336)", () => {
    it("projects the MATCH status alongside the Game's, so `finished` is not read as `waiting`", async () => {
        const db = world("sideboarding", "finished");

        const view = (await runMyActiveGame(db.ctx)) as {
            status: string;
            matchStatus: string;
        } | null;

        // A Bo3 between Games: the Game row is finished while the Match is
        // live. The two facts together are what tells the banner to offer
        // Concede Match (`forfeitMatch` accepts any unfinished Match) instead
        // of Leave — see `src/lib/activeGameExit.ts`.
        expect(view).not.toBeNull();
        expect(view!.status).toBe("finished");
        expect(view!.matchStatus).toBe("sideboarding");
    });

    it("`leaveGame` refuses a finished Game by NAMING it, never 'in progress'", async () => {
        const db = world("sideboarding", "finished");

        await expect(runLeaveGame(db.ctx, "game1")).rejects.toThrow(/finished/);
        await expect(runLeaveGame(db.ctx, "game1")).rejects.not.toThrow(
            /in progress/
        );
    });

    it("still accepts the waiting room it was written for", async () => {
        const db = world("waiting", "waiting");

        await runLeaveGame(db.ctx, "game1");

        expect(db.tables.games).toHaveLength(0);
        expect(db.tables.matches).toHaveLength(0);
    });
});
