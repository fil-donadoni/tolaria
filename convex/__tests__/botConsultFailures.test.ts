// `botLiveness.reportConsultFailure` / `getConsultFailures` and the counters
// `bugReports.getReport` carries (issue #9502). A failed Brain consult is
// recorded against its game, bounded, by the human of the vs-AI game only —
// driven through the REGISTERED handlers against the shared stub ctx.
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "../_generated/server";
import {
    CONSULT_FAILURE_MESSAGE_MAX,
    CONSULT_FAILURE_SAMPLE_CAP,
    type ConsultFailureOutcome,
    type ConsultFailureRecord,
} from "../botConsultFailureStore";
import { getConsultFailures, reportConsultFailure } from "../botLiveness";
import { getReport } from "../bugReports";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import type { GameState } from "../gre/state";
import {
    makeMutationCtx,
    runMutation,
    type Row,
} from "./gameMutationHarness.fixture";

const USER = "u1";
const HUMAN = `${USER}-p1`;
const BOT = `${USER}-p2`;
const FOREST = getCardByName("Forest").id;

/** CR 305.2 — the Bot's own precombat main, a Forest in hand, no land played:
 *  its land drop is legal. */
function botMainWithLand(): GameState {
    return makeState({
        players: [
            makePlayer(HUMAN),
            makePlayer(BOT, {
                hand: [
                    makeInstance(FOREST, {
                        id: "forest",
                        controllerId: BOT,
                        ownerId: BOT,
                    }),
                ],
            }),
        ],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

function seeds(game: Partial<Row> = {}): Row[] {
    return [
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
            status: "playing",
            solo: true,
            vsAi: true,
            players: [{ id: HUMAN }, { id: BOT }],
            createdAt: 0,
            updatedAt: 0,
            ...game,
        },
        {
            _id: "gs-1",
            __table: "gameStates",
            gameId: "game-1",
            seq: 7,
            state: botMainWithLand(),
            updatedAt: 0,
        },
    ];
}

function report(
    ctx: MutationCtx,
    outcome: ConsultFailureOutcome,
    extra: Partial<{ seq: number; message: string }> = {}
): Promise<null> {
    return runMutation(reportConsultFailure, ctx, {
        gameId: "game-1",
        seq: 7,
        outcome,
        ...extra,
    });
}

function record(ctx: MutationCtx): Promise<ConsultFailureRecord | null> {
    return runMutation(getConsultFailures, ctx, { gameId: "game-1" });
}

function failureRows(stub: ReturnType<typeof makeMutationCtx>): Row[] {
    return stub.writes
        .filter((w) => w.table === "botConsultFailures")
        .map((w) => stub.doc(w.id));
}

describe("botLiveness.reportConsultFailure — the record (issue #9502)", () => {
    it("counts each outcome and samples the position the consult ran on", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await report(stub.ctx, "timeout");
        await report(stub.ctx, "timeout");
        await report(stub.ctx, "worker-error", { message: "boom" });

        const rec = await record(stub.ctx);
        expect(rec?.counts).toEqual({
            searchError: 0,
            workerError: 1,
            timeout: 2,
        });
        expect(rec?.samples).toHaveLength(3);
        expect(rec?.samples[2]).toMatchObject({
            outcome: "worker-error",
            seq: 7,
            turn: 1,
            phase: "PRECOMBAT_MAIN",
            landDropLegal: true,
            message: "boom",
        });
        // ONE row per game, patched in place.
        expect(failureRows(stub)).toHaveLength(1);
        // The fat state row and the tick row are never written.
        expect(stub.writes.some((w) => w.id === "gs-1")).toBe(false);
    });

    it("caps the sample ring, dropping the oldest first, and keeps counting", async () => {
        const stub = makeMutationCtx(USER, seeds());
        const total = CONSULT_FAILURE_SAMPLE_CAP + 3;
        for (let i = 0; i < total; i++) {
            await report(stub.ctx, "search-error", { message: `m${i}` });
        }
        const rec = await record(stub.ctx);
        expect(rec?.counts.searchError).toBe(total);
        expect(rec?.samples).toHaveLength(CONSULT_FAILURE_SAMPLE_CAP);
        expect(rec?.samples[0]?.message).toBe("m3");
        expect(rec?.samples[rec.samples.length - 1]?.message).toBe(
            `m${total - 1}`
        );
    });

    it("truncates the Brain message", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await report(stub.ctx, "search-error", { message: "x".repeat(5000) });
        const rec = await record(stub.ctx);
        expect(rec?.samples[0]?.message?.length).toBe(
            CONSULT_FAILURE_MESSAGE_MAX
        );
    });

    it("keeps only seq and outcome when the game moved past the consult's version", async () => {
        const stub = makeMutationCtx(USER, seeds());
        await report(stub.ctx, "timeout", { seq: 5 });
        const sample = (await record(stub.ctx))?.samples[0];
        expect(sample).toMatchObject({ outcome: "timeout", seq: 5 });
        expect(sample).not.toHaveProperty("turn");
        expect(sample).not.toHaveProperty("phase");
        expect(sample).not.toHaveProperty("landDropLegal");
    });
});

describe("botLiveness.reportConsultFailure — who may report (issue #9502)", () => {
    it("rejects a caller who is not the human of the game, writing nothing", async () => {
        const stub = makeMutationCtx("u2", seeds());
        await expect(report(stub.ctx, "timeout")).rejects.toThrow(
            /not the player/
        );
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects an unauthenticated caller, writing nothing", async () => {
        const stub = makeMutationCtx(null, seeds());
        await expect(report(stub.ctx, "timeout")).rejects.toThrow();
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a game that is not vs-AI, writing nothing", async () => {
        const stub = makeMutationCtx(USER, seeds({ vsAi: false }));
        await expect(report(stub.ctx, "timeout")).rejects.toThrow(
            /no Bot seat/
        );
        expect(stub.writes).toHaveLength(0);
    });
});

describe("botLiveness.getConsultFailures (issue #9502)", () => {
    it("is null for a game whose Bot never failed a consult", async () => {
        const stub = makeMutationCtx(USER, seeds());
        expect(await record(stub.ctx)).toBeNull();
    });
});

describe("bugReports.getReport — consult failure counters (issue #9502)", () => {
    const REPORT: Row = {
        _id: "report-1",
        __table: "bugReports",
        name: "Ada",
        email: "ada@example.com",
        description: "the bot stopped playing lands",
        gameId: "game-1",
        _creationTime: 1,
    };

    function read(ctx: MutationCtx): Promise<Record<string, unknown> | null> {
        return runMutation(getReport, ctx, { reportId: "report-1" });
    }

    it("carries the counters when the report's game has a record", async () => {
        const stub = makeMutationCtx(USER, [...seeds(), REPORT]);
        await report(stub.ctx, "timeout");
        const row = await read(stub.ctx);
        expect(row?.botConsultFailures).toEqual({
            searchError: 0,
            workerError: 0,
            timeout: 1,
        });
    });

    it("is unchanged when the game has no record", async () => {
        const stub = makeMutationCtx(USER, [...seeds(), REPORT]);
        const row = await read(stub.ctx);
        expect(row).not.toBeNull();
        expect(row).not.toHaveProperty("botConsultFailures");
    });
});
