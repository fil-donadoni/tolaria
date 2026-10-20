import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { BASE_BRANCH } from "../lib/branches";
import { withoutCorpusExclusion } from "../lib/corpus-exclusion";
import {
    INFRA_REMEDY,
    PREFLIGHT_CONVEX_STEP,
    PREFLIGHT_SKEW_STEP,
} from "../lib/health-verdict";

/**
 * The whole `health-main` run with the Convex deployment down (issue #4943):
 * it must end `infra` at `preflight:convex` in seconds — no RED marker, no
 * worktree, no gate — instead of paying ~40 minutes of gates to learn it at
 * the browser step. Driven for real: a scratch primary checkout whose
 * `origin` is a local bare repo carrying the base branch, and
 * `VITE_CONVEX_URL` on a port nothing listens on. Only a run that owes a
 * browser step needs the backend: `--release`, as `release` runs it (a batch
 * run owes none, issues #5378, #6143).
 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HEALTH_MAIN = path.join(REPO_ROOT, "scripts", "health-main.ts");

let tmp: string;
let primary: string;

const git = (args: string[], cwd: string): void => {
    const r = spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 20_000,
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tolaria-health-preflight-"));
    const bare = path.join(tmp, "origin.git");
    primary = path.join(tmp, "primary");
    git(["init", "-q", "--bare", bare], tmp);
    git(["init", "-q", "-b", BASE_BRANCH, primary], tmp);
    git(
        [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "tip",
        ],
        primary
    );
    git(["remote", "add", "origin", bare], primary);
    git(["push", "-q", "origin", BASE_BRANCH], primary);
});

afterEach(() => {
    fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
});

async function closedPort(): Promise<number> {
    return await new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const p = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(p));
        });
    });
}

describe("health-main — the Convex preflight (issue #4943)", () => {
    it("ends INFRA at preflight:convex in seconds, with no RED marker and no gate run", async () => {
        const port = await closedPort();
        const r = await new Promise<{ code: number | null; stderr: string }>(
            (resolve) => {
                const child = spawn("bun", [HEALTH_MAIN, "--release"], {
                    cwd: primary,
                    env: {
                        ...withoutCorpusExclusion(),
                        VITE_CONVEX_URL: `http://127.0.0.1:${port}`,
                        TOLARIA_GATE_HELD: "",
                    },
                    stdio: ["ignore", "ignore", "pipe"],
                });
                let stderr = "";
                child.stderr.on("data", (d) => (stderr += d));
                // A run that went on to the gates would far outlive this.
                const t = setTimeout(() => child.kill("SIGKILL"), 45_000);
                child.on("close", (code) => {
                    clearTimeout(t);
                    resolve({ code, stderr });
                });
            }
        );
        const dir = path.join(primary, ".claude", "telemetry", "health");

        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/INFRA @ \w+ at preflight:convex/);
        const last = JSON.parse(
            fs.readFileSync(path.join(dir, "last.json"), "utf8")
        ) as Record<string, unknown>;
        expect(last).toMatchObject({
            status: "infra",
            failedStep: PREFLIGHT_CONVEX_STEP,
            infraCause: "convex-down",
            reason: INFRA_REMEDY["convex-down"],
        });
        expect(fs.existsSync(path.join(dir, "RED"))).toBe(false);
        // No gate log: nothing ran.
        expect(fs.readdirSync(dir).filter((f) => f.endsWith(".log"))).toEqual(
            []
        );
    }, 60_000);

    it("a batch run (no --release) owes no browser step, so it never preflights the backend (issue #5378)", () => {
        const r = spawnSync("bun", [HEALTH_MAIN], {
            cwd: primary,
            encoding: "utf8",
            timeout: 45_000,
            env: {
                ...withoutCorpusExclusion(),
                VITE_CONVEX_URL: "http://127.0.0.1:1",
                TOLARIA_GATE_HELD: "",
                // A busy machine ends the run at its next preflight at once
                // rather than waiting: any step past the Convex preflight
                // proves it was passed.
                TOLARIA_MACHINE_WAIT_MAX_MS: "0",
            },
        });
        const last = JSON.parse(
            fs.readFileSync(
                path.join(
                    primary,
                    ".claude",
                    "telemetry",
                    "health",
                    "last.json"
                ),
                "utf8"
            )
        ) as Record<string, unknown>;
        expect(last.failedStep, r.stderr).not.toBe(PREFLIGHT_CONVEX_STEP);
    }, 60_000);
});

describe("health-main — the deployment-skew preflight of release's browser step (issues #6132, #6143)", () => {
    it("a primary off the base branch ends the owed browser step INFRA / deployment-skew before any worktree or browser", () => {
        const tip = spawnSync("git", ["rev-parse", "HEAD"], {
            cwd: primary,
            encoding: "utf8",
        }).stdout.trim();
        // Batch health's record: the offline half GREEN, the browser step
        // owed to `release` (`browserStepsOwed`).
        const dir = path.join(primary, ".claude", "telemetry", "health");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "last.json"),
            JSON.stringify({
                sha: tip,
                status: "green",
                startedAt: new Date().toISOString(),
                branch: BASE_BRANCH,
                offline: "green",
                browser: "skipped",
            })
        );
        // The 2026-10-20 incident: the primary switched off base, so
        // `convex dev` pushed another tree's functions.
        git(["switch", "-q", "-c", `${BASE_BRANCH}-elsewhere`], primary);

        const r = spawnSync("bun", [HEALTH_MAIN, "--release"], {
            cwd: primary,
            encoding: "utf8",
            timeout: 45_000,
            env: { ...withoutCorpusExclusion(), TOLARIA_GATE_HELD: "" },
        });

        expect(r.status, r.stderr).toBe(1);
        expect(r.stderr).toMatch(
            new RegExp(`INFRA @ \\w+ at ${PREFLIGHT_SKEW_STEP}`)
        );
        expect(r.stderr).toContain(`-elsewhere\`, not \`${BASE_BRANCH}\``);
        const last = JSON.parse(
            fs.readFileSync(path.join(dir, "last.json"), "utf8")
        ) as Record<string, unknown>;
        expect(last).toMatchObject({
            status: "infra",
            failedStep: PREFLIGHT_SKEW_STEP,
            infraCause: "deployment-skew",
            reason: INFRA_REMEDY["deployment-skew"],
            browser: "not run",
        });
        expect(fs.existsSync(path.join(dir, "RED"))).toBe(false);
        // No browser-step worktree was ever added beside the primary.
        expect(
            fs
                .readdirSync(tmp)
                .filter((f) => f.startsWith("tolaria-health-browser-"))
        ).toEqual([]);
    }, 60_000);
});
