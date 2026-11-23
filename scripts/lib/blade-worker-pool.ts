/**
 * The process pool behind the blade's pooled runs (`blade:census`,
 * `blade:probe`): `n` vitest processes of one env-gated worker spec, each
 * claiming jobs from a shared work directory (`workClaims.helper.ts`), one
 * vitest worker per process. Each process's output lands in
 * `<dir>/worker-<k>.log`.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function runWorker(
    spec: string,
    dirEnv: string,
    dir: string,
    k: number
): Promise<number> {
    return new Promise((done) => {
        const log = join(dir, `worker-${k}.log`);
        const child = spawn(
            "bunx",
            ["vitest", "run", "--config", "vitest.blade.config.ts", spec],
            {
                env: {
                    ...process.env,
                    [dirEnv]: dir,
                    // One vitest worker per process: the pool is the processes.
                    TOLARIA_VITEST_WORKERS: "1",
                },
                stdio: ["ignore", "pipe", "pipe"],
            }
        );
        const chunks: Buffer[] = [];
        child.stdout.on("data", (c: Buffer) => chunks.push(c));
        child.stderr.on("data", (c: Buffer) => chunks.push(c));
        child.on("close", (code) => {
            writeFileSync(log, Buffer.concat(chunks));
            done(code ?? 1);
        });
    });
}

/** Run `workers` processes of `spec` with `dirEnv=<dir>`; their exit codes. */
export function runBladeWorkerPool(
    spec: string,
    dirEnv: string,
    dir: string,
    workers: number
): Promise<number[]> {
    return Promise.all(
        Array.from({ length: workers }, (_, k) =>
            runWorker(spec, dirEnv, dir, k)
        )
    );
}

/** The last lines of each crashed worker's log (or worker 0's when none
 *  crashed but the run is unusable), for the failure message. */
export function crashedWorkerTails(dir: string, codes: number[]): string {
    const crashed = codes.map((c, k) => ({ c, k })).filter(({ c }) => c !== 0);
    return (crashed.length ? crashed : [{ c: codes[0], k: 0 }])
        .map(({ c, k }) => {
            const log = join(dir, `worker-${k}.log`);
            const tail = existsSync(log)
                ? readFileSync(log, "utf8").split("\n").slice(-30).join("\n")
                : "(no log)";
            return `--- worker ${k} (exit ${c}) ---\n${tail}`;
        })
        .join("\n");
}
