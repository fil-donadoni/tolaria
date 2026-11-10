// `botLiveness.reportStall` — the client driver's hand-off when its escalation
// ladder ran out (issue #9003, PRD issue #8998). Driven through the REGISTERED
// handler against the shared stub ctx: who may call it, which calls are
// no-ops, and what a valid call writes — the advanced state (through
// `saveGameState`) and the `source: "system"` report row.
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "../_generated/server";
import {
    STALL_DIAGNOSTICS_MAX_BYTES,
    reportStall,
    type ReportStallResult,
} from "../botLiveness";
import { getCardByName } from "../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { botOwedWindow } from "../gre/forceAdvance";
import type { GameState, StackItem } from "../gre/state";
import {
    makeMutationCtx,
    runMutation,
    type Row,
} from "./gameMutationHarness.fixture";

const USER = "u1";
const HUMAN = `${USER}-p1`;
const BOT = `${USER}-p2`;
const BEAR = getCardByName("Grizzly Bears").id;
const WURM = getCardByName("Craw Wurm").id;

/** CR 117 — the Bot holds priority on an empty stack. */
function botPriorityBoard(): GameState {
    return makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

/** CR 603.3d — the Bot's own triggered ability (a Grizzly Bears source) waits
 *  on its target among two legal creatures. */
function botTargetBoard(): GameState {
    const state = makeState({
        players: [
            makePlayer(HUMAN, {
                battlefield: [
                    makeInstance(BEAR, {
                        id: "bear",
                        controllerId: HUMAN,
                        ownerId: HUMAN,
                    }),
                    makeInstance(WURM, {
                        id: "wurm",
                        controllerId: HUMAN,
                        ownerId: HUMAN,
                    }),
                ],
            }),
            makePlayer(BOT),
        ],
        activePlayerId: HUMAN,
        priorityPlayerId: BOT,
    });
    state.stack.push({
        ...makeInstance(BEAR, { id: "trig", controllerId: BOT, ownerId: BOT }),
        castById: BOT,
        targets: [],
        isTriggeredAbility: true,
    } as StackItem);
    state.pendingTarget = {
        playerId: BOT,
        cardInstanceId: "trig",
        kind: "trigger",
        targetType: "Creature",
        count: 1,
        selected: [],
    };
    return state;
}

function seeds(state: GameState, game: Partial<Row> = {}): Row[] {
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
            state,
            updatedAt: 0,
        },
    ];
}

const DIAGNOSTICS = { ai: { decisions: [{ outcome: "unanswered" }] } };

function call(
    ctx: MutationCtx,
    args: Partial<{ seq: number; diagnostics: unknown }> = {}
): Promise<ReportStallResult> {
    return runMutation(reportStall, ctx, {
        gameId: "game-1",
        seq: 7,
        diagnostics: DIAGNOSTICS,
        ...args,
    });
}

function systemRows(stub: ReturnType<typeof makeMutationCtx>): Row[] {
    return stub.writes
        .filter((w) => w.table === "bugReports")
        .map((w) => stub.doc(w.id));
}

describe("botLiveness.reportStall — who may hand off (issue #9003)", () => {
    it("rejects a caller who is not the human of the game", async () => {
        const stub = makeMutationCtx("u2", seeds(botPriorityBoard()));
        await expect(call(stub.ctx)).rejects.toThrow(/not the player/);
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects an unauthenticated caller", async () => {
        const stub = makeMutationCtx(null, seeds(botPriorityBoard()));
        await expect(call(stub.ctx)).rejects.toThrow();
        expect(stub.writes).toHaveLength(0);
    });

    it("rejects a game that is not vs-AI", async () => {
        const stub = makeMutationCtx(
            USER,
            seeds(botPriorityBoard(), { vsAi: false })
        );
        await expect(call(stub.ctx)).rejects.toThrow(/no Bot seat/);
        expect(stub.writes).toHaveLength(0);
    });
});

describe("botLiveness.reportStall — no-ops (issue #9003)", () => {
    it("does nothing on a stale seq", async () => {
        const stub = makeMutationCtx(USER, seeds(botPriorityBoard()));
        await expect(call(stub.ctx, { seq: 6 })).resolves.toEqual({
            advanced: false,
            reason: "stale-seq",
        });
        expect(stub.writes).toHaveLength(0);
    });

    it("does nothing when the Bot is not owed input", async () => {
        const state = botPriorityBoard();
        state.priorityPlayerId = HUMAN;
        const stub = makeMutationCtx(USER, seeds(state));
        await expect(call(stub.ctx)).resolves.toEqual({
            advanced: false,
            reason: "not-owed",
        });
        expect(stub.writes).toHaveLength(0);
    });
});

describe("botLiveness.reportStall — a valid hand-off (issue #9003)", () => {
    it("advances the Bot's window, saves the next seq and files a client-handoff system report", async () => {
        const stub = makeMutationCtx(USER, seeds(botPriorityBoard()));
        await expect(call(stub.ctx)).resolves.toEqual({
            advanced: true,
            outcome: "advanced",
        });

        // CR 117.3d — the Bot's pass hands priority to the human.
        expect(stub.doc("gs-1").seq).toBe(8);
        const after = stub.state();
        expect(botOwedWindow(after, BOT)).toBeNull();
        expect(after.priorityPlayerId).toBe(HUMAN);

        const rows = systemRows(stub);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            source: "system",
            gameId: "game-1",
            // The frozen state is the one AT the fault, not the advanced one.
            seq: 7,
            clientDiagnostics: DIAGNOSTICS,
            fault: {
                origin: "client-handoff",
                expectedKind: "priority",
                faultClass: "ladder-exhausted",
            },
        });
        expect((rows[0].fault as { steps: unknown[] }).steps).toEqual([
            { step: "pass", ok: true },
        ]);
    });

    it("names the owed window's source card and target type in the fault", async () => {
        const stub = makeMutationCtx(USER, seeds(botTargetBoard()));
        const result = await call(stub.ctx);
        expect(result.advanced).toBe(true);
        expect(systemRows(stub)[0].fault).toMatchObject({
            expectedKind: "target",
            targetType: "Creature",
            sourceCardName: "Grizzly Bears",
        });
    });

    it("stores oversized diagnostics as a size note, and still advances", async () => {
        const stub = makeMutationCtx(USER, seeds(botPriorityBoard()));
        const huge = { console: ["x".repeat(STALL_DIAGNOSTICS_MAX_BYTES)] };
        const result = await call(stub.ctx, { diagnostics: huge });
        expect(result.advanced).toBe(true);
        expect(systemRows(stub)[0].clientDiagnostics).toMatchObject({
            omitted: expect.stringContaining("cap"),
        });
    });
});
