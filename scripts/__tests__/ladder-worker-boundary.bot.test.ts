import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkerPool, type WorkerResult } from "../lib/ladder/pool";
import { toGameRecordFields, type LadderGamePlan } from "../lib/ladder/plan";
import { playLadderGame } from "../../src/lib/ai/selfplay/ladder";

/**
 * Worker-process BOUNDARY contract (issue #1929). Every other ladder test
 * either exercises `playLadderGame` in-process or drives the pool with a FAKE
 * worker, so the real `scripts/lib/ladder/worker.ts` — the only path a
 * `--workers N` run ever takes, and therefore the only path any decision-tier
 * corpus is ever written by — was covered by nothing.
 *
 * What that blind spot cost: per-turn margin sampling (the calibration corpus
 * for the reward fit) was wired into the sequential loop's record literal and
 * NOT into the worker's. `LadderGameRecord.marginSamples` is optional, so
 * omitting it is type-CORRECT; the 680-game decision-tier run of 2026-08-23
 * wrote a corpus with the margins silently absent and reported success. The
 * in-process test asserting `outcome.marginSamples` was populated passed the
 * whole time — the field was produced, then dropped one process boundary
 * later.
 *
 * The standing assumption this refutes is recorded in
 * `src/lib/ai/selfplay/ladder.bot.test.ts`: that a worker process "changes
 * only WHICH OS process a game runs in", so proving the per-call seam
 * contract in-process licenses the parallel design. True of the seam; false
 * of the DATA — the boundary is also a re-serialisation, and a field can die
 * crossing it. Hence this test spawns the real thing.
 */

// `import.meta.dir` is a Bun extension and is undefined under vitest — derive
// the directory from the module URL instead.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(HERE, "..", "lib", "ladder", "worker.ts");

/** A tiny plan: one game, a tiny iteration budget. This is a contract test on
 *  the record that crosses the pipe, never a strength measurement. */
const PLAN: LadderGamePlan = {
    gameIndex: 0,
    pairingIndex: 0,
    seedIndex: 0,
    orientation: 0,
    deckSeat0: "mono-red-burn",
    deckSeat1: "white-weenie",
    seed: 11,
    candidateSeat: "S1",
};
const ITERATIONS = 6;

async function playViaWorker(): Promise<WorkerResult[]> {
    const out: WorkerResult[] = [];
    await runWorkerPool({
        tasks: [PLAN],
        workers: 1,
        variant: null,
        iterations: ITERATIONS,
        workerScript: WORKER_SCRIPT,
        onResult: (r) => out.push(r),
    });
    return out;
}

describe("ladder worker process boundary (issue #1929)", () => {
    it("carries the margin samples across the pipe", async () => {
        const [result] = await playViaWorker();
        expect(result).toBeDefined();
        expect(result.marginSamples).toBeDefined();
        expect(result.marginSamples!.length).toBeGreaterThan(0);
        for (const s of result.marginSamples!) {
            expect(Number.isFinite(s.margin)).toBe(true);
            expect(Number.isFinite(s.turn)).toBe(true);
        }
    }, 120_000);

    it("emits exactly what the in-process runner would have recorded", async () => {
        // The real invariant, of which the margin assertion above is one
        // instance: a game's record must not depend on WHICH dispatch path
        // played it. Comparing the whole object (minus the wall-clock `ms`,
        // which legitimately differs) means a FUTURE outcome field dropped at
        // this boundary fails here without anyone remembering to assert it.
        const [viaWorker] = await playViaWorker();
        const outcome = playLadderGame(
            {
                deckSeat0: PLAN.deckSeat0,
                deckSeat1: PLAN.deckSeat1,
                seed: PLAN.seed,
                candidateSeat: PLAN.candidateSeat,
                iterations: ITERATIONS,
            },
            null
        );
        const inProcess = toGameRecordFields(PLAN, outcome, 0);

        const { ms: _workerMs, ...workerFields } = viaWorker;
        const { ms: _localMs, ...localFields } = inProcess;
        expect(workerFields).toEqual(localFields);
    }, 120_000);
});
