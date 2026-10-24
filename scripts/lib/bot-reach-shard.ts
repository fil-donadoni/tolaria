/**
 * The Bot-play sweep sharded over worker threads (issue #6686, ADR 0158 § 1).
 *
 * `playBotReach` is pure, seeded and `iterations`-bounded: a card's verdict
 * does not depend on which thread plays it, or in what order. So the sweep
 * plays its definition misses over `W` workers pulling small batches off one
 * queue (a card's cost varies by two orders of magnitude, so a static split
 * would leave a worker idle behind the slow tail), and hands back a map keyed
 * by oracle id. The map's iteration order is never read: `buildLockfile`
 * walks the corpus, so the lockfile bytes are the same for any `W`.
 *
 * A worker that dies — a throw outside the player's own catch, an OOM, an
 * exit — is the sweep's `harness-error` for the batch it held, never a lost
 * run. With every worker dead, what is left of the queue is `harness-error`
 * too: a verdict per card, and the lockfile is still written.
 */
import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import type { BotReachVerdict } from "../../convex/gre/ai/botReach";
import { harnessErrorVerdict } from "./bot-reach-player";
import type { CompiledDefinition } from "../../convex/oracle/types";
import type { BotPlayer } from "./oracle-bot-reach";

export interface WorkerRequest {
    readonly batch: ReadonlyArray<readonly [string, CompiledDefinition]>;
}
export type WorkerResponse =
    | {
          readonly results: ReadonlyArray<readonly [string, BotReachVerdict]>;
      }
    | { readonly error: string };

/** Cards per message: big enough that the round trip is noise against a
 *  ~0.36 s play, small enough that the slowest batch is a few seconds. */
export const SWEEP_BATCH = 8;
/** A worker is only spawned for this many misses at least: each loads the
 *  Bot (seconds) before its first play. */
export const MIN_MISSES_PER_WORKER = 16;
/** A batch is ~3 s of play; one that is silent this long is a wedged worker
 *  (a hung import, a busy loop) — `harness-error`, not a sweep that never
 *  ends. */
export const BATCH_TIMEOUT_MS = 10 * 60 * 1000;

/** The player module a worker loads: exports `createBotPlayer`. */
export const DEFAULT_PLAYER_MODULE = new URL(
    "./bot-reach-player.ts",
    import.meta.url
).href;
const WORKER_ENTRY = new URL("./bot-reach-worker.ts", import.meta.url);

/**
 * `W`: `TOLARIA_SWEEP_WORKERS` when set; else the heavy tier's count the gate
 * exports (`TOLARIA_VITEST_WORKERS` under a hold); else `min(ncpu - 1, 4)` —
 * the heavy tier's own formula, RAM-capped (`scripts/gate.ts`). Pure.
 */
export function sweepWorkerCount(
    env: NodeJS.ProcessEnv,
    ncpu: number = availableParallelism()
): number {
    const fromEnv = (name: string): number | null => {
        const n = Number(env[name]);
        return Number.isInteger(n) && n >= 1 ? n : null;
    };
    return (
        fromEnv("TOLARIA_SWEEP_WORKERS") ??
        (env.TOLARIA_GATE_HELD === "1"
            ? fromEnv("TOLARIA_VITEST_WORKERS")
            : null) ??
        Math.max(1, Math.min(ncpu - 1, 4))
    );
}

export interface ShardOptions {
    /** Requested worker count; fewer are spawned for a small miss set. */
    readonly workers: number;
    /** Told about every card as its verdict arrives, for progress output. */
    readonly onPlay?: (oracleId: string) => void;
    /** Module exporting `createBotPlayer`; a test points it at a fake. */
    readonly playerModule?: string;
}

/**
 * Plays every miss and returns `oracleId → verdict`. One effective worker
 * plays in this thread, with no spawn.
 */
export async function playMisses(
    misses: ReadonlyMap<string, CompiledDefinition>,
    options: ShardOptions
): Promise<Map<string, BotReachVerdict>> {
    const playerModule = options.playerModule ?? DEFAULT_PLAYER_MODULE;
    // Dispatch in id order: the queue is the same for every `W`.
    const queue = [...misses].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const verdicts = new Map<string, BotReachVerdict>();
    const width = Math.min(
        options.workers,
        Math.ceil(queue.length / MIN_MISSES_PER_WORKER)
    );
    if (queue.length === 0) return verdicts;
    if (width <= 1) {
        // The same guarantees as a worker's: a Bot that will not load, or a
        // throw past the player, is `harness-error`, never a lost run.
        let play: BotPlayer | null = null;
        let loadError: unknown = null;
        try {
            play = await (await import(playerModule)).createBotPlayer();
        } catch (error) {
            loadError = error;
        }
        for (const [id, definition] of queue) {
            try {
                if (play === null) throw loadError;
                verdicts.set(id, play(id, definition));
            } catch (error) {
                verdicts.set(id, harnessErrorVerdict(error));
            }
            options.onPlay?.(id);
        }
        return verdicts;
    }

    let next = 0;
    const take = (): WorkerRequest["batch"] => {
        const batch = queue.slice(next, next + SWEEP_BATCH);
        next += batch.length;
        return batch;
    };
    const fail = (batch: WorkerRequest["batch"], why: string) => {
        for (const [id] of batch) {
            verdicts.set(id, harnessErrorVerdict(`sweep worker: ${why}`));
            options.onPlay?.(id);
        }
    };

    await Promise.all(
        Array.from(
            { length: width },
            () =>
                new Promise<void>((done) => {
                    const worker = new Worker(WORKER_ENTRY, {
                        workerData: { playerModule },
                    });
                    let inFlight: WorkerRequest["batch"] = [];
                    let settled = false;
                    let watchdog: ReturnType<typeof setTimeout> | undefined;
                    const settle = (why?: string) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(watchdog);
                        if (why !== undefined) fail(inFlight, why);
                        inFlight = [];
                        void worker.terminate();
                        // The last worker standing leaves nothing queued.
                        done();
                    };
                    const dispatch = () => {
                        clearTimeout(watchdog);
                        inFlight = take();
                        if (inFlight.length === 0) return settle();
                        watchdog = setTimeout(
                            () => settle("no answer within the batch timeout"),
                            BATCH_TIMEOUT_MS
                        );
                        worker.postMessage({
                            batch: inFlight,
                        } satisfies WorkerRequest);
                    };
                    worker.on("message", (response: WorkerResponse) => {
                        if ("error" in response) fail(inFlight, response.error);
                        else
                            for (const [id, verdict] of response.results) {
                                verdicts.set(id, verdict);
                                options.onPlay?.(id);
                            }
                        inFlight = [];
                        dispatch();
                    });
                    worker.on("error", (error) => settle(error.message));
                    worker.on("exit", (code) =>
                        settle(`exited with code ${code}`)
                    );
                    dispatch();
                })
        )
    );
    // Every worker dead before the queue drained: nothing may stay unplayed.
    fail(queue.slice(next), "no worker left");
    next = queue.length;
    return verdicts;
}
