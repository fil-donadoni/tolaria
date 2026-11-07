import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
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
            const r = runBounded(
                "sh",
                ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
                { timeoutMs: 500 }
            );
            expect(r.timedOut).toBe(true);
            expect(r.status).toBeNull();
            expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
        } finally {
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        }
    }, 30_000);

    it("`inherit` hands the command the caller's stdio and still kills the tree", () => {
        const dir = mkdtempSync(join(tmpdir(), "tolaria-bounded-"));
        const pidFile = join(dir, "grandchild");
        try {
            const r = runBounded(
                "sh",
                [
                    "-c",
                    `sleep 300 >/dev/null 2>&1 & echo $! > ${pidFile}; wait`,
                ],
                { timeoutMs: 500, stdio: "inherit" }
            );
            expect(r.timedOut).toBe(true);
            expect(r.stdout).toBe("");
            expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
        } finally {
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
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
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
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

    // Bun is the runtime `pr-refresh` runs under, and its `spawnSync` ignores
    // `detached`: vitest (Node) alone would have passed with the tree-kill dead.
    it("kills the tree under Bun too", () => {
        const dir = mkdtempSync(join(tmpdir(), "tolaria-bounded-"));
        const pidFile = join(dir, "grandchild");
        try {
            const lib = join(__dirname, "../lib/process-tree.ts");
            const script = `import { runBounded } from ${JSON.stringify(lib)};
const r = runBounded("sh", ["-c", "sleep 300 & echo $! > ${pidFile}; wait"], { timeoutMs: 500 });
console.log(JSON.stringify({ timedOut: r.timedOut }));`;
            const out = spawnSync("bun", ["-e", script], {
                encoding: "utf8",
                timeout: 60_000,
            });
            expect(out.stdout.trim()).toBe('{"timedOut":true}');
            expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
        } finally {
            rmSync(dir, {
                recursive: true,
                force: true,
                maxRetries: 10,
                retryDelay: 100,
            });
        }
    }, 90_000);
});
