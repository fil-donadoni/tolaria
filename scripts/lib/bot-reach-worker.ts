/**
 * One sweep worker (issue #6686, ADR 0158 § 1): receives batches of
 * `[oracleId, definition]`, plays each with the same player the in-process
 * sweep uses, answers `[oracleId, verdict]` pairs. It holds no state between
 * cards but the registry `preloadDefinitions` fills — a play is pure, seeded
 * and `iterations`-bounded, so which worker plays a card never shows in the
 * verdict.
 */
import { parentPort, workerData } from "node:worker_threads";
import type { WorkerRequest, WorkerResponse } from "./bot-reach-shard";
import type { BotPlayer } from "./oracle-bot-reach";

const port = parentPort;
if (port === null) throw new Error("bot-reach-worker: not a worker thread");

const playerModule: string = (workerData as { playerModule: string })
    .playerModule;
const ready: Promise<BotPlayer> = import(playerModule).then(
    (m: { createBotPlayer: () => Promise<BotPlayer> }) => m.createBotPlayer()
);

port.on("message", async (request: WorkerRequest) => {
    try {
        const play = await ready;
        const results = request.batch.map(
            ([oracleId, definition]) =>
                [oracleId, play(oracleId, definition)] as const
        );
        port.postMessage({ results } satisfies WorkerResponse);
    } catch (error) {
        // A throw outside the player's own catch: the batch is the sweep's
        // `harness-error`, the worker stays up for the next one.
        port.postMessage({
            error: error instanceof Error ? error.message : String(error),
        } satisfies WorkerResponse);
    }
});
