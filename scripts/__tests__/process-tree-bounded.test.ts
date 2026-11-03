import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBounded } from "../lib/process-tree";

const alive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

describe("runBounded — a spawn that cannot outlive its deadline (issue #7937)", () => {
    it("kills the whole tree of a command that never exits", () => {
        const dir = mkdtempSync(join(tmpdir(), "tolaria-bounded-"));
        const pidFile = join(dir, "grandchild");
        try {
            const t0 = Date.now();
            const r = runBounded(
                "sh",
                ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
                { timeoutMs: 500 }
            );
            expect(r.timedOut).toBe(true);
            expect(r.status).toBeNull();
            expect(Date.now() - t0).toBeLessThan(15_000);
            expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);

    it("kills what a finished command left running", () => {
        const dir = mkdtempSync(join(tmpdir(), "tolaria-bounded-"));
        const pidFile = join(dir, "straggler");
        try {
            const r = runBounded(
                "sh",
                ["-c", `sleep 300 >/dev/null 2>&1 & echo $! > ${pidFile}`],
                { timeoutMs: 10_000, stdio: "ignore" }
            );
            expect(r.timedOut).toBe(false);
            expect(r.status).toBe(0);
            expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);

    it("returns the real exit status and output of a command in time", () => {
        const r = runBounded("sh", ["-c", "echo out; echo err >&2; exit 3"], {
            timeoutMs: 10_000,
        });
        expect(r).toMatchObject({
            status: 3,
            stdout: "out\n",
            stderr: "err\n",
            timedOut: false,
        });
    });
});
