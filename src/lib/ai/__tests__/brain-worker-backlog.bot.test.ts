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
// (a land) and then timed out 15 consults of 15 over four minutes.
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
    BRAIN_CONSULT_TIMEOUT_MS,
    consultBrain,
    disposeBrain,
} from "../brain-client";
import { VERDICT_PROPOSAL_CONFIG } from "../verdict-proposal-config";

/** A judge search on a slow device: longer than the consult timeout. */
const JUDGE_SEARCH_MS = 8_000;

/** Decisions the judge consults at one game end (the field report's 18). */
const JUDGED_DECISIONS = 18;

/** Time between two of the Bot's consults in Game 2 (field: ~10 s). */
const BOT_CONSULT_EVERY_MS = 10_000;

/** How long a request occupies the Worker: its wall-clock cap when it has
 *  one, else the slow device's iteration-only search time. */
function serviceMs(budget: SearchBudget | undefined): number {
    return budget?.timeMs ?? JUDGE_SEARCH_MS;
}

/** The Worker's scheduling, and nothing else: requests are served one at a
 *  time in arrival order, and a request is never abandoned once posted. */
class SerialWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    private busyUntil = 0;
    private terminated = false;
    postMessage(req: { id: number; budget?: SearchBudget }) {
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
    (globalThis as { Worker?: unknown }).Worker =
        SerialWorker as unknown as typeof Worker;
});

afterEach(() => {
    disposeBrain();
    (globalThis as { Worker?: unknown }).Worker = originalWorker;
    vi.useRealTimers();
});

/** The judge's loop shape (`proposeVerdicts`): one consult per decision,
 *  each awaited before the next is posted, at the fixed iteration budget. */
async function gameEndJudge(outcomes: string[]): Promise<void> {
    for (let i = 0; i < JUDGED_DECISIONS; i++) {
        const result = await consultBrain(
            STATE,
            BOT,
            { iterations: VERDICT_PROPOSAL_CONFIG.iterations },
            undefined,
            undefined,
            VERDICT_PROPOSAL_CONFIG.seed
        );
        outcomes.push(result.outcome);
    }
}

/** Game 1 ends (the judge starts), Game 2 replaces it a second later (the
 *  driver disposes the Brain), and Game 2's Bot consults the Brain every
 *  {@link BOT_CONSULT_EVERY_MS} at the medium preset until the judge is done
 *  and for as long again. */
async function bo3GameOneToGameTwo(): Promise<{
    judge: string[];
    bot: string[];
}> {
    const judge: string[] = [];
    const judging = gameEndJudge(judge);
    await vi.advanceTimersByTimeAsync(1_000);
    disposeBrain();

    const bot: string[] = [];
    const window = 2 * JUDGED_DECISIONS * (BRAIN_CONSULT_TIMEOUT_MS + 1);
    for (let t = 0; t < window; t += BOT_CONSULT_EVERY_MS) {
        const consult = consultBrain(STATE, BOT, DIFFICULTY_BUDGETS.medium);
        await vi.advanceTimersByTimeAsync(BOT_CONSULT_EVERY_MS);
        bot.push((await consult).outcome);
    }
    await judging;
    return { judge, bot };
}

describe("a timed-out consult leaves no backlog in the Worker (issue #9514)", () => {
    it("reproduces the field's judge tally: one disposed consult, then timeouts", async () => {
        const { judge } = await bo3GameOneToGameTwo();
        expect(judge[0]).toBe("worker-error");
        expect(judge.slice(1).every((o) => o === "timeout")).toBe(true);
    });

    it("answers every Game 2 Bot consult while the Game 1 judge runs and after", async () => {
        const { bot } = await bo3GameOneToGameTwo();
        expect(bot.filter((o) => o !== "move")).toEqual([]);
    });
});
