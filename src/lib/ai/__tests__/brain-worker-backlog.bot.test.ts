// A timed-out consult must not leave work in the Worker that the Bot's next
// consult queues behind (issue #9514).
//
// `brain.worker.ts` serves requests ONE AT A TIME, in arrival order (its
// `chain`). `consultBrain` settles a consult as `timeout` after
// `BRAIN_CONSULT_TIMEOUT_MS`, but nothing tells the Worker: the timed-out
// search keeps running, and every request posted after it waits for it.
//
// The game-end Verdict Proposal judge (`useVerdictProposalCapture` →
// `proposeVerdicts`) consults the Brain once per sampled decision, each awaited
// before the next, at an ITERATION-ONLY budget (`{ iterations }`, no `timeMs`:
// `search.ts` checks the clock only when `timeMs` is set). It starts when Game
// 1 of a match ends. When Game 2 starts, the driver's effect cleanup calls
// `disposeBrain()` — the judge's in-flight consult settles as `worker-error` —
// but the judge loop goes on, and its next `consultBrain` spawns a fresh
// Worker: the one Game 2's Bot then shares. On a device where a judge search
// outlasts the consult timeout, every judge consult settles as `timeout` while
// its search stays queued, and the Bot's consults land behind that backlog:
// they time out too, the ladder passes every window, and the Bot plays no land
// for the rest of the game.
//
// Field evidence (issue #9514, Firefox on macOS): the judge logged
// `worker-error: 1, timeout: 17`; Game 2's Bot answered its first consult
// (a land) and then timed out 15 consults of 15 over four minutes. Before the
// fix this file reproduced exactly that tally.
//
// The fix: the judge consults a Brain channel of its own (`verdict-judge.ts`,
// `createBrainChannel(JUDGE_CHANNEL)`), with a Worker of its own and a timeout
// sized for an iteration-only search, so it neither stacks its own requests
// nor shares the Bot's queue, and the driver's dispose does not reach it.
//
// The fake Worker reproduces only the scheduling: FIFO, one request at a time,
// each occupying it for a service time derived from its budget. The judge's
// search time is an ASSUMPTION — any value above the consult timeout produces
// the backlog; the field device's real figure is unknown.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicGameState } from "@convex/gameProjections";
import { DIFFICULTY_BUDGETS } from "@convex/gre/difficulty";
import type { SearchBudget } from "@convex/gre/search";
import {
    consultBrain,
    disposeBrain,
    JUDGE_CONSULT_TIMEOUT_MS,
} from "../brain-client";
import { VERDICT_PROPOSAL_CONFIG } from "../verdict-proposal-config";
import { openVerdictJudge } from "../verdict-judge";

/** A judge search on a slow device: longer than the Bot's consult timeout. */
const JUDGE_SEARCH_MS = 8_000;

/** The judge's search time in the current test. */
let judgeSearchMs = JUDGE_SEARCH_MS;

/** Decisions the judge consults at one game end (the field report's 18). */
const JUDGED_DECISIONS = 18;

/** Time between two of the Bot's consults in Game 2 (field: ~10 s). */
const BOT_CONSULT_EVERY_MS = 10_000;

/** How long a request occupies the Worker: its wall-clock cap when it has
 *  one, else the slow device's iteration-only search time. */
function serviceMs(budget: SearchBudget | undefined): number {
    return budget?.timeMs ?? judgeSearchMs;
}

/** The Worker's scheduling, and nothing else: requests are served one at a
 *  time in arrival order, and a request is never abandoned once posted. */
class SerialWorker {
    /** Every Worker constructed, in order. */
    static spawned: SerialWorker[] = [];
    constructor() {
        SerialWorker.spawned.push(this);
    }
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    private busyUntil = 0;
    terminated = false;
    /** Requests this Worker was posted. */
    posted = 0;
    postMessage(req: { id: number; budget?: SearchBudget }) {
        this.posted += 1;
        const start = Math.max(Date.now(), this.busyUntil);
        this.busyUntil = start + serviceMs(req.budget);
        setTimeout(() => {
            if (this.terminated) return;
            this.onmessage?.({
                data: { id: req.id, move: { kind: "pass" }, trace: null },
            });
        }, this.busyUntil - Date.now());
    }
    terminate() {
        this.terminated = true;
    }
}

const STATE = {} as unknown as PublicGameState;
const BOT = "u1-p2";

const originalWorker = globalThis.Worker;

beforeEach(() => {
    vi.useFakeTimers();
    judgeSearchMs = JUDGE_SEARCH_MS;
    SerialWorker.spawned = [];
    (globalThis as { Worker?: unknown }).Worker =
        SerialWorker as unknown as typeof Worker;
});

afterEach(() => {
    disposeBrain();
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
    vi.useRealTimers();
});

/** The judge's loop shape (`proposeVerdicts`), through the judge's real
 *  Brain (`openVerdictJudge`, what `useVerdictProposalCapture` runs): one
 *  consult per decision, each awaited before the next is posted, at the fixed
 *  iteration budget. */
async function gameEndJudge(): Promise<Record<string, number>> {
    const { judge, tally, close } = openVerdictJudge();
    try {
        for (let i = 0; i < JUDGED_DECISIONS; i++) {
            await judge(
                { state: STATE, botId: BOT },
                { iterations: VERDICT_PROPOSAL_CONFIG.iterations },
                VERDICT_PROPOSAL_CONFIG.seed
            );
        }
    } finally {
        close();
    }
    return tally;
}

/** Game 1 ends (the judge starts), Game 2 replaces it a second later (the
 *  driver disposes the Bot's Brain), and Game 2's Bot consults the Brain every
 *  {@link BOT_CONSULT_EVERY_MS} at the medium preset for as long as the
 *  judge's backlog took to drain in the field, twice over. */
async function bo3GameOneToGameTwo(): Promise<{
    judge: Record<string, number>;
    bot: string[];
}> {
    const judging = gameEndJudge();
    await vi.advanceTimersByTimeAsync(1_000);
    disposeBrain();

    const bot: string[] = [];
    const window = 2 * JUDGED_DECISIONS * JUDGE_SEARCH_MS;
    for (let t = 0; t < window; t += BOT_CONSULT_EVERY_MS) {
        const consult = consultBrain(STATE, BOT, DIFFICULTY_BUDGETS.medium);
        await vi.advanceTimersByTimeAsync(BOT_CONSULT_EVERY_MS);
        bot.push((await consult).outcome);
    }
    return { judge: await judging, bot };
}

describe("the game-end judge never stands between the Bot and its next decision (issue #9514)", () => {
    it("answers every Game 2 Bot consult while the Game 1 judge runs and after", async () => {
        const { bot } = await bo3GameOneToGameTwo();
        expect(bot.filter((o) => o !== "move")).toEqual([]);
    });

    it("lets the judge answer every decision across the Game 1 → Game 2 swap", async () => {
        const { judge } = await bo3GameOneToGameTwo();
        expect(judge).toEqual({ move: JUDGED_DECISIONS });
    });

    it("runs the judge on a Worker of its own, terminated when the judge closes", async () => {
        await bo3GameOneToGameTwo();
        // The judge's Worker is the first spawned (Game 1 ends before the
        // Bot's Game 2 Worker exists); every judge consult went to it alone.
        const [judgeWorker, ...botWorkers] = SerialWorker.spawned;
        expect(judgeWorker!.posted).toBe(JUDGED_DECISIONS);
        expect(judgeWorker!.terminated).toBe(true);
        expect(botWorkers.length).toBeGreaterThan(0);
        expect(botWorkers.some((w) => w === judgeWorker)).toBe(false);
    });

    it("drops a judge Worker whose search outlasts the judge's timeout, so the next consult does not queue behind it", async () => {
        judgeSearchMs = JUDGE_CONSULT_TIMEOUT_MS + 10_000;
        const { judge, tally, close } = openVerdictJudge();
        const ask = () =>
            judge(
                { state: STATE, botId: BOT },
                { iterations: VERDICT_PROPOSAL_CONFIG.iterations },
                VERDICT_PROPOSAL_CONFIG.seed
            );
        const first = ask();
        await vi.advanceTimersByTimeAsync(JUDGE_CONSULT_TIMEOUT_MS + 1);
        await first;
        expect(tally).toEqual({ timeout: 1 });
        expect(SerialWorker.spawned).toHaveLength(1);
        expect(SerialWorker.spawned[0]!.terminated).toBe(true);

        // A fast search now: on a fresh Worker it answers, where behind the
        // abandoned one it would wait out the rest of that search and more.
        judgeSearchMs = 1_000;
        const second = ask();
        await vi.advanceTimersByTimeAsync(judgeSearchMs + 1);
        await second;
        close();
        expect(tally).toEqual({ timeout: 1, move: 1 });
        expect(SerialWorker.spawned).toHaveLength(2);
    });
});
