// The sharded Bot-play sweep (issue #6686, ADR 0158 § 1). The pool runs under
// Bun (`node:worker_threads` loading a `.ts` entry), so the determinism test
// spawns a Bun driver instead of loading the pool into vitest's node.
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { sweepWorkerCount } from "../lib/bot-reach-shard";

const DRIVER = join(__dirname, "fixtures", "shard-driver.ts");

interface DriverOut {
    corpusOrder: [string, { outcome: string; cause?: string } | null][];
    arrivalOrder: string[];
}

function drive(
    workers: number,
    count: number,
    extra: string[] = [],
    env: NodeJS.ProcessEnv = {}
) {
    return new Promise<DriverOut>((resolve, reject) => {
        const child = spawn(
            "bun",
            [DRIVER, String(workers), String(count), ...extra],
            {
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, ...env },
            }
        );
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
        child.on("exit", (code, signal) => {
            clearTimeout(timer);
            if (code !== 0)
                return reject(new Error(`driver ${code}/${signal}: ${err}`));
            resolve(JSON.parse(out) as DriverOut);
        });
    });
}

describe("sweepWorkerCount", () => {
    it("takes the override first", () => {
        expect(
            sweepWorkerCount(
                {
                    TOLARIA_SWEEP_WORKERS: "3",
                    TOLARIA_GATE_HELD: "1",
                    TOLARIA_VITEST_WORKERS: "4",
                },
                16
            )
        ).toBe(3);
    });
    it("reads the heavy tier's count only under a hold", () => {
        const held = { TOLARIA_GATE_HELD: "1", TOLARIA_VITEST_WORKERS: "2" };
        expect(sweepWorkerCount(held, 16)).toBe(2);
        expect(sweepWorkerCount({ TOLARIA_VITEST_WORKERS: "2" }, 16)).toBe(4);
    });
    it("falls back to min(ncpu - 1, 4), never below 1", () => {
        expect(sweepWorkerCount({}, 16)).toBe(4);
        expect(sweepWorkerCount({}, 3)).toBe(2);
        expect(sweepWorkerCount({}, 1)).toBe(1);
    });
    it("ignores an unreadable override", () => {
        expect(sweepWorkerCount({ TOLARIA_SWEEP_WORKERS: "0" }, 16)).toBe(4);
        expect(sweepWorkerCount({ TOLARIA_SWEEP_WORKERS: "x" }, 16)).toBe(4);
    });
});

describe("the sharded sweep is deterministic across worker counts", () => {
    it("gives the same verdict per card for W = 1 and W = 4", async () => {
        const one = await drive(1, 96);
        const four = await drive(4, 96);
        expect(four.corpusOrder).toEqual(one.corpusOrder);
        expect(one.corpusOrder.every(([, v]) => v !== null)).toBe(true);
        // Not vacuous: results really arrive out of order under 4 workers,
        // so a lockfile built from the map's order would differ.
        expect(four.arrivalOrder).not.toEqual(one.arrivalOrder);
    }, 90_000);

    it("turns a throw past the player into harness-error for its batch, and plays the rest", async () => {
        const out = await drive(4, 96, ["throw-1"]);
        const verdicts = new Map(out.corpusOrder);
        expect(verdicts.get("throw-1")?.cause).toBe("harness-error");
        expect(out.corpusOrder.every(([, v]) => v !== null)).toBe(true);
        const played = out.corpusOrder.filter(
            ([, v]) => v?.cause !== "harness-error"
        );
        // Only the card that threw: a batch boundary never shows in a verdict.
        expect(
            out.corpusOrder.filter(([, v]) => v?.cause === "harness-error")
        ).toHaveLength(1);
        expect(played.length).toBe(96);
        const inProcess = await drive(1, 96, ["throw-1"]);
        expect(out.corpusOrder).toEqual(inProcess.corpusOrder);
    }, 90_000);

    it("turns a worker that cannot load the Bot into harness-error for every card, and still returns", async () => {
        const out = await drive(4, 96, [], {
            SHARD_PLAYER: "./failing-bot-player.ts",
        });
        expect(out.corpusOrder).toHaveLength(96);
        expect(
            out.corpusOrder.every(([, v]) => v?.cause === "harness-error")
        ).toBe(true);
    }, 90_000);
});
