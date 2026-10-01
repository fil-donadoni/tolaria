import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import {
    instanceOf,
    isBackend,
    isConvexDev,
    reportStrays,
    type ProcessRow,
} from "../convex-ensure";
import { localInstanceName } from "../lib/convex-reachable";

// `convex:ensure` (issue #4945) is driven here as the loop drives it — a real
// `bun scripts/convex-ensure.ts` process — against a stub HTTP server on a
// free port and a stub start command, never the real deployment. Every child
// is async `spawn` with a kill timer: a `spawnSync` that blocks cannot be
// interrupted by the test timeout.
vi.setConfig({ testTimeout: 40_000 });

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "convex-ensure.ts");

/** A server that appends its pid to `counter` the moment it starts, then
 *  listens on `port` after `delayMs` — the stand-in for `convex dev --local`,
 *  which takes a while before the URL answers. */
const STUB_SERVER = `
const http = require("http");
const fs = require("fs");
const [port, counter, delayMs] = process.argv.slice(2);
fs.appendFileSync(counter, process.pid + "\\n");
console.log("stub backend starting");
setTimeout(() => {
    http.createServer((_q, s) => s.end("ok")).listen(+port, "127.0.0.1");
}, +delayMs);
`;

let tmp: string;
let telemetry: string;
let counter: string;
let serverScript: string;
const children: ChildProcess[] = [];
const servers: http.Server[] = [];

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-convex-ensure-"));
    telemetry = path.join(tmp, "telemetry");
    counter = path.join(tmp, "starts");
    serverScript = path.join(tmp, "stub-server.cjs");
    fs.writeFileSync(serverScript, STUB_SERVER);
});

afterEach(async () => {
    // Every stub backend the ensure started recorded its pid; each runs in
    // its own process group (detached), so kill the group.
    if (fs.existsSync(counter)) {
        for (const pid of fs.readFileSync(counter, "utf8").split("\n")) {
            if (!pid.trim()) continue;
            try {
                process.kill(-Number(pid), "SIGKILL");
            } catch {
                /* already gone */
            }
        }
    }
    for (const c of children.splice(0)) c.kill("SIGKILL");
    await Promise.all(
        servers.splice(0).map((s) => new Promise((r) => s.close(r)))
    );
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const port = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(port));
        });
    });
}

async function answers(url: string): Promise<boolean> {
    try {
        await fetch(url, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
}

function ensure(args: string[]): Promise<Run> {
    return new Promise((resolve) => {
        const p = spawn(
            "bun",
            [SCRIPT, "--root", tmp, "--telemetry-dir", telemetry, ...args],
            {
                cwd: tmp,
                stdio: ["ignore", "pipe", "pipe"],
            }
        );
        let stdout = "";
        let stderr = "";
        p.stdout.on("data", (d) => (stdout += d));
        p.stderr.on("data", (d) => (stderr += d));
        const t = setTimeout(() => p.kill("SIGKILL"), 35_000);
        p.on("close", (code) => {
            clearTimeout(t);
            resolve({ code, stdout, stderr });
        });
    });
}

const starts = (): number =>
    fs.existsSync(counter)
        ? fs.readFileSync(counter, "utf8").split("\n").filter(Boolean).length
        : 0;

const stubStart = (port: number, delayMs: number): string =>
    JSON.stringify([
        process.execPath,
        serverScript,
        String(port),
        counter,
        String(delayMs),
    ]);

describe("convex:ensure — the backend is down", () => {
    it("starts exactly one, the URL then answers, and a concurrent second caller neither starts another nor fails", async () => {
        const port = await freePort();
        const url = `http://127.0.0.1:${port}`;
        const args = [
            "--url",
            url,
            "--instance-name",
            `test-none-${process.pid}-${port}`,
            "--start-cmd",
            stubStart(port, 1500),
            "--start-timeout-ms",
            "20000",
        ];
        const [a, b] = await Promise.all([ensure(args), ensure(args)]);
        expect([a.code, b.code]).toEqual([0, 0]);
        expect(starts()).toBe(1);
        expect(await answers(url)).toBe(true);
        expect([a.stdout, b.stdout].join("\n")).toMatch(/started pid \d+/);
        expect([a.stdout, b.stdout].join("\n")).toMatch(
            /answers — nothing started/
        );
        const pidFile = JSON.parse(
            fs.readFileSync(path.join(telemetry, "convex-dev.pid"), "utf8")
        ) as { pid: number; stamp: string };
        expect(pidFile.pid).toBeGreaterThan(0);
        expect(pidFile.stamp).not.toBe("");
        expect(
            fs.readFileSync(path.join(telemetry, "convex-dev.log"), "utf8")
        ).toMatch(/stub backend starting/);
        expect(fs.existsSync(path.join(telemetry, "convex-ensure.lock"))).toBe(
            false
        );
    });

    it("breaks a stale lock left by a dead owner", async () => {
        const port = await freePort();
        fs.mkdirSync(telemetry, { recursive: true });
        // A pid that cannot be alive: past the macOS/Linux pid ceiling.
        fs.writeFileSync(
            path.join(telemetry, "convex-ensure.lock"),
            JSON.stringify({
                pid: 99_999_999,
                stamp: "Thu Jan  1 00:00:00 1970",
            })
        );
        const r = await ensure([
            "--url",
            `http://127.0.0.1:${port}`,
            "--instance-name",
            `test-none-${process.pid}-${port}`,
            "--start-cmd",
            stubStart(port, 200),
            "--start-timeout-ms",
            "15000",
        ]);
        expect(r.code).toBe(0);
        expect(starts()).toBe(1);
    });

    it("fails non-zero with the log tail when the start command never makes the URL answer", async () => {
        const port = await freePort();
        const r = await ensure([
            "--url",
            `http://127.0.0.1:${port}`,
            "--instance-name",
            `test-none-${process.pid}-${port}`,
            "--start-cmd",
            // The output is assembled at run time so it never appears in the
            // argv the failure line also quotes: only the log tail carries it.
            JSON.stringify([
                "sh",
                "-c",
                "printf 'kab%s\\n' oom-from-the-log; exit 3",
            ]),
            "--start-timeout-ms",
            "3000",
        ]);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/FAILED/);
        expect(r.stderr).toMatch(/exited/);
        expect(r.stderr).toMatch(/kaboom-from-the-log/);
    });
});

describe("convex:ensure — the backend answers", () => {
    it("spawns nothing", async () => {
        const port = await freePort();
        const srv = http.createServer((_q, s) => s.end("ok"));
        servers.push(srv);
        await new Promise<void>((r) => srv.listen(port, "127.0.0.1", r));
        const r = await ensure([
            "--url",
            `http://127.0.0.1:${port}`,
            "--start-cmd",
            stubStart(port, 0),
        ]);
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/answers — nothing started/);
        expect(starts()).toBe(0);
        expect(fs.existsSync(path.join(telemetry, "convex-dev.pid"))).toBe(
            false
        );
    });
});

describe("convex:ensure — a backend for this instance is alive but not answering", () => {
    it("waits, then fails without starting a second", async () => {
        const port = await freePort();
        const instance = `test-wedged-${process.pid}-${port}`;
        // A real process whose command line reads as this deployment's
        // backend, listening on nothing.
        const wedged = spawn(
            process.execPath,
            [
                "-e",
                "setInterval(() => {}, 1000)",
                "convex-local-backend",
                "--instance-name",
                instance,
            ],
            { stdio: "ignore" }
        );
        children.push(wedged);
        await new Promise((r) => wedged.once("spawn", r));
        const r = await ensure([
            "--url",
            `http://127.0.0.1:${port}`,
            "--instance-name",
            instance,
            "--start-cmd",
            stubStart(port, 0),
            "--wait-alive-ms",
            "1500",
        ]);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(
            new RegExp(
                `backend pid ${wedged.pid} for ${instance} is alive but never answered`
            )
        );
        expect(starts()).toBe(0);
    });
});

describe("process classification", () => {
    const BACKEND =
        "/Users/x/.cache/convex/binaries/precompiled-2026-09-28-5c7cb5b/convex-local-backend --port 3210 --site-proxy-port 3211 --instance-name local-fil_5815a-tolaria --instance-secret abc";
    const DEV =
        "node /Users/x/code/tolaria/node_modules/convex/bin/main.js dev --local";

    it("reads the instance off a real backend command line", () => {
        expect(isBackend(BACKEND)).toBe(true);
        expect(instanceOf(BACKEND)).toBe("local-fil_5815a-tolaria");
        expect(
            isBackend("bun scripts/convex-ensure.ts --instance-name x")
        ).toBe(false);
    });

    it("recognises convex dev, not convex:ensure", () => {
        expect(isConvexDev(DEV)).toBe(true);
        expect(isConvexDev("bunx convex dev --local")).toBe(true);
        expect(isConvexDev("bun scripts/convex-ensure.ts")).toBe(false);
    });

    it("takes the instance from CONVEX_DEPLOYMENT, comment and all", () => {
        expect(
            localInstanceName("local:local-fil_5815a-tolaria # team: fil-5815a")
        ).toBe("local-fil_5815a-tolaria");
        expect(localInstanceName("dev:happy-otter-123")).toBeNull();
        expect(localInstanceName(undefined)).toBeNull();
    });

    it("reports a foreign deployment and an orphaned backend of ours, never this checkout's convex dev", () => {
        const rows: ProcessRow[] = [
            { pid: 10, ppid: 1, args: BACKEND },
            {
                pid: 20,
                ppid: 1,
                args: DEV.replace("/Users/x/code/tolaria", "/spike"),
            },
            {
                pid: 21,
                ppid: 20,
                args: BACKEND.replace("local-fil_5815a-tolaria", "spike-other"),
            },
            { pid: 30, ppid: 1, args: DEV },
        ];
        const cwd: Record<number, string> = {
            20: "/spike",
            21: "/spike/.convex",
            30: "/repo",
        };
        const lines: string[] = [];
        reportStrays(
            rows,
            {
                root: "/repo",
                instanceName: "local-fil_5815a-tolaria",
                log: (l) => lines.push(l),
            },
            (pid) => cwd[pid] ?? null
        );
        expect(lines).toHaveLength(3);
        expect(lines[0]).toMatch(
            /backend pid 10 .* has no `convex dev` parent/
        );
        expect(lines[1]).toMatch(/pid 20 \(convex dev, cwd \/spike\)/);
        expect(lines[2]).toMatch(/pid 21 \(backend spike-other/);
        expect(lines.join("\n")).not.toMatch(/pid 30/);
    });
});
