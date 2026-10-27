import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import { withoutCorpusExclusion } from "../lib/corpus-exclusion";
import { browserStepsOwed } from "../lib/health-gate-skip";
import { PREFLIGHT_CONVEX_STEP } from "../lib/health-verdict";
import { fakeGh, type FakeGh } from "./fake-gh";

/**
 * The health run, driven for real (issue #6143). No run walks `check:ui`:
 * batch health (`--under-lock`) runs no browser step at all (issue #5378),
 * and `--release` — what `release` passes — runs the offline gates and then
 * `check:game-download`, off the heavy mutex, holding only the browser lane;
 * its verdict decides the run's ONE record (issue #4962). A tip whose offline
 * half already stands GREEN runs only the browser step.
 *
 * A scratch primary checkout whose `origin` is a local bare repo (the verdict
 * store is a fake `gh`, `fake-gh.ts`); its `package.json` stands in every
 * gate. `check:all` and `check:game-download` each record what `gate:who`
 * says while they run — the download after taking the lane the way the real
 * one does — and `check:ui` only records that it was invoked at all. The
 * machine mutex lives in a private lock root.
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");
const GATE = path.join(REPO_ROOT, "scripts", "gate.ts");
const UI_ADMISSION = path.join(REPO_ROOT, "scripts", "lib", "ui-admission.ts");

let tmp: string;
let primary: string;
let lockRoot: string;
let server: http.Server;
let convexUrl: string;
let gh: FakeGh;

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

const WHO = `const r = require("child_process").spawnSync("bun", [${JSON.stringify(GATE)}, "who"], { encoding: "utf8" });`;

beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-health-release-"));
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
                // The tip's derived state is fresh unless a test says otherwise
                // (ADR 0157, issue #6248: `judgeDerivedTip`).
                "derive:sync": "bun fake-derive.js",
                "check:all": "bun who-offline.js",
                "check:gaps": ok,
                "check:targets": ok,
                "check:test-hygiene": ok,
                "check:issue-log-comments": ok,
                "check:duplicate-test-blocks": ok,
                test: ok,
                "check:game-download": "bun fake-download.ts",
                "check:ui": "bun fake-ui.js",
            },
        })
    );
    // `derive:sync --fresh` on the tip: fresh unless the run's environment
    // says stale (`FAKE_DERIVE_STALE`), then exit 1 with the reason on
    // stderr as the real one prints it.
    fs.writeFileSync(
        path.join(primary, "fake-derive.js"),
        `if (process.env.FAKE_DERIVE_STALE) { console.error("derive:sync: this tree is derived-stale — " + process.env.FAKE_DERIVE_STALE); process.exit(1); }\nconsole.log("derive:sync: this tree is derived-fresh");\n`
    );
    fs.writeFileSync(
        path.join(primary, "who-offline.js"),
        `${WHO}\nrequire("fs").writeFileSync(process.env.WHO_OFFLINE, r.stdout);\n`
    );
    fs.writeFileSync(
        path.join(primary, "fake-download.ts"),
        `import { acquireUiLane, gateLockRoot } from ${JSON.stringify(UI_ADMISSION)};
require("fs").appendFileSync(process.env.DOWNLOAD_RUNS, "ran\\n");
const hold = await acquireUiLane({ root: gateLockRoot(), label: "check:game-download", announce: () => {} });
${WHO}
require("fs").writeFileSync(process.env.WHO_BROWSER, r.stdout);
hold.release();
process.stdout.write(process.env.FAKE_DOWNLOAD_OUTPUT ?? "");
process.exit(Number(process.env.FAKE_DOWNLOAD_EXIT ?? "0"));
`
    );
    fs.writeFileSync(
        path.join(primary, "fake-ui.js"),
        `require("fs").appendFileSync(process.env.UI_RUNS, process.argv.slice(2).join(" ") + "\\n");\n`
    );
    git(["add", "-A"], primary);
    commit("tip");
    git(["remote", "add", "origin", bare], primary);
    git(["push", "-q", "origin", BASE_BRANCH], primary);
    fs.mkdirSync(healthDir(), { recursive: true });
    gh = fakeGh(path.join(tmp, "fake-gh"));

    server = http.createServer((_, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    convexUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

const healthDir = () => path.join(primary, ".claude", "telemetry", "health");
const tipSha = () => git(["rev-parse", "HEAD"], primary);

const childEnv = (
    download: { exit: number; output?: string } = { exit: 0 }
): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {
        ...withoutCorpusExclusion(),
        ...gh.env,
        TOLARIA_GATE_LOCK_ROOT: lockRoot,
        VITE_CONVEX_URL: convexUrl,
        WHO_OFFLINE: path.join(tmp, "who-offline.txt"),
        WHO_BROWSER: path.join(tmp, "who-browser.txt"),
        DOWNLOAD_RUNS: path.join(tmp, "download-runs.txt"),
        UI_RUNS: path.join(tmp, "ui-runs.txt"),
        FAKE_DOWNLOAD_EXIT: String(download.exit),
        FAKE_DOWNLOAD_OUTPUT: download.output ?? "",
    };
    delete env.TOLARIA_GATE_HELD;
    delete env.TOLARIA_ALLOW_FULL_SUITE;
    delete env.TOLARIA_GATE_ROLE;
    return env;
};

/** One `health-main` run, the fake download exiting `download.exit`. */
async function run(
    argv: string[],
    download: { exit: number; output?: string }
): Promise<{ code: number | null; out: string }> {
    return await new Promise((resolve) => {
        const child = spawn("bun", argv, {
            cwd: primary,
            env: childEnv(download),
        });
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

/** The batch run: under a caller's hold, as the health cadence runs it. */
const batch = (download: { exit: number; output?: string }) =>
    run([HEALTH_MAIN, `--branch=${BASE_BRANCH}`, "--under-lock"], download);
/** What `release` runs (`HEALTH_GATE_ARGS` in `release.ts`). */
const release = (download: { exit: number; output?: string }) =>
    run([HEALTH_MAIN, `--branch=${BASE_BRANCH}`, "--release"], download);

const lastJson = () =>
    JSON.parse(fs.readFileSync(path.join(healthDir(), "last.json"), "utf8"));
/** Whether the fake store holds a RED `health` status for the tip. */
const redMarker = () =>
    gh
        .statuses(tipSha())
        .some((s) => s.context === "health" && s.state === "failure");
const lines = (file: string) =>
    fs.existsSync(path.join(tmp, file))
        ? fs
              .readFileSync(path.join(tmp, file), "utf8")
              .split("\n")
              .filter(Boolean)
        : [];
/** How many times `check:game-download` ran, and every `check:ui` argv. */
const downloadRuns = () => lines("download-runs.txt").length;
const uiRuns = () => lines("ui-runs.txt");
const offlineRan = () => fs.existsSync(path.join(tmp, "who-offline.txt"));

describe("browserStepsOwed — when --release runs only the browser steps (issue #6143)", () => {
    const tip = "a".repeat(40);
    const other = "b".repeat(40);
    const at = "2026-10-20T10:00:00Z";

    it("a local GREEN without its browser steps owes them; one with them owes nothing", () => {
        const green = { sha: tip, status: "green" as const, startedAt: at };
        expect(
            browserStepsOwed({ last: { ...green, browser: "skipped" }, tip })
        ).toBe(true);
        expect(browserStepsOwed({ last: green, tip })).toBe(true);
        expect(
            browserStepsOwed({ last: { ...green, browser: "green" }, tip })
        ).toBe(false);
    });

    it("an INFRA at a browser step after the offline gates passed owes them again", () => {
        const infra = { sha: tip, status: "infra" as const, startedAt: at };
        expect(
            browserStepsOwed({
                last: { ...infra, offline: "green", browser: "infra" },
                tip,
            })
        ).toBe(true);
        // An offline step cut short, or a preflight: the whole gate is owed.
        expect(
            browserStepsOwed({ last: { ...infra, offline: "infra" }, tip })
        ).toBe(false);
        expect(browserStepsOwed({ last: infra, tip })).toBe(false);
    });

    it("a running or RED record about the tip decides on its own", () => {
        for (const status of ["running", "red"] as const)
            expect(
                browserStepsOwed({
                    last: { sha: tip, status, startedAt: at, offline: "green" },
                    tip,
                    stored: { sha: tip, status: "green" },
                }),
                status
            ).toBe(false);
    });

    it("with no local record about the tip, the store's GREEN stands for the offline half", () => {
        const elsewhere = {
            sha: other,
            status: "green" as const,
            startedAt: at,
            browser: "green",
        };
        expect(
            browserStepsOwed({
                last: elsewhere,
                tip,
                stored: { sha: tip, status: "green", machine: "huawei" },
            })
        ).toBe(true);
        expect(
            browserStepsOwed({
                last: null,
                tip,
                stored: { sha: tip, status: "red" },
            })
        ).toBe(false);
        expect(browserStepsOwed({ last: elsewhere, tip })).toBe(false);
    });
});

describe("batch health runs no browser step (issues #5378, #6143)", () => {
    it("an --under-lock run runs neither check:ui nor check:game-download: GREEN, browser skipped", async () => {
        const r = await batch({ exit: 1 });
        expect(r.code, r.out).toBe(0);
        expect(offlineRan()).toBe(true);
        expect(downloadRuns()).toBe(0);
        expect(uiRuns()).toEqual([]);
        expect(lastJson()).toMatchObject({
            status: "green",
            offline: "green",
            browser: "skipped",
        });
    }, 120_000);
});

describe("release runs check:game-download, never a check:ui walk (issue #6143)", () => {
    it("--release gates the tip, then runs the download off the heavy mutex with the browser lane held — GREEN", async () => {
        const r = await release({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        expect(offlineRan()).toBe(true);
        expect(downloadRuns()).toBe(1);
        expect(uiRuns()).toEqual([]);
        const who = fs.readFileSync(path.join(tmp, "who-browser.txt"), "utf8");
        expect(who).toMatch(/heavy mutex is free/);
        expect(who).not.toMatch(/check:ui lane is free/);
        expect(lastJson()).toMatchObject({
            status: "green",
            offline: "green",
            browser: "green",
        });
    }, 120_000);

    it("--release on a tip batch health proved runs ONLY check:game-download", async () => {
        const first = await batch({ exit: 0 });
        expect(first.code, first.out).toBe(0);
        fs.rmSync(path.join(tmp, "who-offline.txt"));
        const r = await release({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        // The offline half stands: only the browser step ran.
        expect(offlineRan()).toBe(false);
        expect(downloadRuns()).toBe(1);
        expect(uiRuns()).toEqual([]);
        expect(lastJson()).toMatchObject({ status: "green", browser: "green" });
    }, 180_000);

    it("--release on a tip only the store holds GREEN (another machine's) runs ONLY check:game-download", async () => {
        gh.seed(tipSha(), {
            state: "success",
            context: "health",
            description: "GREEN · - · other-machine",
        });
        const r = await release({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        expect(offlineRan()).toBe(false);
        expect(downloadRuns()).toBe(1);
        expect(lastJson()).toMatchObject({
            sha: tipSha(),
            status: "green",
            browser: "green",
        });
    }, 120_000);

    it("a red check:game-download is RED, with the marker", async () => {
        const r = await release({ exit: 1, output: "over budget" });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toMatchObject({
            status: "red",
            failedStep: "check:game-download",
            offline: "green",
            browser: "red",
        });
        expect(redMarker()).toBe(true);
    }, 120_000);

    it("one that exits 2 is INFRA browser-step, no marker", async () => {
        const r = await release({ exit: 2, output: "sign-in failed" });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toMatchObject({
            status: "infra",
            infraCause: "browser-step",
            offline: "green",
            browser: "infra",
        });
        expect(redMarker()).toBe(false);
    }, 120_000);

    it("a browser step cut short re-runs alone on the next --release, though the store kept the batch GREEN", async () => {
        expect((await batch({ exit: 0 })).code).toBe(0);
        const cut = await release({ exit: 2, output: "sign-in failed" });
        expect(cut.code, cut.out).toBe(1);
        expect(lastJson()).toMatchObject({ status: "infra", offline: "green" });
        fs.rmSync(path.join(tmp, "who-offline.txt"));
        const r = await release({ exit: 0 });
        expect(r.code, r.out).toBe(0);
        expect(offlineRan()).toBe(false);
        expect(downloadRuns()).toBe(2);
        expect(lastJson()).toMatchObject({ status: "green", browser: "green" });
    }, 240_000);

    it("an infra browser step under a standing RED keeps the red record the marker names", async () => {
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
        gh.seed(tipSha(), {
            state: "failure",
            context: "health",
            description: "RED · test · other-machine",
        });
        const r = await release({ exit: 2, output: "sign-in failed" });
        expect(r.code, r.out).toBe(1);
        expect(lastJson()).toEqual(red);
        expect(redMarker()).toBe(true);
    }, 120_000);

    it("refuses the retired --ui-all and --phase=, and --release under a caller's hold", () => {
        for (const args of [
            ["--ui-all"],
            ["--under-lock", "--phase=offline"],
            ["--phase=walk"],
            ["--under-lock", "--release"],
        ]) {
            const r = spawnSync(
                "bun",
                [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, ...args],
                {
                    cwd: primary,
                    encoding: "utf8",
                    timeout: 60_000,
                    env: childEnv(),
                }
            );
            expect(r.status, `${args.join(" ")}: ${r.stderr}`).toBe(2);
            expect(r.stderr).toMatch(/retired \(issue #6143\)|caller's hold/);
        }
        expect(fs.existsSync(path.join(healthDir(), "last.json"))).toBe(false);
        expect(offlineRan()).toBe(false);
    }, 120_000);
});

/**
 * The CALL of `gateSkipReason` in `health-main.ts` (issue #4977): its pure
 * rule is pinned in `health-pivot.test.ts`, but `retryTerminal: !underLock`
 * is what makes an `--under-lock` run skip a terminal tip while `bun run
 * health` by hand re-gates it (issue #4960). Either inversion was invisible.
 */
describe("health-main — a terminal verdict on the tip: an --under-lock run skips it, a hand run re-gates it (issue #4977)", () => {
    const INFRA_STARTED_AT = new Date(Date.now() - 60_000).toISOString();
    const seedInfra = () => {
        const record = {
            sha: tipSha(),
            status: "infra",
            startedAt: INFRA_STARTED_AT,
            finishedAt: new Date(Date.now() - 30_000).toISOString(),
            failedStep: "test",
            offline: "infra",
        };
        fs.writeFileSync(
            path.join(healthDir(), "last.json"),
            JSON.stringify(record)
        );
        return record;
    };
    const healthMain = (args: string[], env: NodeJS.ProcessEnv = {}) =>
        spawnSync("bun", [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, ...args], {
            cwd: primary,
            encoding: "utf8",
            timeout: 60_000,
            env: { ...childEnv(), ...env },
        });

    it("--under-lock never re-gates an INFRA tip", () => {
        const record = seedInfra();
        const r = healthMain(["--under-lock"]);
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/already has a INFRA verdict/);
        expect(offlineRan()).toBe(false);
        expect(lastJson()).toEqual(record);
    }, 120_000);

    it("by hand (no --under-lock) the same INFRA tip is gated again", () => {
        seedInfra();
        // An unreachable deployment ends the run at its Convex preflight —
        // AFTER the skip decision and the new `running` record, before any
        // gate: the cheapest run that still proves a gate was attempted. Only
        // a run that owes a browser step preflights (`--release`).
        const r = healthMain(["--release"], {
            VITE_CONVEX_URL: "http://127.0.0.1:1",
        });
        expect(r.stdout).not.toMatch(/already has a INFRA verdict/);
        const last = lastJson();
        expect(last.startedAt).not.toBe(INFRA_STARTED_AT);
        expect(last).toMatchObject({
            status: "infra",
            failedStep: PREFLIGHT_CONVEX_STEP,
        });
    }, 120_000);
});

describe("health-main — a derived-stale tip is PENDING within derive:sync's grace, RED past it — in every mode, release included (ADR 0157, issue #6248, issue #7144)", () => {
    const healthMain = (args: string[], env: NodeJS.ProcessEnv) =>
        spawnSync("bun", [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, ...args], {
            cwd: primary,
            encoding: "utf8",
            timeout: 90_000,
            env: { ...childEnv(), ...env },
        });
    const healthStatuses = () =>
        gh.statuses(tipSha()).filter((s) => s.context === "health");

    it("stale and young: PENDING, exit 0, no gate ran, no verdict stored, no RED", () => {
        const r = healthMain(["--under-lock"], {
            FAKE_DERIVE_STALE: "lockfile header: compilerHash drift",
        });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/PENDING @ \w{8} \(derive:sync\)/);
        expect(r.stdout).toContain("compilerHash drift");
        expect(offlineRan()).toBe(false);
        const last = lastJson();
        expect(last.status).toBe("pending");
        expect(last.failedStep).toBe("derive:sync");
        expect(last.sha).toBe(tipSha());
        expect(healthStatuses()).toEqual([]);
        expect(redMarker()).toBe(false);
    }, 120_000);

    it("stale and older than the grace: RED at derive:sync, with the marker, no gate ran", () => {
        // A tip committed two hours ago — past the one-hour grace.
        fs.writeFileSync(path.join(primary, "late.txt"), "late\n");
        git(["add", "-A"], primary);
        const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
        const c = spawnSync(
            "git",
            [
                "-c",
                "user.email=t@t",
                "-c",
                "user.name=t",
                "commit",
                "-q",
                "-m",
                "late tip",
            ],
            {
                cwd: primary,
                encoding: "utf8",
                env: {
                    ...process.env,
                    GIT_COMMITTER_DATE: twoHoursAgo,
                    GIT_AUTHOR_DATE: twoHoursAgo,
                },
            }
        );
        expect(c.status, c.stderr).toBe(0);
        git(["push", "-q", "origin", BASE_BRANCH], primary);
        const r = healthMain(["--under-lock"], {
            FAKE_DERIVE_STALE:
                "data/catalogue/source-hash.json is not what the tree generates",
        });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/RED @ \w{8} \(derive:sync\)/);
        expect(offlineRan()).toBe(false);
        const last = lastJson();
        expect(last.status).toBe("red");
        expect(last.failedStep).toBe("derive:sync");
        expect(redMarker()).toBe(true);
    }, 120_000);

    it("--release on the same stale tip is PENDING too and gates nothing — never RED at check:all (issue #7144)", async () => {
        // Async, like `release()` above: the fake deployment the preflight
        // probes is served by this test process, which a `spawnSync` blocks.
        const r = await new Promise<{ code: number | null; out: string }>(
            (resolve) => {
                const child = spawn(
                    "bun",
                    [HEALTH_MAIN, `--branch=${BASE_BRANCH}`, "--release"],
                    {
                        cwd: primary,
                        env: {
                            ...childEnv(),
                            FAKE_DERIVE_STALE:
                                "lockfile header: compilerHash drift",
                        },
                    }
                );
                let out = "";
                child.stdout.on("data", (c) => (out += c));
                child.stderr.on("data", (c) => (out += c));
                const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
                child.on("close", (code) => {
                    clearTimeout(timer);
                    resolve({ code, out });
                });
            }
        );
        expect(r.code, r.out).toBe(0);
        expect(r.out).toMatch(/PENDING @ \w{8} \(derive:sync\)/);
        expect(offlineRan()).toBe(false);
        expect(lastJson()).toMatchObject({
            status: "pending",
            failedStep: "derive:sync",
        });
        expect(redMarker()).toBe(false);
    }, 120_000);

    it("pending under a standing RED keeps the red record the marker names (review of PR #6295)", () => {
        // RED on the tip X; then a new, stale tip Y lands on top of it.
        const red = {
            sha: tipSha(),
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
        gh.seed(red.sha, {
            state: "failure",
            context: "health",
            description: "RED · test · other-machine",
        });
        fs.writeFileSync(path.join(primary, "y.txt"), "y\n");
        git(["add", "-A"], primary);
        commit("tip Y");
        git(["push", "-q", "origin", BASE_BRANCH], primary);
        const r = healthMain(["--under-lock"], { FAKE_DERIVE_STALE: "x" });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toContain("PENDING");
        expect(lastJson()).toEqual(red);
    }, 120_000);

    it("a predicate that gives no verdict (a crash) is RED at derive:sync at once, never pending", () => {
        fs.writeFileSync(
            path.join(primary, "fake-derive.js"),
            `console.error("error: Cannot find module './catalogue-artifact'"); process.exit(1);\n`
        );
        git(["add", "-A"], primary);
        commit("broken predicate");
        git(["push", "-q", "origin", BASE_BRANCH], primary);
        const r = healthMain(["--under-lock"], {});
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/RED @ \w{8} \(derive:sync\)/);
        expect(lastJson().status).toBe("red");
        expect(offlineRan()).toBe(false);
    }, 120_000);

    it("a pending record does not skip the tip: the next --under-lock run re-judges it, fresh now → GREEN", () => {
        const first = healthMain(["--under-lock"], { FAKE_DERIVE_STALE: "x" });
        expect(first.status, first.stderr).toBe(0);
        expect(lastJson().status).toBe("pending");
        const second = healthMain(["--under-lock"], {});
        expect(second.status, second.stderr).toBe(0);
        expect(second.stdout).not.toContain("already");
        expect(offlineRan()).toBe(true);
        expect(lastJson().status).toBe("green");
    }, 180_000);
});
