import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import {
    PREFLIGHT_CONVEX_STEP,
    UI_WALK_FILE,
    UI_WALK_PROBATION_RUNS,
} from "../lib/health-verdict";

/**
 * The per-batch health run, driven for real through `health-cadence detach`
 * (issue #4962): the offline gates run under the `gate.ts yield` hold, the
 * browser walk runs AFTER it is released, holding only the `check:ui` lane,
 * and the walk's verdict decides the run's ONE record.
 *
 * A scratch primary checkout whose `origin` is a local bare repo; its
 * `package.json` stands in every gate. `check:all` and `check:ui` each record
 * what `gate:who` says while they run — `check:ui` after taking the lane the
 * way the real one does. The machine mutex lives in a private lock root.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CADENCE = path.join(REPO_ROOT, "scripts", "health-cadence.ts");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");
const GATE = path.join(REPO_ROOT, "scripts", "gate.ts");
const UI_ADMISSION = path.join(REPO_ROOT, "scripts", "lib", "ui-admission.ts");

let baseSha: string;
let tmp: string;
let primary: string;
let lockRoot: string;
let server: http.Server;
let convexUrl: string;

const git = (args: string[], cwd: string): string => {
    const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 20_000,
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
};

const commit = (message: string): void =>
    void git(
        [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "-m",
            message,
        ],
        primary
    );

/** The batch since the last GREEN tip (`baseSha`): exactly one new file. */
const land = (file: string): void => {
    git(["reset", "-q", "--hard", baseSha], primary);
    fs.mkdirSync(path.dirname(path.join(primary, file)), { recursive: true });
    fs.writeFileSync(path.join(primary, file), `${file}\n`);
    git(["add", file], primary);
    commit("tip");
    git(["push", "-q", "-f", "origin", BASE_BRANCH], primary);
};

const WHO = `const r = require("child_process").spawnSync("bun", [${JSON.stringify(GATE)}, "who"], { encoding: "utf8" });`;

beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-health-walk-"));
    lockRoot = path.join(tmp, "locks");
    const bare = path.join(tmp, "origin.git");
    primary = path.join(tmp, "primary");
    git(["init", "-q", "--bare", bare], tmp);
    git(["init", "-q", "-b", BASE_BRANCH, primary], tmp);
    const ok = "true";
    fs.writeFileSync(
        path.join(primary, "package.json"),
        JSON.stringify({
            scripts: {
                "worktree:init": ok,
                "check:all": "bun who-offline.js",
                "check:gaps": ok,
                "check:targets": ok,
                "check:test-hygiene": ok,
                "check:convex-heap": ok,
                test: ok,
                "blade:robustness": ok,
                "check:ui": "bun fake-ui.ts",
            },
        })
    );
    fs.writeFileSync(
        path.join(primary, "who-offline.js"),
        `${WHO}\nrequire("fs").writeFileSync(process.env.WHO_OFFLINE, r.stdout);\n`
    );
    fs.writeFileSync(
        path.join(primary, "fake-ui.ts"),
        `import { acquireUiLane, gateLockRoot } from ${JSON.stringify(UI_ADMISSION)};
if (process.argv.includes("--scope-only")) {
    process.stdout.write(process.env.FAKE_SCOPE_OUTPUT ?? "scope (diff base x): FULL — fixture global input\\n");
    process.exit(0);
}
if (process.env.WALK_ARGV) require("fs").appendFileSync(process.env.WALK_ARGV, process.argv.slice(2).join(" ") + "\\n");
const hold = await acquireUiLane({ root: gateLockRoot(), label: "check:ui --all", announce: () => {} });
${WHO}
require("fs").writeFileSync(process.env.WHO_WALK, r.stdout);
hold.release();
process.stdout.write(process.env.FAKE_UI_OUTPUT ?? "");
process.exit(Number(process.env.FAKE_UI_EXIT ?? "0"));
`
    );
    git(["add", "-A"], primary);
    commit("base");
    baseSha = git(["rev-parse", "HEAD"], primary);
    git(["remote", "add", "origin", bare], primary);
    git(["push", "-q", "origin", BASE_BRANCH], primary);
    // The batch since the last GREEN tip reaches a global input by default:
    // the full walk, so the walk-phase tests below keep their walk.
    land("src/index.css");
    const tip = baseSha;

    const health = path.join(primary, ".claude", "telemetry", "health");
    fs.mkdirSync(health, { recursive: true });
    // No Bot batch: the diff from the last green to the tip is empty.
    fs.writeFileSync(
        path.join(primary, ".claude", "telemetry", "green-sha"),
        `${baseSha}\n`
    );
    // Five landings: the batch fires.
    const now = Date.now();
    fs.writeFileSync(
        path.join(health, "cadence.json"),
        JSON.stringify({
            landings: Array.from({ length: 5 }, (_, i) => ({
                sha: tip,
                at: now - (5 - i) * 1000,
            })),
            lastGreenSha: null,
            lastFiredSha: null,
            lastFiredAt: null,
        })
    );

    server = http.createServer((_, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    convexUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmp, { recursive: true, force: true });
});

const healthDir = () => path.join(primary, ".claude", "telemetry", "health");

async function detach(ui: {
    exit: number;
    output?: string;
    scope?: string;
}): Promise<{
    code: number | null;
    out: string;
}> {
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        TOLARIA_GATE_LOCK_ROOT: lockRoot,
        VITE_CONVEX_URL: convexUrl,
        WHO_OFFLINE: path.join(tmp, "who-offline.txt"),
        WHO_WALK: path.join(tmp, "who-walk.txt"),
        WALK_ARGV: path.join(tmp, "walk-argv.txt"),
        ...(ui.scope ? { FAKE_SCOPE_OUTPUT: ui.scope } : {}),
        FAKE_UI_EXIT: String(ui.exit),
        FAKE_UI_OUTPUT: ui.output ?? "",
    };
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;
    delete env.TOLARIA_GATE_ROLE;
    return await new Promise((resolve) => {
        const child = spawn("bun", [CADENCE, "detach"], { cwd: primary, env });
        let out = "";
        child.stdout.on("data", (c) => (out += c));
        child.stderr.on("data", (c) => (out += c));
        const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, out });
        });
    });
}

const lastJson = () =>
    JSON.parse(fs.readFileSync(path.join(healthDir(), "last.json"), "utf8"));
const redMarker = () => fs.existsSync(path.join(healthDir(), "RED"));
const whoAt = (phase: "offline" | "walk") =>
    fs.readFileSync(path.join(tmp, `who-${phase}.txt`), "utf8");

const ASSERT_FAIL_RECEIPT = [
    "RECEIPT — full lane run, 1 surface(s) in scope (1 measured, 0 declared unwalked)",
    "PASS     lobby                1440x900x2   every floor at zero",
    "assert   lobby                1440x900x2   FAIL Create table",
].join("\n");

describe("health-cadence detach — the batch decides the walk (issue #5076)", () => {
    const walkArgv = () =>
        fs.existsSync(path.join(tmp, "walk-argv.txt"))
            ? fs.readFileSync(path.join(tmp, "walk-argv.txt"), "utf8")
            : "";

    it("a prose-only batch runs no walk: GREEN on the offline half, ui skipped, ledger untouched", async () => {
        land("docs/notes.md");
        const r = await detach({ exit: 1 });
        expect(r.code, r.out).toBe(0);
        expect(walkArgv()).toBe("");
        expect(lastJson()).toMatchObject({
            status: "green",
            offline: "green",
            ui: "skipped",
            walk: expect.stringContaining("skipped"),
        });
        expect(fs.existsSync(path.join(healthDir(), UI_WALK_FILE))).toBe(false);
    }, 120_000);

    it("release's --ui-all walks a tip batch health proved without a full walk", async () => {
        land("docs/notes.md");
        const first = await detach({ exit: 0 });
        expect(first.code, first.out).toBe(0);
        expect(walkArgv()).toBe("");
        const r = spawnSync("bun", [HEALTH_MAIN, "--ui-all"], {
            cwd: primary,
            encoding: "utf8",
            timeout: 90_000,
            env: {
                ...process.env,
                TOLARIA_GATE_LOCK_ROOT: lockRoot,
                VITE_CONVEX_URL: convexUrl,
                WHO_WALK: path.join(tmp, "who-walk.txt"),
                WALK_ARGV: path.join(tmp, "walk-argv.txt"),
                FAKE_UI_EXIT: "0",
            },
        });
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect(walkArgv().trim()).toBe("--all");
        expect(lastJson()).toMatchObject({ status: "green", ui: "green" });
        expect(lastJson().walk).toMatch(/^full — /);
    }, 180_000);

    it("a batch the scoper places on one surface walks SCOPED, diffed from the last GREEN tip", async () => {
        land("src/components/Thing.tsx");
        const r = await detach({
            exit: 0,
            scope: `scope (diff base ${baseSha}): SCOPED — 1 surface(s)\n  · lobby\n`,
        });
        expect(r.code, r.out).toBe(0);
        expect(walkArgv().trim()).toBe(`--base=${baseSha}`);
        expect(lastJson()).toMatchObject({
            status: "green",
            ui: "green",
            walk: expect.stringContaining("scoped — 1 surface(s): lobby"),
        });
    }, 120_000);

    it("a batch with a global input walks FULL (--all)", async () => {
        const r = await detach({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        expect(walkArgv().trim()).toBe("--all");
        expect(lastJson().walk).toMatch(/^full — /);
    }, 120_000);

    it("an unknown last-GREEN tip walks FULL, fail-closed", async () => {
        fs.rmSync(path.join(primary, ".claude", "telemetry", "green-sha"));
        const r = await detach({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        expect(walkArgv().trim()).toBe("--all");
        expect(lastJson().walk).toMatch(/unknown or unreadable/);
    }, 120_000);
});

describe("health-cadence detach — the walk runs off the heavy mutex (issue #4962)", () => {
    it("holds the heavy mutex for the offline gates, then walks with it free and the check:ui lane held — and a green walk is GREEN", async () => {
        const r = await detach({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        expect(whoAt("offline")).not.toMatch(/heavy mutex is free/);
        expect(whoAt("walk")).toMatch(/heavy mutex is free/);
        expect(whoAt("walk")).not.toMatch(/check:ui lane is free/);
        const last = lastJson();
        expect(last).toMatchObject({
            status: "green",
            offline: "green",
            ui: "green",
        });
        expect(
            JSON.parse(
                fs.readFileSync(path.join(healthDir(), UI_WALK_FILE), "utf8")
            )
        ).toEqual({ streak: 1 });
    }, 120_000);

    it("a walk the tree failed during probation is INFRA ui-unproven, with no RED marker", async () => {
        const r = await detach({ exit: 1, output: ASSERT_FAIL_RECEIPT });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toMatchObject({
            status: "infra",
            infraCause: "ui-unproven",
            offline: "green",
            ui: "unproven",
        });
        expect(redMarker()).toBe(false);
    }, 120_000);

    it("the same failure once the walk is armed is RED, with the marker", async () => {
        fs.writeFileSync(
            path.join(healthDir(), UI_WALK_FILE),
            JSON.stringify({ streak: UI_WALK_PROBATION_RUNS })
        );
        const r = await detach({ exit: 1, output: ASSERT_FAIL_RECEIPT });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toMatchObject({
            status: "red",
            failedStep: "check:ui --all",
            offline: "green",
            ui: "red",
        });
        expect(redMarker()).toBe(true);
    }, 120_000);

    it("an armed walk that exits 2 is INFRA ui-walk, no marker, and the probation restarts", async () => {
        fs.writeFileSync(
            path.join(healthDir(), UI_WALK_FILE),
            JSON.stringify({ streak: UI_WALK_PROBATION_RUNS })
        );
        const r = await detach({ exit: 2, output: "sign-in failed" });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toMatchObject({
            status: "infra",
            infraCause: "ui-walk",
            ui: "infra",
        });
        expect(redMarker()).toBe(false);
        expect(
            JSON.parse(
                fs.readFileSync(path.join(healthDir(), UI_WALK_FILE), "utf8")
            )
        ).toEqual({ streak: 0 });
    }, 120_000);

    it("an infra walk under a standing RED keeps the red record the marker names", async () => {
        const red = {
            sha: "0".repeat(40),
            status: "red",
            startedAt: new Date(Date.now() - 60_000).toISOString(),
            finishedAt: new Date(Date.now() - 30_000).toISOString(),
            failedStep: "test",
            log: "/somewhere/red.log",
        };
        fs.writeFileSync(
            path.join(healthDir(), "last.json"),
            JSON.stringify(red)
        );
        fs.writeFileSync(path.join(healthDir(), "RED"), "red at test\n");
        const r = await detach({ exit: 2, output: "sign-in failed" });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toEqual(red);
        expect(redMarker()).toBe(true);
    }, 120_000);

    it("--phase=walk never starts a second walk on a record another process is walking", () => {
        const record = {
            sha: git(["rev-parse", "HEAD"], primary),
            status: "running",
            startedAt: new Date().toISOString(),
            phase: "walk",
            offline: "green",
            ui: "walking",
        };
        fs.writeFileSync(
            path.join(healthDir(), "last.json"),
            JSON.stringify(record)
        );
        const r = spawnSync("bun", [HEALTH_MAIN, "--phase=walk"], {
            cwd: primary,
            encoding: "utf8",
            timeout: 60_000,
            env: {
                ...process.env,
                TOLARIA_GATE_LOCK_ROOT: lockRoot,
                WHO_WALK: path.join(tmp, "who-walk.txt"),
            },
        });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/no walk owed/);
        expect(fs.existsSync(path.join(tmp, "who-walk.txt"))).toBe(false);
        expect(lastJson()).toEqual(record);
    }, 120_000);
});

/**
 * The CALL of `gateSkipReason` in `health-main.ts` (issue #4977): its pure
 * rule is pinned in `health-cadence.test.ts`, but `retryTerminal: !underLock`
 * is what makes the cadence's waiter skip a terminal tip while `bun run
 * health` by hand re-gates it (issue #4960). Either inversion was invisible.
 */
describe("health-main — a terminal verdict on the tip: the waiter skips it, a hand run re-gates it (issue #4977)", () => {
    const INFRA_STARTED_AT = new Date(Date.now() - 60_000).toISOString();
    const seedInfra = () => {
        const record = {
            sha: git(["rev-parse", "HEAD"], primary),
            status: "infra",
            startedAt: INFRA_STARTED_AT,
            finishedAt: new Date(Date.now() - 30_000).toISOString(),
            failedStep: "check:ui --all",
        };
        fs.writeFileSync(
            path.join(healthDir(), "last.json"),
            JSON.stringify(record)
        );
        return record;
    };
    const healthMain = (args: string[], env: NodeJS.ProcessEnv = {}) => {
        const childEnv: NodeJS.ProcessEnv = {
            ...process.env,
            TOLARIA_GATE_LOCK_ROOT: lockRoot,
            WHO_OFFLINE: path.join(tmp, "who-offline.txt"),
            ...env,
        };
        delete childEnv.TOLARIA_GATE_HELD;
        delete childEnv.TOLARIA_ALLOW_FULL_SUITE;
        delete childEnv.TOLARIA_GATE_ROLE;
        return spawnSync(
            "bun",
            [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, ...args],
            { cwd: primary, encoding: "utf8", timeout: 60_000, env: childEnv }
        );
    };

    it("--under-lock (the cadence's waiter) never re-gates an INFRA tip", () => {
        const record = seedInfra();
        const r = healthMain(["--under-lock", "--phase=offline"], {
            VITE_CONVEX_URL: convexUrl,
        });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/already has a INFRA verdict/);
        expect(fs.existsSync(path.join(tmp, "who-offline.txt"))).toBe(false);
        expect(lastJson()).toEqual(record);
    }, 120_000);

    it("by hand (no --under-lock) the same INFRA tip is gated again", () => {
        seedInfra();
        // An unreachable deployment ends the run at its Convex preflight —
        // AFTER the skip decision and the new `running` record, before any
        // gate: the cheapest run that still proves a gate was attempted.
        const r = healthMain([], { VITE_CONVEX_URL: "http://127.0.0.1:1" });
        expect(r.stdout).not.toMatch(/already has a INFRA verdict/);
        const last = lastJson();
        expect(last.startedAt).not.toBe(INFRA_STARTED_AT);
        expect(last).toMatchObject({
            status: "infra",
            failedStep: PREFLIGHT_CONVEX_STEP,
        });
    }, 120_000);
});
