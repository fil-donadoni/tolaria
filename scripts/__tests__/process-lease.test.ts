import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    judgeLease,
    parseEtime,
    type ProcessLease,
} from "../lib/process-lease";

// Process leases (issue #5470): the record every spawner writes so the active
// reaper can tell a live tree from an abandoned one. The reaper's DECISIONS
// are pinned in `reaper.test.ts` on a fake process table; this file pins the
// WRITERS — that each spawner's lease exists while it runs, carries the
// anchor it claims, tags what it spawns, and is cleared on exit — against
// real processes.

vi.setConfig({ testTimeout: 30_000 });

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LEASE_LIB = path.join(REPO_ROOT, "scripts", "lib", "process-lease.ts");

let tmp: string;
let leaseDir: string;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "process-lease-"));
    leaseDir = path.join(tmp, "leases");
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
    const e: NodeJS.ProcessEnv = {
        ...process.env,
        TOLARIA_LEASE_DIR: leaseDir,
    };
    delete e.TOLARIA_OWNER;
    return { ...e, ...extra };
};

const leases = (): ProcessLease[] =>
    fs.existsSync(leaseDir)
        ? fs
              .readdirSync(leaseDir)
              .filter((f) => f.endsWith(".json"))
              .map((f) =>
                  JSON.parse(fs.readFileSync(path.join(leaseDir, f), "utf8"))
              )
        : [];

/** Block (out of process) until `file` exists, up to 20 s. */
const waitForFile = (file: string): boolean =>
    spawnSync("sh", [
        "-c",
        `i=0; while [ ! -e "${file}" ] && [ $i -lt 200 ]; do sleep 0.1; i=$((i+1)); done; [ -e "${file}" ]`,
    ]).status === 0;

const lease = (p: Partial<ProcessLease> = {}): ProcessLease => ({
    id: "L",
    kind: "gate",
    pid: 10,
    pidStart: 1000,
    pgid: null,
    command: "x",
    cwd: "/wt",
    cwdMayVanish: false,
    parent: null,
    startedAt: 0,
    renewedAt: 0,
    deadline: 2_000_000,
    graceUntil: null,
    ...p,
});

describe("judgeLease", () => {
    const exists = () => true;
    it("is alive while its anchor runs with the recorded start, its deadline ahead and its cwd present", () => {
        expect(judgeLease(lease(), 1002, 1_000_000, exists)).toEqual({
            alive: true,
            why: "live",
        });
    });
    it("is dead on a gone anchor, a recycled pid, a passed deadline, or a removed cwd", () => {
        expect(judgeLease(lease(), null, 1_000_000, exists).alive).toBe(false);
        expect(judgeLease(lease(), 1100, 1_000_000, exists)).toMatchObject({
            alive: false,
            recycled: true,
        });
        expect(judgeLease(lease(), 1000, 3_000_000, exists).why).toMatch(
            /expired/
        );
        expect(judgeLease(lease(), 1000, 1_000_000, () => false).why).toMatch(
            /cwd \/wt no longer exists/
        );
        expect(
            judgeLease(
                lease({ cwdMayVanish: true }),
                1000,
                1_000_000,
                () => false
            ).alive
        ).toBe(true);
    });
    it("is spared through its grace window whatever else holds", () => {
        expect(
            judgeLease(
                lease({ graceUntil: 1_500_000 }),
                null,
                1_000_000,
                () => false
            )
        ).toEqual({ alive: true, why: "grace" });
    });
});

describe("parseEtime", () => {
    it("reads every ps etime shape", () => {
        expect(parseEtime("00:07")).toBe(7);
        expect(parseEtime("12:00:07")).toBe(43207);
        expect(parseEtime("3-00:00:01")).toBe(259201);
        expect(parseEtime("garbage")).toBeNull();
    });
});

describe("holdLease — the TS spawners' writer", () => {
    it("registers a lease anchored on the process, tags its children, and clears it on a normal exit", () => {
        const script = path.join(tmp, "holder.ts");
        const owner = path.join(tmp, "child-owner");
        const release = path.join(tmp, "release");
        fs.writeFileSync(
            script,
            `import { holdLease } from ${JSON.stringify(LEASE_LIB)};
             import { spawn } from "node:child_process";
             import { existsSync } from "node:fs";
             holdLease({ kind: "probe", ttlMs: 60_000 });
             // node's async spawn, default env — the shape the spawners use.
             spawn("sh", ["-c", 'echo "$TOLARIA_OWNER" > ${JSON.stringify(owner)}']);
             const t = setInterval(() => { if (existsSync(${JSON.stringify(release)})) { clearInterval(t); } }, 50);`
        );
        const child = spawn("bun", [script], { env: env(), stdio: "ignore" });
        expect(waitForFile(owner), "the holder never spawned").toBe(true);
        const [l] = leases();
        expect(l).toMatchObject({
            kind: "probe",
            pid: child.pid,
            parent: null,
            cwdMayVanish: false,
        });
        expect(Math.abs(l.pidStart - Date.now() / 1000)).toBeLessThan(30);
        expect(fs.readFileSync(owner, "utf8").trim()).toBe(l.id);
        fs.writeFileSync(release, "");
        return new Promise<void>((resolve) =>
            child.on("exit", () => {
                expect(leases()).toEqual([]);
                resolve();
            })
        );
    });

    it("inherits the licence for its cwd to vanish from a parent lease in the same cwd (land's inner gate)", () => {
        fs.mkdirSync(leaseDir, { recursive: true });
        const parent = lease({
            id: "gate-run-land",
            cwd: fs.realpathSync(tmp),
            cwdMayVanish: true,
        });
        fs.writeFileSync(
            path.join(leaseDir, "gate-run-land.json"),
            JSON.stringify(parent)
        );
        const script = path.join(tmp, "inner.ts");
        fs.writeFileSync(
            script,
            `import { holdLease, readLeases } from ${JSON.stringify(LEASE_LIB)};
             const held = holdLease({ kind: "gate", ttlMs: 60_000 });
             console.log(JSON.stringify(readLeases()!.find((l) => l.id === held!.id)));`
        );
        const r = spawnSync("bun", [script], {
            cwd: tmp,
            env: env({ TOLARIA_OWNER: "gate-run-land" }),
            encoding: "utf8",
        });
        expect(JSON.parse(r.stdout)).toMatchObject({
            parent: "gate-run-land",
            cwdMayVanish: true,
            expires: false,
        });
    });

    it("names the inherited tag as its parent, unless it is a root", () => {
        const run = (root: boolean) => {
            const script = path.join(tmp, `p-${root}.ts`);
            fs.writeFileSync(
                script,
                `import { holdLease, readLeases } from ${JSON.stringify(LEASE_LIB)};
                 holdLease({ kind: "probe", ttlMs: 60_000, root: ${root} });
                 console.log(JSON.stringify(readLeases()![0]));`
            );
            const r = spawnSync("bun", [script], {
                env: env({ TOLARIA_OWNER: "gate-run-x" }),
                encoding: "utf8",
            });
            return JSON.parse(r.stdout).parent;
        };
        expect(run(false)).toBe("gate-run-x");
        expect(run(true)).toBeNull();
    });

    it("a SIGKILLed holder leaves its lease behind — with a dead anchor, for the reaper", () => {
        const script = path.join(tmp, "killed.ts");
        const ready = path.join(tmp, "ready");
        fs.writeFileSync(
            script,
            `import { holdLease } from ${JSON.stringify(LEASE_LIB)};
             import { writeFileSync } from "node:fs";
             holdLease({ kind: "probe", ttlMs: 60_000 });
             writeFileSync(${JSON.stringify(ready)}, "");
             setInterval(() => {}, 1000);`
        );
        const child = spawn("bun", [script], { env: env(), stdio: "ignore" });
        expect(waitForFile(ready)).toBe(true);
        child.kill("SIGKILL");
        return new Promise<void>((resolve) =>
            child.on("exit", () => {
                const [l] = leases();
                expect(l.pid).toBe(child.pid);
                expect(judgeLease(l, null, Date.now(), () => true).alive).toBe(
                    false
                );
                resolve();
            })
        );
    });
});

describe("the CLI — the shell spawners' writer", () => {
    const cli = (...args: string[]) =>
        spawnSync("bun", [LEASE_LIB, ...args], {
            env: env(),
            encoding: "utf8",
        });

    it("put, renew with grace, clear", () => {
        cli(
            "put",
            "gr-1",
            "gate-run",
            String(process.pid),
            "60",
            "--pgid",
            "77",
            "--cwd",
            "/wt/a",
            "--cwd-may-vanish",
            "--command",
            "land 12"
        );
        const [put] = leases();
        expect(put).toMatchObject({
            id: "gr-1",
            kind: "gate-run",
            pid: process.pid,
            pgid: 77,
            cwd: "/wt/a",
            cwdMayVanish: true,
            command: "land 12",
            graceUntil: null,
        });
        expect(put.pidStart).toBeGreaterThan(0);
        expect(put.deadline - put.startedAt).toBe(60_000);

        cli("renew", "gr-1", "600", "--grace", "120");
        const [renewed] = leases();
        expect(renewed.deadline).toBeGreaterThan(put.deadline);
        expect(renewed.graceUntil).toBeGreaterThan(Date.now() + 100_000);

        cli("clear", "gr-1");
        expect(leases()).toEqual([]);
    });

    it("exits non-zero on a failed write, so the caller withholds the tag", () => {
        const r = cli("put", "bad id!", "x", "1", "1");
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/bad lease id/);
    });

    it("--no-expiry writes a lease the clock cannot kill", () => {
        cli(
            "put",
            "pass-1",
            "loop-pass",
            String(process.pid),
            "0",
            "--no-expiry"
        );
        const [l] = leases();
        expect(l.expires).toBe(false);
        expect(
            judgeLease(l, l.pidStart, Date.now() + 10_000, () => true).alive
        ).toBe(true);
    });
});

describe("spawners — lease while running, cleared on exit (issue #5470)", () => {
    // `TOLARIA_LEASE_TRACE` records each put/clear, so a lease that existed
    // only for the spawner's own lifetime is observable from outside it.
    const traceOf = (
        argv: string[],
        cwd: string
    ): { status: number | null; trace: string[] } => {
        const trace = path.join(tmp, "trace");
        const r = spawnSync("bun", argv, {
            cwd,
            env: env({ TOLARIA_LEASE_TRACE: trace }),
            encoding: "utf8",
            timeout: 60_000,
        });
        return {
            status: r.status,
            trace: fs.existsSync(trace)
                ? fs.readFileSync(trace, "utf8").trim().split("\n")
                : [],
        };
    };

    it("check:ui holds a lease for its run", () => {
        const r = traceOf(
            [path.join(REPO_ROOT, "scripts/ui-gate/index.ts"), "--scope-only"],
            REPO_ROOT
        );
        expect(r.status).toBe(0);
        expect(r.trace).toEqual([
            expect.stringMatching(/^put check-ui-\d+-\d+ check:ui$/),
            expect.stringMatching(/^clear check-ui-\d+-\d+$/),
        ]);
    });

    it("health-main holds a lease for its run", () => {
        // A scratch primary checkout: `--status` reads it and exits.
        spawnSync("git", ["init", "-q"], { cwd: tmp });
        const r = traceOf(
            [path.join(REPO_ROOT, "scripts/health-main.ts"), "--status"],
            tmp
        );
        expect(r.status).toBe(0);
        expect(r.trace).toEqual([
            expect.stringMatching(/^put health-main-\d+-\d+ health-main$/),
            expect.stringMatching(/^clear health-main-\d+-\d+$/),
        ]);
    });
});
