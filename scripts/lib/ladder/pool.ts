// Ladder worker pool (issue #2681) — parallel game execution across OS
// PROCESSES, never same-process concurrency.
//
// Why processes: `playLadderGame`'s one cross-call seam is a module-level
// cell (`setSearchVariant` in convex/gre/ai/searchVariant.ts, install →
// search → clear in a `finally`). Two games interleaved in the SAME process
// (e.g. via Promise.all over an async search, or worker_threads sharing a
// module registry per thread but not per process boundary guarantees here)
// could race that cell. Separate `bun` child processes each get their own
// fresh module instance, so the seam — and the other per-call-scoped module
// state noted in issue #2681 (choiceCandidates memo, dominance begin/end
// scoping, choicePriors) — never crosses a process boundary. This module
// only spawns and talks NDJSON to worker.ts; it holds no engine state itself.
//
// Design: one writer. Each worker plays its assigned SLICE of the plan and
// streams one JSON result line per finished game to stdout as soon as it
// completes (never buffered) — the parent is the ONLY thing that appends to
// the run file, so the "concurrent appendFileSync of whole lines is not
// atomic" hazard (plan.ts header comment) never arises. Partitioning is
// static round-robin, decided up front — no dynamic work-stealing — which
// keeps the split trivially deterministic and testable.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { LadderGamePlan, LadderGameRecord } from "./plan";

/** Split `items` into `n` buckets by round-robin index — bucket `w` gets
 *  `items[i]` for every `i` with `i % n === w`. Pure; used by the pool AND
 *  unit-tested on its own (no process spawning needed to pin this part). */
export function partitionRoundRobin<T>(items: readonly T[], n: number): T[][] {
    const count = Math.max(1, Math.floor(n));
    const buckets: T[][] = Array.from({ length: count }, () => []);
    items.forEach((item, i) => buckets[i % count].push(item));
    return buckets;
}

/** One completed game as reported by a worker over stdout — everything a
 *  `LadderGameRecord` needs except `kind`, which the parent (the sole
 *  writer) attaches when it appends the line. */
export type WorkerResult = Omit<LadderGameRecord, "kind">;

export type RunWorkerPoolOptions = {
    tasks: LadderGamePlan[];
    workers: number;
    /** LADDER_VARIANTS key, or null for the control-vs-control null run. */
    variant: string | null;
    iterations: number;
    /** Absolute path to worker.ts — injectable so tests can point at a fake
     *  worker without touching the real engine. */
    workerScript: string;
    onResult: (result: WorkerResult) => void;
};

/** Run `tasks` across up to `workers` worker processes and call `onResult`
 *  for each finished game AS IT ARRIVES (so the caller can append + print a
 *  live line immediately, same contract as the sequential loop). Resolves
 *  once every worker has exited; rejects with an AggregateError-like summary
 *  if any worker exited non-zero — the OTHER workers are left to finish
 *  their assigned games first (no wasted work), so whatever they reported
 *  via onResult before the rejection is already safely appended and the run
 *  stays resumable. */
export async function runWorkerPool(opts: RunWorkerPoolOptions): Promise<void> {
    const { tasks, workers, variant, iterations, workerScript, onResult } =
        opts;
    if (tasks.length === 0) return;
    const n = Math.max(1, Math.min(Math.floor(workers), tasks.length));
    const buckets = partitionRoundRobin(tasks, n).filter((b) => b.length > 0);

    const results = await Promise.allSettled(
        buckets.map((bucket) =>
            runOneWorker(bucket, variant, iterations, workerScript, onResult)
        )
    );
    const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    if (failures.length > 0) {
        throw new Error(
            `${failures.length}/${buckets.length} ladder worker(s) failed:\n` +
                failures.map((f) => `  ${String(f.reason)}`).join("\n")
        );
    }
}

function runOneWorker(
    bucket: LadderGamePlan[],
    variant: string | null,
    iterations: number,
    workerScript: string,
    onResult: (result: WorkerResult) => void
): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(
            "bun",
            [
                workerScript,
                "--variant",
                variant ?? "__none__",
                "--iterations",
                String(iterations),
            ],
            { stdio: ["pipe", "pipe", "inherit"], env: process.env }
        );

        const rl = createInterface({ input: child.stdout! });
        rl.on("line", (line) => {
            if (!line.trim()) return;
            onResult(JSON.parse(line) as WorkerResult);
        });

        let spawnError: Error | null = null;
        child.on("error", (err) => {
            spawnError = err;
        });
        child.on("exit", (code, signal) => {
            rl.close();
            if (spawnError) reject(spawnError);
            else if (signal) reject(new Error(`worker killed by ${signal}`));
            else if (code !== 0)
                reject(new Error(`worker exited with code ${code}`));
            else resolvePromise();
        });

        for (const task of bucket) {
            child.stdin!.write(JSON.stringify(task) + "\n");
        }
        child.stdin!.end();
    });
}
