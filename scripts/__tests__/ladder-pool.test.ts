import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    partitionRoundRobin,
    runWorkerPool,
    type WorkerResult,
} from "../lib/ladder/pool";
import type { LadderGamePlan } from "../lib/ladder/plan";

/**
 * Ladder worker pool — partitioning (issue #2681). `partitionRoundRobin` is
 * the pure piece of the parallel dispatch: given N workers it decides which
 * games go to which process. Pinned here so the split stays deterministic
 * and every task is assigned to exactly one bucket.
 */

describe("partitionRoundRobin", () => {
    it("covers every item exactly once, round-robin by index", () => {
        const items = Array.from({ length: 10 }, (_, i) => i);
        const buckets = partitionRoundRobin(items, 3);
        expect(buckets.length).toBe(3);
        expect(buckets[0]).toEqual([0, 3, 6, 9]);
        expect(buckets[1]).toEqual([1, 4, 7]);
        expect(buckets[2]).toEqual([2, 5, 8]);
        expect(buckets.flat().length).toBe(items.length);
        expect(new Set(buckets.flat())).toEqual(new Set(items));
    });

    it("n=1 keeps everything in a single bucket, original order", () => {
        const items = ["a", "b", "c"];
        expect(partitionRoundRobin(items, 1)).toEqual([["a", "b", "c"]]);
    });

    it("n greater than item count leaves trailing buckets empty", () => {
        const items = [1, 2];
        const buckets = partitionRoundRobin(items, 5);
        expect(buckets.length).toBe(5);
        expect(buckets[0]).toEqual([1]);
        expect(buckets[1]).toEqual([2]);
        expect(buckets.slice(2).every((b) => b.length === 0)).toBe(true);
    });

    it("preserves item identity (never clones/reorders within a bucket)", () => {
        const a = { id: 1 };
        const b = { id: 2 };
        const buckets = partitionRoundRobin([a, b], 2);
        expect(buckets[0][0]).toBe(a);
        expect(buckets[1][0]).toBe(b);
    });
});

/**
 * runWorkerPool — malformed stdout line handling (#2681 fixup). A worker
 * emitting one non-JSON line must fail the WHOLE run loudly, never resolve
 * as if it had finished cleanly with the remaining games in that chunk
 * silently dropped. `workerScript` is deliberately injectable (pool.ts
 * header comment) precisely so this is testable without the real engine —
 * a tiny fake worker plays the same NDJSON protocol as the real one.
 */
describe("runWorkerPool: malformed worker output", () => {
    let tmpDir: string | undefined;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
    });

    function makeTask(gameIndex: number, seed: number): LadderGamePlan {
        return {
            gameIndex,
            pairingIndex: 0,
            seedIndex: 0,
            orientation: 0,
            deckSeat0: "mono-red-burn",
            deckSeat1: "white-weenie",
            seed,
            candidateSeat: "S1",
        };
    }

    /** A fake worker: echoes a well-formed WorkerResult for every task EXCEPT
     *  the one whose seed is 999, for which it writes a plain non-JSON line —
     *  the exact shape a corrupted/partial stdout write would take. */
    function writeFakeWorker(): string {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ladder-pool-test-"));
        const scriptPath = path.join(tmpDir, "fake-worker.ts");
        fs.writeFileSync(
            scriptPath,
            `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
    if (!line.trim()) return;
    const task = JSON.parse(line);
    if (task.seed === 999) {
        process.stdout.write("not-json-at-all\\n");
        return;
    }
    process.stdout.write(JSON.stringify({
        gameIndex: task.gameIndex,
        pairingIndex: task.pairingIndex,
        seedIndex: task.seedIndex,
        orientation: task.orientation,
        deckSeat0: task.deckSeat0,
        deckSeat1: task.deckSeat1,
        seed: task.seed,
        candidateSeat: task.candidateSeat,
        winnerSeat: null,
        candidateWon: null,
        reason: "test",
        turns: 0,
        plies: 0,
        ms: 0,
    }) + "\\n");
});
`,
            "utf8"
        );
        return scriptPath;
    }

    it("rejects loudly instead of resolving when a worker emits a malformed line", async () => {
        const workerScript = writeFakeWorker();
        const tasks = [makeTask(0, 1), makeTask(1, 999), makeTask(2, 2)];
        const results: WorkerResult[] = [];

        await expect(
            runWorkerPool({
                tasks,
                workers: 1,
                variant: null,
                iterations: 1,
                workerScript,
                onResult: (r) => results.push(r),
            })
        ).rejects.toThrow(/malformed/);

        // The good result that arrived BEFORE the bad line is still reported
        // (it was already safely handed to onResult) — what must NOT happen
        // is the run resolving as if it had completed normally.
        expect(results.map((r) => r.gameIndex)).toEqual([0]);
    });
});
