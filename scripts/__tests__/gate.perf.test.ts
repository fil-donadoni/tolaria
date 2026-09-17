import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The heavy-tier heartbeat, end to end against REAL CPU (issue #3792).
 *
 * These are the liveness assertions that used to be gated in `gate.test.ts`.
 * Their verdict depends on the machine: a burner the scheduler starves for
 * STALL_BEATS beats burns no measurable CPU (`ps` ticks at 10ms), the gate
 * correctly says STALLED, and the test goes red on a diff that never touched
 * `gate.ts`. Behind the durable RED marker a false red is expensive, so the
 * DECISION is asserted pure in `gate.test.ts` and these live in the never-gated
 * `perf` project (issue #3123) — run them by hand with `bun run test:perf` when
 * changing how `gate.ts` samples its subtree, on a quiet machine.
 */
const GATE = resolve(__dirname, "..", "gate.ts");

let lockRoot: string;

function env(extra: Record<string, string>) {
    const base = { ...process.env, TOLARIA_GATE_LOCK_ROOT: lockRoot };
    delete base.TOLARIA_GATE_HELD;
    delete base.TOLARIA_ALLOW_FULL_SUITE;
    delete base.TOLARIA_VITEST_WORKERS;
    delete base.TOLARIA_HEAVY_WORKERS_CAP;
    return { ...base, ...extra };
}

const burn = (seconds: number) =>
    `end=$(( $(date +%s) + ${seconds} )); while [ $(date +%s) -lt $end ]; do :; done`;

/** Run a heavy hold to completion; its exit code, stdout and stderr. */
async function hold(command: string, extra: Record<string, string>) {
    const child = spawn("bun", [GATE, "heavy", command], {
        cwd: lockRoot,
        env: env(extra),
        stdio: ["ignore", "pipe", "pipe"],
    } as never);
    let out = "";
    let err = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    const code = await new Promise<number>((r) =>
        child.on("exit", (c) => r(c ?? 1))
    );
    return { code, out, err };
}

beforeEach(() => {
    lockRoot = mkdtempSync(join(tmpdir(), "tolaria-gate-perf-"));
});

afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
});

describe("gate.ts — heartbeat against real CPU (perf, never gated)", () => {
    it("a holder that burns CPU is never declared STALLED (issue #1924)", async () => {
        const r = await hold(`${burn(6)}; echo BURNED`, {
            TOLARIA_GATE_HEARTBEAT_MS: "400",
            TOLARIA_GATE_STALL_BEATS: "3",
        });
        expect(r.code, r.err).toBe(0);
        expect(r.out).toContain("BURNED");
        expect(r.err).not.toContain("STALLED");
    }, 30_000);

    it("survives a phase turnover — a heavy parallel phase exiting is not a stall", async () => {
        // Four burners push the live snapshot to ~8 CPU-seconds, exit, and the
        // single tail cannot climb back past that peak within its lifetime —
        // without the monotonic total every remaining beat reads silent.
        const r = await hold(
            `for i in $(seq 1 4); do ( ${burn(2)} ) & done; wait; ${burn(5)}; echo PHASES-DONE`,
            {
                TOLARIA_GATE_HEARTBEAT_MS: "400",
                TOLARIA_GATE_STALL_BEATS: "3",
            }
        );
        expect(r.code, r.err).toBe(0);
        expect(r.out).toContain("PHASES-DONE");
        expect(r.err).not.toContain("STALLED");
    }, 30_000);
});
