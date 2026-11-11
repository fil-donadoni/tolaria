// The Bot server deadline (issue #9004, PRD issue #8998 layer 3): the ONE
// scheduled check per vs-AI game that force-advances a dead driver's window.
// The planner is unit-tested alone; the wiring runs through the REAL seams —
// `saveGameState` (the arm) and the registered `botLiveness.checkDeadline`
// handler (clear / re-arm / enforce) — over the shared stub ctx, whose
// scheduler records every job instead of running it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
    BOT_SERVER_DEADLINE_MS,
    planBotDeadline,
    type BotDeadlineTick,
} from "../botDeadline";
import {
    DEADLINE_DIAGNOSTICS,
    DEADLINE_FAULT_CLASS,
    checkDeadline,
} from "../botLiveness";
import { saveGameState } from "../gameStateStore";
import { makePlayer, makeState } from "../cards/__tests__/setup.helper";
import { botOwedWindow } from "../gre/forceAdvance";
import type { GameState } from "../gre/state";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "./gameMutationHarness.fixture";

const USER = "u1";
const HUMAN = `${USER}-p1`;
const BOT = `${USER}-p2`;
const GAME = "game-1" as Id<"games">;
const CHECK = "botLiveness:checkDeadline";
const T0 = 1_000_000;

/** CR 117 — `holder` holds priority on an empty stack, the Bot's turn. */
function priorityBoard(holder: string): GameState {
    return makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT)],
        activePlayerId: BOT,
        priorityPlayerId: holder,
    });
}

function seeds(state: GameState, vsAi = true): Row[] {
    return [
        {
            _id: "game-1",
            __table: "games",
            name: "Game",
            status: "playing",
            solo: true,
            vsAi,
            players: [{ id: HUMAN }, { id: BOT }],
            createdAt: 0,
            updatedAt: 0,
        },
        {
            _id: "gs-1",
            __table: "gameStates",
            gameId: "game-1",
            seq: 7,
            state,
            solo: true,
            vsAi,
            updatedAt: 0,
        },
    ];
}

/** Save `state` at `seq` through the one persistence seam. */
async function save(stub: MutationStub, seq: number, state: GameState) {
    await saveGameState(stub.ctx, GAME, seq, state, stub.doc("gs-1") as never);
}

function tickRow(stub: MutationStub): Row {
    const id = stub.writes.find((w) => w.table === "gameTicks")?.id;
    if (!id) throw new Error("no gameTicks row written");
    return stub.doc(id);
}

function checks(stub: MutationStub) {
    return stub.scheduled.filter((s) => s.name === CHECK);
}

function runCheck(stub: MutationStub, seq: number): Promise<null> {
    return runMutation(checkDeadline, stub.ctx as MutationCtx, {
        gameId: GAME,
        seq,
    });
}

function systemRows(stub: MutationStub): Row[] {
    return stub.writes
        .filter((w) => w.table === "bugReports")
        .map((w) => stub.doc(w.id));
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
});
afterEach(() => {
    vi.useRealTimers();
});

describe("planBotDeadline (issue #9004)", () => {
    const owed: BotDeadlineTick = {
        seq: 7,
        updatedAt: T0,
        owedPlayerIds: [BOT],
    };
    const due = T0 + BOT_SERVER_DEADLINE_MS;

    it("save: arms for now + deadline when the Bot is owed and nothing is pending", () => {
        expect(
            planBotDeadline({
                tick: owed,
                botId: BOT,
                trigger: { kind: "save" },
                now: T0,
            })
        ).toEqual({ kind: "arm", at: due, seq: 7 });
    });

    it("save: schedules nothing while a check is already pending", () => {
        expect(
            planBotDeadline({
                tick: { ...owed, botDeadlineAt: due },
                botId: BOT,
                trigger: { kind: "save" },
                now: T0,
            })
        ).toEqual({ kind: "already-pending" });
    });

    it("save: re-arms over an orphaned marker — one a full deadline overdue", () => {
        const now = due + BOT_SERVER_DEADLINE_MS;
        expect(
            planBotDeadline({
                tick: { ...owed, botDeadlineAt: due },
                botId: BOT,
                trigger: { kind: "save" },
                now,
            })
        ).toEqual({ kind: "arm", at: now + BOT_SERVER_DEADLINE_MS, seq: 7 });
    });

    it("save: never arms outside a vs-AI game, nor when the Bot is not owed", () => {
        expect(
            planBotDeadline({
                tick: owed,
                botId: null,
                trigger: { kind: "save" },
                now: T0,
            })
        ).toEqual({ kind: "none" });
        expect(
            planBotDeadline({
                tick: { ...owed, owedPlayerIds: [HUMAN] },
                botId: BOT,
                trigger: { kind: "save" },
                now: T0,
            })
        ).toEqual({ kind: "none" });
    });

    it("check: clears when the Bot is no longer owed, or the game is over", () => {
        for (const tick of [
            { ...owed, owedPlayerIds: [HUMAN] },
            { ...owed, gameOver: true },
        ]) {
            expect(
                planBotDeadline({
                    tick,
                    botId: BOT,
                    trigger: { kind: "check", seq: 7 },
                    now: due,
                })
            ).toEqual({ kind: "clear" });
        }
    });

    it("check: re-arms for the newer version's own deadline when the Bot is owed at a newer seq", () => {
        expect(
            planBotDeadline({
                tick: { ...owed, seq: 9, updatedAt: T0 + 20_000 },
                botId: BOT,
                trigger: { kind: "check", seq: 7 },
                now: due,
            })
        ).toEqual({ kind: "arm", at: due + 20_000, seq: 9 });
    });

    it("check: enforces on the same seq past the deadline", () => {
        expect(
            planBotDeadline({
                tick: owed,
                botId: BOT,
                trigger: { kind: "check", seq: 7 },
                now: due,
            })
        ).toEqual({ kind: "enforce" });
    });
});

describe("saveGameState arms the deadline (issue #9004)", () => {
    it("a vs-AI save with the Bot owed schedules exactly one check; a second save while pending schedules none", async () => {
        const stub = makeMutationCtx(USER, seeds(priorityBoard(BOT)));
        await save(stub, 8, priorityBoard(BOT));
        expect(checks(stub)).toEqual([
            {
                delayMs: BOT_SERVER_DEADLINE_MS,
                name: CHECK,
                args: { gameId: GAME, seq: 8 },
            },
        ]);
        expect(tickRow(stub).botDeadlineAt).toBe(T0 + BOT_SERVER_DEADLINE_MS);

        vi.setSystemTime(T0 + 5_000);
        await save(stub, 9, priorityBoard(BOT));
        expect(checks(stub)).toHaveLength(1);
        expect(tickRow(stub).botDeadlineAt).toBe(T0 + BOT_SERVER_DEADLINE_MS);
    });

    it("a non-vs-AI game never arms", async () => {
        const stub = makeMutationCtx(USER, seeds(priorityBoard(BOT), false));
        await save(stub, 8, priorityBoard(BOT));
        expect(checks(stub)).toHaveLength(0);
        expect(tickRow(stub).botDeadlineAt).toBeUndefined();
    });

    it("does not arm while the human is the one owed", async () => {
        const stub = makeMutationCtx(USER, seeds(priorityBoard(HUMAN)));
        await save(stub, 8, priorityBoard(HUMAN));
        expect(checks(stub)).toHaveLength(0);
    });
});

describe("botLiveness.checkDeadline (issue #9004)", () => {
    it("a stale check after the Bot acted is a no-op: no advance, no report, marker cleared", async () => {
        const stub = makeMutationCtx(USER, seeds(priorityBoard(BOT)));
        await save(stub, 8, priorityBoard(BOT));
        // CR 117.3d — the Bot passed; the human now holds priority.
        await save(stub, 9, priorityBoard(HUMAN));
        vi.setSystemTime(T0 + BOT_SERVER_DEADLINE_MS);

        await runCheck(stub, 8);
        expect(stub.doc("gs-1").seq).toBe(9);
        expect(systemRows(stub)).toHaveLength(0);
        expect(checks(stub)).toHaveLength(1);
        expect(tickRow(stub).botDeadlineAt).toBeUndefined();
    });

    it("re-arms, without enforcing, when the Bot is owed again at a newer seq", async () => {
        const stub = makeMutationCtx(USER, seeds(priorityBoard(BOT)));
        await save(stub, 8, priorityBoard(BOT));
        vi.setSystemTime(T0 + 20_000);
        await save(stub, 9, priorityBoard(BOT));
        vi.setSystemTime(T0 + BOT_SERVER_DEADLINE_MS);

        await runCheck(stub, 8);
        expect(stub.doc("gs-1").seq).toBe(9);
        expect(systemRows(stub)).toHaveLength(0);
        expect(checks(stub)[1]).toEqual({
            delayMs: 20_000,
            name: CHECK,
            args: { gameId: GAME, seq: 9 },
        });
        expect(tickRow(stub).botDeadlineAt).toBe(
            T0 + 20_000 + BOT_SERVER_DEADLINE_MS
        );
    });

    it("a check on a stuck seq advances the game and files an origin server-deadline report", async () => {
        const stub = makeMutationCtx(USER, seeds(priorityBoard(BOT)));
        await save(stub, 8, priorityBoard(BOT));
        vi.setSystemTime(T0 + BOT_SERVER_DEADLINE_MS);

        await runCheck(stub, 8);
        // CR 117.3d — the forced pass hands priority to the human.
        expect(stub.doc("gs-1").seq).toBe(9);
        const after = stub.state();
        expect(botOwedWindow(after, BOT)).toBeNull();
        expect(after.priorityPlayerId).toBe(HUMAN);

        const rows = systemRows(stub);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            source: "system",
            gameId: "game-1",
            seq: 8,
            clientDiagnostics: DEADLINE_DIAGNOSTICS,
            fault: {
                origin: "server-deadline",
                expectedKind: "priority",
                faultClass: DEADLINE_FAULT_CLASS,
            },
        });
        // The marker is gone and the human-owed save armed nothing new.
        expect(tickRow(stub).botDeadlineAt).toBeUndefined();
        expect(checks(stub)).toHaveLength(1);
    });
});
