// The `check:ui` lane account lifecycle (issue #3626, PRD #3625 slice A).
//
// Driven through the REAL registered handlers (`_handler`) against the
// in-memory ctx — the project has no convex-test harness
// (`fixtures/inMemoryDb.ts`). The two actions run through a fake `ActionCtx`
// whose `runQuery`/`runMutation` dispatch a function reference back to the
// handler exported under that name, so the pagination, the per-batch deletes
// and the final indexed delete all execute exactly as deployed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import * as uiGateAccounts from "../uiGateAccounts";
import { autoPickSeatTimeout, expireRoundDeadline } from "../limitedEvents";
import {
    LANE_ACCOUNT_MAX_AGE_MS,
    laneAccountEmail,
} from "../lib/uiGateLaneAccount";
import { type InMemoryRow, makeInMemoryDb } from "./fixtures/inMemoryDb";

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;

function handlerOf(fn: unknown): Handler {
    return (fn as { _handler: Handler })._handler;
}

/** Blob ids the handlers asked storage to delete, reset per test. */
let storageDeleted: string[] = [];

function actionCtxFor(db: ReturnType<typeof makeInMemoryDb>) {
    Object.assign(db.ctx, {
        storage: {
            delete: async (id: string) => {
                storageDeleted.push(id);
            },
        },
    });
    const dispatch = async (ref: unknown, args: unknown) => {
        const [module, name] = getFunctionName(ref as never).split(":");
        if (module !== "uiGateAccounts") {
            throw new Error(`unexpected call into ${module}:${name}`);
        }
        const fn = (uiGateAccounts as Record<string, unknown>)[name];
        return await handlerOf(fn)(db.ctx, args);
    };
    return { runQuery: dispatch, runMutation: dispatch };
}

const LOCAL_URL = "http://127.0.0.1:3210";
const LANE_RUN_ID = "a1b2c3d4e5f6";
const LANE_EMAIL = laneAccountEmail(LANE_RUN_ID);
const LANE = "userlane";
const OTHER = "userother";

/** More rows than one scan page (`SCAN_PAGE_SIZE`, 200), owned by the real
 *  account and seeded BEFORE the lane's, so the teardown only finds the lane's
 *  games and matches by following the cursor to a later page. */
function fillerRows(prefix: string, count: number): InMemoryRow[] {
    return Array.from({ length: count }, (_, i) => ({
        _id: `${prefix}${i}`,
        players: [{ id: OTHER, name: "P1", bgColor: "", deck: {} }],
        status: "finished",
    }));
}

/** A lane account owning one of everything the teardown must remove, beside a
 *  real account owning the same shapes — which must all survive. */
function seededDeployment(): Record<string, InMemoryRow[]> {
    const now = Date.now();
    const solo = (userId: string) => [
        { id: `${userId}-p1`, name: "P1", bgColor: "", deck: {} },
        { id: `${userId}-p2`, name: "P2", bgColor: "", deck: {} },
    ];
    return {
        users: [
            {
                _id: LANE,
                _creationTime: now,
                email: LANE_EMAIL,
                nickname: "ui-gate",
            },
            {
                _id: OTHER,
                _creationTime: now - 10 * LANE_ACCOUNT_MAX_AGE_MS,
                email: "test@example.com",
                nickname: "dev",
            },
        ],
        userDecks: [
            { _id: "decklane", userId: LANE, name: "Autosaved" },
            { _id: "deckother", userId: OTHER, name: "Keep" },
        ],
        // A FINISHED solo match and an IN-PROGRESS vs-AI match for the lane,
        // one match for the real account.
        matches: [
            ...fillerRows("fillermatch", 250),
            { _id: "matchlanedone", players: solo(LANE), status: "finished" },
            {
                _id: "matchlanelive",
                players: [
                    { id: LANE, name: "P1", bgColor: "", deck: {} },
                    { id: "bot", name: "Bot", bgColor: "", deck: {} },
                ],
                status: "playing",
            },
            { _id: "matchother", players: solo(OTHER), status: "playing" },
        ],
        games: [
            ...fillerRows("fillergame", 250),
            {
                _id: "gamelanedone",
                matchId: "matchlanedone",
                players: solo(LANE),
                status: "finished",
            },
            {
                _id: "gamelanelive",
                matchId: "matchlanelive",
                players: [
                    { id: LANE, name: "P1", bgColor: "", deck: {} },
                    { id: "bot", name: "Bot", bgColor: "", deck: {} },
                ],
                status: "playing",
            },
            // A match-less legacy row: only the Game pass can reach it.
            { _id: "gamelanelegacy", players: solo(LANE), status: "waiting" },
            {
                _id: "gameother",
                matchId: "matchother",
                players: solo(OTHER),
                status: "playing",
            },
        ],
        gameStates: [
            { _id: "statelanedone", gameId: "gamelanedone" },
            { _id: "statelanelive", gameId: "gamelanelive" },
            { _id: "stateother", gameId: "gameother" },
        ],
        gameTicks: [
            { _id: "ticklanelive", gameId: "gamelanelive" },
            { _id: "tickother", gameId: "gameother" },
        ],
        gameDecks: [
            { _id: "gdecklanedone", gameId: "gamelanedone", playerId: "p1" },
            { _id: "gdeckother", gameId: "gameother", playerId: "p1" },
        ],
        matchDecks: [
            { _id: "mdecklane", matchId: "matchlanedone", playerId: "p1" },
            { _id: "mdeckother", matchId: "matchother", playerId: "p1" },
        ],
        manualStates: [{ _id: "manuallane", gameId: "gamelanelegacy" }],
        manualLog: [{ _id: "manuallog", gameId: "gamelanelegacy" }],
        limitedEvents: [
            {
                _id: "eventlane",
                createdBy: LANE,
                label: `ui-gate/${LANE_RUN_ID}/draft`,
            },
            { _id: "eventother", createdBy: OTHER },
        ],
        limitedSeats: [
            { _id: "seatlane", eventId: "eventlane", seatIndex: 0 },
            { _id: "seatother", eventId: "eventother", seatIndex: 0 },
        ],
        limitedSelections: [
            { _id: "sellane", eventId: "eventlane", seatIndex: 0 },
        ],
        verdicts: [
            { _id: "verdictlane", authorId: LANE },
            { _id: "verdictother", authorId: OTHER },
        ],
        userSettings: [{ _id: "settingslane", userId: LANE }],
        bugReports: [
            { _id: "reportlane", userId: LANE, attachmentId: "bloblane" },
            { _id: "reportother", userId: OTHER, attachmentId: "blobother" },
        ],
        debugScenarios: [
            { _id: "scenariolane", userId: LANE, label: "mine" },
            { _id: "scenarioshared", label: "UI stress" },
        ],
        limitedCubePools: [{ _id: "cubepoollane", eventId: "eventlane" }],
        authRateLimits: [
            { _id: "ratelane", identifier: LANE_EMAIL },
            { _id: "rateother", identifier: "test@example.com" },
        ],
        authAccounts: [
            { _id: "acclane", userId: LANE, provider: "password" },
            { _id: "accother", userId: OTHER, provider: "password" },
        ],
        authVerificationCodes: [{ _id: "codelane", accountId: "acclane" }],
        authSessions: [
            { _id: "sesslane", userId: LANE },
            { _id: "sessother", userId: OTHER },
        ],
        authRefreshTokens: [
            { _id: "toklane", sessionId: "sesslane" },
            { _id: "tokother", sessionId: "sessother" },
        ],
    };
}

/** Every id the lane account owns, directly or through a parent row. A
 *  surviving row that mentions any of them is an orphan the teardown left. */
const LANE_OWNED_IDS = [
    LANE,
    LANE_EMAIL,
    "decklane",
    "matchlanedone",
    "matchlanelive",
    "gamelanedone",
    "gamelanelive",
    "gamelanelegacy",
    "eventlane",
    "acclane",
    "sesslane",
];

function rowsReferencingLane(tables: Record<string, InMemoryRow[]>) {
    const hits: string[] = [];
    for (const [table, rows] of Object.entries(tables)) {
        for (const row of rows) {
            const text = JSON.stringify(row);
            if (LANE_OWNED_IDS.some((id) => text.includes(`"${id}`))) {
                hits.push(`${table}/${row._id}`);
            }
        }
    }
    return hits;
}

function countRows(tables: Record<string, InMemoryRow[]>): number {
    return Object.values(tables).reduce((n, rows) => n + rows.length, 0);
}

beforeEach(() => {
    storageDeleted = [];
    vi.stubEnv("CONVEX_CLOUD_URL", LOCAL_URL);
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe("grantLaneRoles (issue #3626)", () => {
    it("makes the lane account admin and tester", async () => {
        const db = makeInMemoryDb(seededDeployment());
        await handlerOf(uiGateAccounts.grantLaneRoles)(db.ctx, {
            email: LANE_EMAIL,
        });
        const lane = db.tables.users.find((u) => u._id === LANE)!;
        expect(lane.isAdmin).toBe(true);
        expect(lane.isTester).toBe(true);
    });

    it("refuses an address outside the lane pattern — the shared dev account included", async () => {
        const db = makeInMemoryDb(seededDeployment());
        for (const email of [
            "test@example.com",
            "ui-gate+a1b2c3d4e5f6@example.com",
            "ui-gate+A1B2C3D4E5F6@ui-gate.invalid",
            "x-ui-gate+a1b2c3d4e5f6@ui-gate.invalid",
        ]) {
            await expect(
                handlerOf(uiGateAccounts.grantLaneRoles)(db.ctx, { email })
            ).rejects.toThrow(/not a check:ui lane account/);
        }
        expect(db.writes).toEqual([]);
    });

    it("refuses a deployment that is not local", async () => {
        vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
        const db = makeInMemoryDb(seededDeployment());
        await expect(
            handlerOf(uiGateAccounts.grantLaneRoles)(db.ctx, {
                email: LANE_EMAIL,
            })
        ).rejects.toThrow(/only on a local deployment/);
        expect(db.writes).toEqual([]);
    });
});

describe("destroyLaneAccount (issue #3626)", () => {
    it("leaves zero rows referencing the account in any dependent table, and every other account's rows intact", async () => {
        const initial = seededDeployment();
        const db = makeInMemoryDb(initial);
        const survivorsBefore = countRows(initial) - 0;

        const result = (await handlerOf(uiGateAccounts.destroyLaneAccount)(
            actionCtxFor(db),
            { email: LANE_EMAIL }
        )) as { destroyed: boolean; counts: Record<string, number> };

        expect(result.destroyed).toBe(true);
        expect(rowsReferencingLane(db.tables)).toEqual([]);
        // The real account's rows, one per table seeded for it, all survive.
        expect(db.tables.users.map((r) => r._id)).toEqual([OTHER]);
        const unfilled = (rows: InMemoryRow[]) =>
            rows.map((r) => r._id).filter((id) => !id.startsWith("filler"));
        expect(unfilled(db.tables.games)).toEqual(["gameother"]);
        expect(db.tables.games).toHaveLength(251);
        expect(unfilled(db.tables.matches)).toEqual(["matchother"]);
        expect(db.tables.debugScenarios.map((r) => r._id)).toEqual([
            "scenarioshared",
        ]);
        expect(db.tables.authRateLimits.map((r) => r._id)).toEqual([
            "rateother",
        ]);
        // The lane report's blob goes with it; the real account's stays.
        expect(storageDeleted).toEqual(["bloblane"]);
        expect(db.tables.verdicts.map((r) => r._id)).toEqual(["verdictother"]);
        expect(db.tables.authRefreshTokens.map((r) => r._id)).toEqual([
            "tokother",
        ]);
        expect(countRows(db.tables)).toBeLessThan(survivorsBefore);
    });

    it("is idempotent: a second teardown of the same address reports nothing destroyed", async () => {
        const db = makeInMemoryDb(seededDeployment());
        const destroy = handlerOf(uiGateAccounts.destroyLaneAccount);
        await destroy(actionCtxFor(db), { email: LANE_EMAIL });
        const second = (await destroy(actionCtxFor(db), {
            email: LANE_EMAIL,
        })) as { destroyed: boolean };
        expect(second.destroyed).toBe(false);
    });

    it("refuses an address outside the lane pattern and deletes nothing", async () => {
        const initial = seededDeployment();
        const db = makeInMemoryDb(initial);
        await expect(
            handlerOf(uiGateAccounts.destroyLaneAccount)(actionCtxFor(db), {
                email: "test@example.com",
            })
        ).rejects.toThrow(/not a check:ui lane account/);
        // The final indexed-delete mutation is reachable on its own too, and
        // must refuse on its own.
        await expect(
            handlerOf(uiGateAccounts.deleteLaneAccountRows)(db.ctx, {
                email: "test@example.com",
            })
        ).rejects.toThrow(/not a check:ui lane account/);
        expect(countRows(db.tables)).toBe(countRows(initial));
    });

    it("never deletes a row the account does not own, whatever ids it is handed", async () => {
        const initial = seededDeployment();
        const db = makeInMemoryDb(initial);
        const deleted = await handlerOf(uiGateAccounts.deleteOwnedRows)(
            db.ctx,
            { table: "games", userId: LANE, ids: ["gameother"] }
        );
        expect(deleted).toBe(0);
        expect(countRows(db.tables)).toBe(countRows(initial));
    });
});

describe("the teardown's page and delete helpers (issue #3626)", () => {
    // Internal functions deploy everywhere, so each must refuse on its own —
    // not only when reached through `destroyLaneAccount`.
    it("refuse a user id that is not a lane account", async () => {
        const initial = seededDeployment();
        const db = makeInMemoryDb(initial);
        actionCtxFor(db);
        await expect(
            handlerOf(uiGateAccounts.deleteOwnedRows)(db.ctx, {
                table: "games",
                userId: OTHER,
                ids: ["gameother"],
            })
        ).rejects.toThrow(/not a check:ui lane account/);
        await expect(
            handlerOf(uiGateAccounts.ownedRowsPage)(db.ctx, {
                table: "games",
                userId: OTHER,
                cursor: null,
            })
        ).rejects.toThrow(/not a check:ui lane account/);
        expect(countRows(db.tables)).toBe(countRows(initial));
    });

    it("refuse a deployment that is not local", async () => {
        vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
        const db = makeInMemoryDb(seededDeployment());
        await expect(
            handlerOf(uiGateAccounts.deleteOwnedRows)(db.ctx, {
                table: "games",
                userId: LANE,
                ids: ["gamelanelive"],
            })
        ).rejects.toThrow(/only on a local deployment/);
    });
});

describe("sweepStaleLaneAccounts (issue #3626)", () => {
    it("destroys only lane accounts older than the age threshold", async () => {
        const now = Date.now();
        const stale = laneAccountEmail("000000000001");
        const fresh = laneAccountEmail("000000000002");
        const db = makeInMemoryDb({
            users: [
                {
                    _id: "userstale",
                    _creationTime: now - LANE_ACCOUNT_MAX_AGE_MS - 60_000,
                    email: stale,
                    nickname: "x",
                },
                {
                    _id: "userfresh",
                    _creationTime: now - 60_000,
                    email: fresh,
                    nickname: "x",
                },
                // Old, inside the index range, but not the lane pattern.
                {
                    _id: "usernearmiss",
                    _creationTime: now - 10 * LANE_ACCOUNT_MAX_AGE_MS,
                    email: "ui-gate+someone@ui-gate.invalid",
                    nickname: "x",
                },
                {
                    _id: "userreal",
                    _creationTime: now - 10 * LANE_ACCOUNT_MAX_AGE_MS,
                    email: "test@example.com",
                    nickname: "x",
                },
            ],
        });

        const result = (await handlerOf(uiGateAccounts.sweepStaleLaneAccounts)(
            actionCtxFor(db),
            {}
        )) as { swept: string[] };

        expect(result.swept).toEqual([stale]);
        expect(db.tables.users.map((u) => u._id).sort()).toEqual([
            "userfresh",
            "usernearmiss",
            "userreal",
        ]);
    });

    it("refuses a deployment that is not local", async () => {
        vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
        const db = makeInMemoryDb(seededDeployment());
        await expect(
            handlerOf(uiGateAccounts.sweepStaleLaneAccounts)(
                actionCtxFor(db),
                {}
            )
        ).rejects.toThrow(/only on a local deployment/);
    });
});

// The PRD asks the game's scheduled handlers (priority timeout, Bot driver) to
// tolerate a destroyed row. Audited for this issue: neither is server-side —
// `convex/game.ts` schedules nothing (the Bot is driven from the client, and
// no priority timer is armed through `ctx.scheduler`). The scheduled work a
// teardown CAN orphan is the Limited event's: its fixtures run with the timer
// off, but a torn-down event must still never make a pending schedule throw.
describe("scheduled work against a destroyed Limited event (issue #3626)", () => {
    it("autoPickSeatTimeout returns quietly", async () => {
        const db = makeInMemoryDb({});
        await expect(
            handlerOf(autoPickSeatTimeout)(db.ctx, {
                eventId: "eventlane",
                seatIndex: 0,
                expectedSeq: 0,
            })
        ).resolves.toBeNull();
    });

    it("expireRoundDeadline returns quietly", async () => {
        const db = makeInMemoryDb({});
        await expect(
            handlerOf(expireRoundDeadline)(db.ctx, {
                eventId: "eventlane",
                roundNumber: 1,
            })
        ).resolves.toBeNull();
    });
});
